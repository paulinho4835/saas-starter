"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { verifyBranchInOrg } from "@/lib/catalogs";

export type TransferBetweenBranchesResult = { ok: true } | { ok: false; error: string };

const transferSchema = z.object({
  productId: z.string().uuid(),
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
  quantity: z.coerce.number().int().positive("La cantidad debe ser un entero mayor a 0."),
});

// Traspaso general entre dos sucursales cualesquiera (a diferencia de
// Almacén, que solo transfiere desde el almacén). Reutiliza el mismo RPC
// atómico `transfer_stock` (ver docs/superpowers/specs/2026-07-02-traspasos-design.md).
// A diferencia de Almacén, fromBranchId viene del cliente (la fila sobre la
// que se hizo clic) — se revalida server-side contra la org igual que toBranchId.
export async function transferBetweenBranches(formData: FormData): Promise<TransferBetweenBranchesResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "traspasos:create")) {
    return { ok: false, error: "No tienes permiso para hacer traspasos entre sucursales." };
  }

  const parsed = transferSchema.safeParse({
    productId: formData.get("productId"),
    fromBranchId: formData.get("fromBranchId"),
    toBranchId: formData.get("toBranchId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  if (parsed.data.fromBranchId === parsed.data.toBranchId) {
    return { ok: false, error: "La sucursal de origen y destino no pueden ser la misma." };
  }

  const supabase = await createClient();

  const [fromValid, toValid] = await Promise.all([
    verifyBranchInOrg(supabase, parsed.data.fromBranchId, profile.orgId),
    verifyBranchInOrg(supabase, parsed.data.toBranchId, profile.orgId),
  ]);
  if (!fromValid || !toValid) {
    return { ok: false, error: "Alguna de las sucursales seleccionadas no es válida." };
  }

  const { error } = await supabase.rpc("transfer_stock", {
    p_org_id: profile.orgId,
    p_product_id: parsed.data.productId,
    p_from_branch_id: parsed.data.fromBranchId,
    p_to_branch_id: parsed.data.toBranchId,
    p_quantity: parsed.data.quantity,
    p_actor_id: profile.userId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/traspasos");
  return { ok: true };
}
