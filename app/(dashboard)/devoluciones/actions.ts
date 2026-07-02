"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const returnSchema = z.object({
  saleItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export type CreateReturnResult = { ok: true } | { ok: false; error: string };

// Devuelve (parcial o totalmente) una línea de una venta ya confirmada: repone
// stock, registra el movimiento y reduce el total de la venta. La venta y la
// línea original NUNCA se editan — la devolución queda como registro aparte
// (sale_returns). Ver docs/superpowers/specs/2026-07-02-devoluciones-design.md
export async function createReturn(
  saleItemId: string,
  quantity: number,
): Promise<CreateReturnResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "devoluciones:create")) {
    return { ok: false, error: "No tienes permiso para procesar devoluciones." };
  }

  const parsed = returnSchema.safeParse({ saleItemId, quantity });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const orgId = profile.orgId;

  const { data: saleItem } = await supabase
    .from("sale_items")
    .select("id, product_id, quantity, unit_price_bs, sales!inner(id, org_id, branch_id, total_bs)")
    .eq("id", parsed.data.saleItemId)
    .maybeSingle();
  const sale = (saleItem as unknown as { sales: { id: string; org_id: string; branch_id: string; total_bs: number } } | null)
    ?.sales;
  if (!saleItem || !sale || sale.org_id !== orgId) {
    return { ok: false, error: "Línea de venta no encontrada." };
  }

  const { data: previousReturns } = await supabase
    .from("sale_returns")
    .select("quantity")
    .eq("sale_item_id", parsed.data.saleItemId);
  const alreadyReturned = (previousReturns ?? []).reduce((sum, r) => sum + (r.quantity as number), 0);
  const remaining = (saleItem.quantity as number) - alreadyReturned;

  if (parsed.data.quantity > remaining) {
    return {
      ok: false,
      error: `No se puede devolver ${parsed.data.quantity} unidad(es): solo quedan ${remaining} disponible(s) para devolver en esta línea.`,
    };
  }

  const amount = Math.round((parsed.data.quantity as number) * (saleItem.unit_price_bs as number) * 100) / 100;
  const productId = saleItem.product_id as string;
  const branchId = sale.branch_id;

  // 1) Repone stock (bloqueo optimista, mismo patrón que createSale).
  const { data: stockRow } = await supabase
    .from("product_stock")
    .select("quantity")
    .eq("product_id", productId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (!stockRow) {
    return { ok: false, error: "No se encontró el stock de este producto en la sucursal de la venta." };
  }
  const currentQuantity = stockRow.quantity as number;
  const { data: updatedStock } = await supabase
    .from("product_stock")
    .update({ quantity: currentQuantity + parsed.data.quantity, updated_at: new Date().toISOString() })
    .eq("product_id", productId)
    .eq("branch_id", branchId)
    .eq("quantity", currentQuantity)
    .select("quantity")
    .maybeSingle();
  if (!updatedStock) {
    return { ok: false, error: "El stock cambió mientras procesabas la devolución. Vuelve a intentarlo." };
  }

  async function revertStock() {
    await supabase
      .from("product_stock")
      .update({ quantity: currentQuantity })
      .eq("product_id", productId)
      .eq("branch_id", branchId);
  }

  // 2) Registra el movimiento.
  const { error: movementError } = await supabase.from("stock_movements").insert({
    org_id: orgId,
    product_id: productId,
    branch_id: branchId,
    movement_type: "devolucion",
    quantity_delta: parsed.data.quantity,
    resulting_quantity: currentQuantity + parsed.data.quantity,
    reason: null,
    actor_id: profile.userId,
    sale_id: sale.id,
  });
  if (movementError) {
    await revertStock();
    console.error("createReturn movement:", movementError.message);
    return { ok: false, error: "No se pudo registrar la devolución. Tu stock no fue afectado." };
  }

  // 3) Registra la devolución.
  const { error: returnError } = await supabase.from("sale_returns").insert({
    org_id: orgId,
    sale_item_id: parsed.data.saleItemId,
    sale_id: sale.id,
    product_id: productId,
    branch_id: branchId,
    quantity: parsed.data.quantity,
    amount_bs: amount,
    actor_id: profile.userId,
  });
  if (returnError) {
    await supabase
      .from("stock_movements")
      .delete()
      .eq("sale_id", sale.id)
      .eq("product_id", productId)
      .eq("movement_type", "devolucion")
      .eq("quantity_delta", parsed.data.quantity);
    await revertStock();
    console.error("createReturn sale_returns:", returnError.message);
    return { ok: false, error: "No se pudo registrar la devolución. Tu stock no fue afectado." };
  }

  // 4) Reduce el total de la venta. `sales` no tiene política update (una
  // venta no se edita desde el flujo normal); este único ajuste usa el
  // cliente admin tras la verificación de permiso de arriba.
  const admin = createAdminClient();
  const { error: totalError } = await admin
    .from("sales")
    .update({ total_bs: Math.round((sale.total_bs - amount) * 100) / 100 })
    .eq("id", sale.id)
    .eq("org_id", orgId);
  if (totalError) {
    await supabase.from("sale_returns").delete().eq("sale_item_id", parsed.data.saleItemId).eq("quantity", parsed.data.quantity);
    await supabase
      .from("stock_movements")
      .delete()
      .eq("sale_id", sale.id)
      .eq("product_id", productId)
      .eq("movement_type", "devolucion")
      .eq("quantity_delta", parsed.data.quantity);
    await revertStock();
    console.error("createReturn sales.total_bs:", totalError.message);
    return { ok: false, error: "No se pudo registrar la devolución. Tu stock no fue afectado." };
  }

  revalidatePath("/devoluciones");
  return { ok: true };
}
