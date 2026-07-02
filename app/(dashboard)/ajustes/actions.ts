"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { insertCatalogEntry, deleteCatalogEntry, catalogNameSchema } from "@/lib/catalogs";
import { can } from "@/lib/rbac";

export type ActionResult = { ok: boolean; error?: string };

// Crea una sucursal de la organización.
export async function createBranch(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "sucursales:write")) {
    return { ok: false, error: "No tienes permiso para crear sucursales." };
  }
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("branches", profile.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/ajustes");
  return { ok: true };
}

// Elimina una sucursal de la organización.
export async function deleteBranch(id: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "sucursales:write")) {
    return { ok: false, error: "No tienes permiso para eliminar sucursales." };
  }
  const res = await deleteCatalogEntry("branches", id);
  if (!res.ok) return res;
  revalidatePath("/ajustes");
  return { ok: true };
}
