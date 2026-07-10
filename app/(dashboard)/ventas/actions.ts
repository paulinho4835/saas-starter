"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { calculateLineSubtotal, calculateSaleTotal } from "@/lib/sales";
import { SALE_TYPES, priceTierForSaleType, type SaleType } from "@/lib/saleType";

const saleItemSchema = z.object({
  productId: z.string().uuid(),
  unitPriceBs: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  saleType: z.enum(SALE_TYPES as [SaleType, ...SaleType[]]),
});

const createSaleSchema = z.object({
  customerName: z.string().trim().max(120).optional(),
  customerNit: z.string().trim().max(30).optional(),
  items: z.array(saleItemSchema).min(1, "Agrega al menos un producto."),
});

export type CreateSaleResult =
  | { ok: true; saleIds: string[]; total: number }
  | { ok: false; error: string };

// Confirma una venta: valida stock de cada línea en la sucursal del vendedor,
// descuenta `product_stock` línea por línea con bloqueo optimista (la
// condición `.eq("quantity", currentQuantity)` falla si otra venta cambió el
// stock entre la lectura y la escritura), y revierte lo ya aplicado si algún
// paso falla a mitad de camino. `branch_id` sale SIEMPRE del perfil del
// servidor, nunca del cliente.
export async function createSale(formData: FormData): Promise<CreateSaleResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "ventas:create")) {
    return { ok: false, error: "No tienes permiso para registrar ventas." };
  }
  if (!profile.branchId) {
    return {
      ok: false,
      error:
        "No tienes una sucursal asignada. Pide al administrador que te la asigne en Ajustes.",
    };
  }

  let itemsRaw: unknown;
  try {
    itemsRaw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { ok: false, error: "Carrito inválido." };
  }
  const customerNameRaw = formData.get("customerName");
  const customerNitRaw = formData.get("customerNit");

  const parsed = createSaleSchema.safeParse({
    customerName: customerNameRaw ? String(customerNameRaw) : undefined,
    customerNit: customerNitRaw ? String(customerNitRaw) : undefined,
    items: itemsRaw,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const orgId = profile.orgId;
  const branchId = profile.branchId;

  // 1) Verificación previa de stock (lectura en batch de todas las líneas).
  const productIds = [...new Set(parsed.data.items.map((i) => i.productId))];
  const { data: stockRows } = await supabase
    .from("product_stock")
    .select("product_id, quantity")
    .eq("branch_id", branchId)
    .in("product_id", productIds);
  const stockByProduct = new Map(
    (stockRows ?? []).map((s) => [s.product_id as string, s.quantity as number]),
  );

  const insufficient = parsed.data.items.filter(
    (item) => (stockByProduct.get(item.productId) ?? 0) < item.quantity,
  );
  if (insufficient.length > 0) {
    return {
      ok: false,
      error: `Stock insuficiente para ${insufficient.length} producto(s). Revisa las cantidades.`,
    };
  }

  // 2) Descontar stock con bloqueo optimista. Cada línea es un producto
  // distinto (el carrito no permite repetir producto, ver
  // isProductInCart/PRODUCT_ALREADY_IN_CART_ERROR en lib/ventasCart.ts), así
  // que los updates son independientes entre sí y se disparan todos en
  // paralelo en vez de uno por uno — con carritos grandes esto evita que la
  // confirmación de venta escale linealmente con la cantidad de líneas.
  const decremented: { productId: string; quantity: number }[] = [];

  async function revertDecrements() {
    await Promise.all(
      decremented.map((d) => {
        const original = stockByProduct.get(d.productId) ?? 0;
        return supabase
          .from("product_stock")
          .update({ quantity: original })
          .eq("product_id", d.productId)
          .eq("branch_id", branchId);
      }),
    );
  }

  const decrementResults = await Promise.all(
    parsed.data.items.map(async (item) => {
      const currentQuantity = stockByProduct.get(item.productId)!;
      const { data: updated } = await supabase
        .from("product_stock")
        .update({
          quantity: currentQuantity - item.quantity,
          updated_at: new Date().toISOString(),
        })
        .eq("product_id", item.productId)
        .eq("branch_id", branchId)
        .eq("quantity", currentQuantity)
        .select("quantity")
        .maybeSingle();
      return { item, ok: Boolean(updated) };
    }),
  );
  for (const { item, ok } of decrementResults) {
    if (ok) decremented.push({ productId: item.productId, quantity: item.quantity });
  }
  if (decrementResults.some((r) => !r.ok)) {
    await revertDecrements();
    return {
      ok: false,
      error: "El stock cambió mientras confirmabas la venta. Vuelve a intentarlo.",
    };
  }

  // 3) Resuelve el cliente por NIT (dedup) o crea uno nuevo según lo que haya
  // escrito el vendedor en el mostrador, recién ahora que el stock ya está
  // validado y descontado (evita crear un cliente huérfano si la venta
  // termina fallando por falta de stock). Ver
  // docs/superpowers/specs/2026-07-02-cliente-en-venta-design.md.
  let resolvedCustomerId: string | null = null;
  const { customerName, customerNit } = parsed.data;
  if (customerNit) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("org_id", orgId)
      .ilike("nit", customerNit)
      .maybeSingle();
    if (existing) {
      resolvedCustomerId = existing.id;
      if (customerName && customerName !== existing.full_name) {
        await supabase.from("customers").update({ full_name: customerName }).eq("id", existing.id);
      }
    } else {
      const { data: created, error: createError } = await supabase
        .from("customers")
        .insert({ org_id: orgId, full_name: customerName || "Cliente sin nombre", nit: customerNit })
        .select("id")
        .single();
      if (createError || !created) {
        await revertDecrements();
        console.error("createSale customer (nit):", createError?.message);
        return { ok: false, error: "No se pudo registrar el cliente. Tu stock no fue afectado." };
      }
      resolvedCustomerId = created.id;
    }
  } else if (customerName) {
    const { data: created, error: createError } = await supabase
      .from("customers")
      .insert({ org_id: orgId, full_name: customerName })
      .select("id")
      .single();
    if (createError || !created) {
      await revertDecrements();
      console.error("createSale customer (name):", createError?.message);
      return { ok: false, error: "No se pudo registrar el cliente. Tu stock no fue afectado." };
    }
    resolvedCustomerId = created.id;
  }

  // 4) El legacy (Venta Retenes) permite mezclar CF/SF/MAY en una misma
  // venta: son 3 carritos paralelos que se registran juntos, cada uno
  // generando su propia fila `sales`. Acá agrupamos las líneas por
  // `saleType` (cada grupo = un tier concreto) y creamos una venta por
  // grupo no vacío. El cliente (NIT/nombre) solo se liga a la venta CF —
  // las ventas SF/MAY quedan con `customer_id = null`, igual que el legacy.
  const groups = new Map<SaleType, typeof parsed.data.items>();
  for (const item of parsed.data.items) {
    const group = groups.get(item.saleType);
    if (group) group.push(item);
    else groups.set(item.saleType, [item]);
  }

  const createdSaleIds: string[] = [];

  async function revertSales() {
    for (const saleId of createdSaleIds) {
      await supabase.from("sale_items").delete().eq("sale_id", saleId);
      await supabase.from("stock_movements").delete().eq("sale_id", saleId);
      await supabase.from("sales").delete().eq("id", saleId);
    }
  }

  let total = 0;
  for (const [saleType, items] of groups) {
    const groupTotal = calculateSaleTotal(items);
    total += groupTotal;
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert({
        org_id: orgId,
        branch_id: branchId,
        seller_id: profile.userId,
        customer_id: priceTierForSaleType(saleType) === "cf" ? resolvedCustomerId : null,
        sale_type: saleType,
        total_bs: groupTotal,
      })
      .select("id")
      .single();
    if (saleError || !sale) {
      await revertSales();
      await revertDecrements();
      console.error("createSale venta:", saleError?.message);
      return { ok: false, error: "No se pudo registrar la venta. Tu stock no fue afectado." };
    }
    createdSaleIds.push(sale.id);

    const itemsPayload = items.map((item) => ({
      sale_id: sale.id,
      product_id: item.productId,
      price_tier: priceTierForSaleType(saleType),
      unit_price_bs: item.unitPriceBs,
      quantity: item.quantity,
      subtotal_bs: calculateLineSubtotal(item),
    }));
    const { error: itemsError } = await supabase.from("sale_items").insert(itemsPayload);
    if (itemsError) {
      await revertSales();
      await revertDecrements();
      console.error("createSale items:", itemsError.message);
      return { ok: false, error: "No se pudo registrar la venta. Tu stock no fue afectado." };
    }

    const movementsPayload = items.map((item) => {
      const original = stockByProduct.get(item.productId)!;
      return {
        org_id: orgId,
        product_id: item.productId,
        branch_id: branchId,
        movement_type: "venta" as const,
        quantity_delta: -item.quantity,
        resulting_quantity: original - item.quantity,
        reason: null,
        actor_id: profile.userId,
        sale_id: sale.id,
      };
    });
    const { error: movementsError } = await supabase
      .from("stock_movements")
      .insert(movementsPayload);
    if (movementsError) {
      await revertSales();
      await revertDecrements();
      console.error("createSale movements:", movementsError.message);
      return { ok: false, error: "No se pudo registrar la venta. Tu stock no fue afectado." };
    }
  }

  revalidatePath("/ventas");
  return { ok: true, saleIds: createdSaleIds, total: Math.round(total * 100) / 100 };
}

