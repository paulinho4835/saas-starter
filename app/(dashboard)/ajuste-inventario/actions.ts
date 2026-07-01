"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { verifyBranchInOrg } from "@/lib/catalogs";

export type AdjustStockResult = { ok: true } | { ok: false; error: string };

const adjustSchema = z.object({
  productId: z.string().uuid(),
  branchId: z.string().uuid(),
  direction: z.enum(["add", "reduce"]),
  amount: z.coerce.number().int().positive("La cantidad debe ser un entero mayor a 0."),
  reason: z.string().trim().min(1, "El motivo es obligatorio.").max(300),
});

// Ajuste manual de stock desde /ajuste-inventario: descuenta o suma stock con
// bloqueo optimista (misma condición `.eq("quantity", currentQuantity)` que ya
// usa createSale) y deja constancia en stock_movements. Si el registro del
// movimiento falla después de tocar el stock, revierte el cambio.
export async function adjustStock(formData: FormData): Promise<AdjustStockResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para ajustar el stock." };
  }

  const parsed = adjustSchema.safeParse({
    productId: formData.get("productId"),
    branchId: formData.get("branchId"),
    direction: formData.get("direction"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const branchValid = await verifyBranchInOrg(supabase, parsed.data.branchId, profile.orgId);
  if (!branchValid) {
    return { ok: false, error: "La sucursal seleccionada no es válida." };
  }

  const { data: stockRow } = await supabase
    .from("product_stock")
    .select("quantity")
    .eq("product_id", parsed.data.productId)
    .eq("branch_id", parsed.data.branchId)
    .maybeSingle();
  const currentQuantity = stockRow?.quantity ?? 0;

  const delta = parsed.data.direction === "add" ? parsed.data.amount : -parsed.data.amount;
  const newQuantity = currentQuantity + delta;
  if (newQuantity < 0) {
    return { ok: false, error: "No puedes reducir más stock del disponible." };
  }

  if (stockRow) {
    const { data: updated } = await supabase
      .from("product_stock")
      .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
      .eq("product_id", parsed.data.productId)
      .eq("branch_id", parsed.data.branchId)
      .eq("quantity", currentQuantity)
      .select("quantity")
      .maybeSingle();
    if (!updated) {
      return {
        ok: false,
        error: "El stock cambió mientras hacías el ajuste. Vuelve a intentarlo.",
      };
    }
  } else {
    const { error: insertError } = await supabase.from("product_stock").insert({
      org_id: profile.orgId,
      product_id: parsed.data.productId,
      branch_id: parsed.data.branchId,
      quantity: newQuantity,
    });
    if (insertError) {
      console.error("adjustStock insert:", insertError.message);
      return { ok: false, error: "No se pudo registrar el stock." };
    }
  }

  const { error: movementError } = await supabase.from("stock_movements").insert({
    org_id: profile.orgId,
    product_id: parsed.data.productId,
    branch_id: parsed.data.branchId,
    movement_type: "ajuste_manual",
    quantity_delta: delta,
    resulting_quantity: newQuantity,
    reason: parsed.data.reason,
    actor_id: profile.userId,
    sale_id: null,
  });
  if (movementError) {
    console.error("adjustStock movement:", movementError.message);
    if (stockRow) {
      await supabase
        .from("product_stock")
        .update({ quantity: currentQuantity })
        .eq("product_id", parsed.data.productId)
        .eq("branch_id", parsed.data.branchId);
    } else {
      await supabase
        .from("product_stock")
        .delete()
        .eq("product_id", parsed.data.productId)
        .eq("branch_id", parsed.data.branchId);
    }
    return { ok: false, error: "No se pudo registrar el ajuste. El cambio fue revertido." };
  }

  revalidatePath("/ajuste-inventario");
  return { ok: true };
}
