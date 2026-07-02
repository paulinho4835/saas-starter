"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { verifyBranchInOrg } from "@/lib/catalogs";

export type TransferStockResult = { ok: true } | { ok: false; error: string };

const transferSchema = z.object({
  productId: z.string().uuid(),
  toBranchId: z.string().uuid(),
  quantity: z.coerce.number().int().positive("La cantidad debe ser un entero mayor a 0."),
});

// Transferencia Almacén → sucursal: descuenta del almacén y suma en destino
// en una sola transacción atómica (función SQL `transfer_stock`, ver
// docs/superpowers/specs/2026-07-02-almacen-design.md). La sucursal de origen
// (el almacén) se resuelve acá server-side por `is_warehouse = true` — nunca
// viene del cliente.
export async function transferStock(formData: FormData): Promise<TransferStockResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "almacen:transfer")) {
    return { ok: false, error: "No tienes permiso para transferir stock del almacén." };
  }

  const parsed = transferSchema.safeParse({
    productId: formData.get("productId"),
    toBranchId: formData.get("toBranchId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();

  const toBranchValid = await verifyBranchInOrg(supabase, parsed.data.toBranchId, profile.orgId);
  if (!toBranchValid) {
    return { ok: false, error: "La sucursal destino seleccionada no es válida." };
  }

  const { data: warehouse } = await supabase
    .from("branches")
    .select("id")
    .eq("org_id", profile.orgId)
    .eq("is_warehouse", true)
    .maybeSingle();
  if (!warehouse) {
    return { ok: false, error: "No hay un almacén configurado para tu organización." };
  }
  if (warehouse.id === parsed.data.toBranchId) {
    return { ok: false, error: "No puedes transferir el almacén hacia sí mismo." };
  }

  const { error } = await supabase.rpc("transfer_stock", {
    p_org_id: profile.orgId,
    p_product_id: parsed.data.productId,
    p_from_branch_id: warehouse.id,
    p_to_branch_id: parsed.data.toBranchId,
    p_quantity: parsed.data.quantity,
    p_actor_id: profile.userId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/almacen");
  return { ok: true };
}