// Busca un cliente ya registrado por NIT exacto (case-insensitive), para
// autocompletar el nombre en el modal de venta con factura apenas el
// vendedor termina de escribir el NIT — igual que el legacy, que ya tenía
// el cliente guardado de una venta anterior.
export async function lookupCustomerByNit(
  nit: string,
): Promise<{ ok: true; fullName: string | null } | { ok: false; error: string }> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  const trimmed = nit.trim();
  if (!trimmed) return { ok: true, fullName: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("full_name")
    .eq("org_id", profile.orgId)
    .ilike("nit", trimmed)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("lookupCustomerByNit:", error.message);
    return { ok: false, error: "No se pudo buscar el cliente." };
  }
  return { ok: true, fullName: data?.full_name ?? null };
}

// Sugerencias mientras el vendedor escribe el NIT (réplica del autocompletado
// del legacy: lista de clientes cuyo NIT empieza con lo tecleado, para elegir
// de una lista en vez de tener que escribir el NIT completo).
export type CustomerNitSuggestion = { nit: string; fullName: string };
export async function searchCustomersByNit(
  prefix: string,
): Promise<{ ok: true; results: CustomerNitSuggestion[] } | { ok: false; error: string }> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  const trimmed = prefix.trim();
  if (!trimmed) return { ok: true, results: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("nit, full_name")
    .eq("org_id", profile.orgId)
    .not("nit", "is", null)
    .ilike("nit", `${escapePostgrestFilterValue(trimmed)}%`)
    .order("nit")
    .limit(8);
  if (error) {
    console.error("searchCustomersByNit:", error.message);
    return { ok: false, error: "No se pudo buscar el cliente." };
  }
  return {
    ok: true,
    results: (data ?? []).map((c) => ({ nit: c.nit as string, fullName: c.full_name })),
  };
}

