"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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

// Actualiza el tipo de cambio global de la organización y recalcula el precio
// de todos los productos (via set_org_exchange_rate, ver
// 0014_org_exchange_rate.sql). Antes el tipo de cambio se editaba por
// producto; ahora es un único valor que cascada a todos.
const exchangeRateSchema = z.object({
  exchangeRate: z.coerce.number().positive("El tipo de cambio debe ser mayor a 0."),
});

export async function updateExchangeRate(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "settings:write")) {
    return { ok: false, error: "No tienes permiso para editar el tipo de cambio." };
  }
  const parsed = exchangeRateSchema.safeParse({
    exchangeRate: formData.get("exchangeRate"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_org_exchange_rate", {
    p_org_id: profile.orgId,
    p_exchange_rate: parsed.data.exchangeRate,
  });
  if (error) {
    console.error("updateExchangeRate:", error.message);
    return { ok: false, error: "No se pudo actualizar el tipo de cambio." };
  }

  revalidatePath("/ajustes");
  revalidatePath("/productos");
  return { ok: true };
}
