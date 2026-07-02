"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { calculateLineSubtotal, calculateSaleTotal } from "@/lib/sales";
import { SALE_TYPES, priceTierForSaleType, type SaleType } from "@/lib/saleType";

const saleItemSchema = z.object({
  productId: z.string().uuid(),
  unitPriceBs: z.number().nonnegative(),
  quantity: z.number().int().positive(),
});

const createSaleSchema = z.object({
  customerName: z.string().trim().max(120).optional(),
  customerNit: z.string().trim().max(30).optional(),
  saleType: z.enum(SALE_TYPES as [SaleType, ...SaleType[]]),
  items: z.array(saleItemSchema).min(1, "Agrega al menos un producto."),
});

export type CreateSaleResult =
  | { ok: true; saleId: string; total: number }
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
    saleType: formData.get("saleType"),
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

  // 2) Descontar stock línea por línea con bloqueo optimista. Si una línea
  // falla, revierte las que ya se aplicaron.
  const decremented: { productId: string; quantity: number }[] = [];

  async function revertDecrements() {
    for (const d of decremented) {
      const original = stockByProduct.get(d.productId) ?? 0;
      await supabase
        .from("product_stock")
        .update({ quantity: original })
        .eq("product_id", d.productId)
        .eq("branch_id", branchId);
    }
  }

  for (const item of parsed.data.items) {
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
    if (!updated) {
      await revertDecrements();
      return {
        ok: false,
        error: "El stock cambió mientras confirmabas la venta. Vuelve a intentarlo.",
      };
    }
    decremented.push({ productId: item.productId, quantity: item.quantity });
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

  // 4) Crear la venta y sus líneas.
  const total = calculateSaleTotal(parsed.data.items);
  const { data: sale, error: saleError } = await supabase
    .from("sales")
    .insert({
      org_id: orgId,
      branch_id: branchId,
      seller_id: profile.userId,
      customer_id: resolvedCustomerId,
      sale_type: parsed.data.saleType,
      total_bs: total,
    })
    .select("id")
    .single();
  if (saleError || !sale) {
    await revertDecrements();
    console.error("createSale venta:", saleError?.message);
    return { ok: false, error: "No se pudo registrar la venta. Tu stock no fue afectado." };
  }

  const itemsPayload = parsed.data.items.map((item) => ({
    sale_id: sale.id,
    product_id: item.productId,
    price_tier: priceTierForSaleType(parsed.data.saleType),
    unit_price_bs: item.unitPriceBs,
    quantity: item.quantity,
    subtotal_bs: calculateLineSubtotal(item),
  }));
  const { error: itemsError } = await supabase.from("sale_items").insert(itemsPayload);
  if (itemsError) {
    await supabase.from("sales").delete().eq("id", sale.id);
    await revertDecrements();
    console.error("createSale items:", itemsError.message);
    return { ok: false, error: "No se pudo registrar la venta. Tu stock no fue afectado." };
  }

  // 5) Historial de movimientos: una fila por línea vendida, ligada a la venta.
  const movementsPayload = parsed.data.items.map((item) => {
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
    await supabase.from("sale_items").delete().eq("sale_id", sale.id);
    await supabase.from("sales").delete().eq("id", sale.id);
    await revertDecrements();
    console.error("createSale movements:", movementsError.message);
    return { ok: false, error: "No se pudo registrar la venta. Tu stock no fue afectado." };
  }

  revalidatePath("/ventas");
  return { ok: true, saleId: sale.id, total };
}