// Inverso de lookupCustomerByNit: busca por nombre exacto (case-insensitive)
// para autocompletar el NIT. Si hay más de un cliente con el mismo nombre
// (nombres genéricos como "Mostrador"), toma el primero — es solo un
// autocompletado, el vendedor puede corregirlo a mano.
export async function lookupCustomerByName(
  fullName: string,
): Promise<{ ok: true; nit: string | null } | { ok: false; error: string }> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  const trimmed = fullName.trim();
  if (!trimmed) return { ok: true, nit: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("nit")
    .eq("org_id", profile.orgId)
    .ilike("full_name", trimmed)
    .not("nit", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("lookupCustomerByName:", error.message);
    return { ok: false, error: "No se pudo buscar el cliente." };
  }
  return { ok: true, nit: data?.nit ?? null };
}

// ── Stock por sucursal (panel derecho de Ventas) ────────────────────────────
// El legacy solo muestra el stock de OTRAS sucursales acá (el stock de la
// sucursal propia ya se ve en la columna "Stock" de la tabla principal).
export type ProductBranchStockResult =
  | { ok: true; rows: { branchName: string; quantity: number }[] }
  | { ok: false; error: string };

export async function getProductBranchStock(
  productId: string,
): Promise<ProductBranchStockResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!profile.branchId) return { ok: true, rows: [] };

  const supabase = await createClient();

  const { data: stockData, error: stockError } = await supabase
    .from("product_stock")
    .select("quantity, branches(name)")
    .eq("product_id", productId)
    .neq("branch_id", profile.branchId);

  if (stockError) {
    console.error("getProductBranchStock:", stockError.message);
    return { ok: false, error: "No se pudo cargar el stock por sucursal." };
  }

  const rows = ((stockData ?? []) as unknown as { quantity: number; branches: { name: string } | null }[]).map(
    (r) => ({ branchName: r.branches?.name ?? "—", quantity: r.quantity }),
  );

  return { ok: true, rows };
}
