"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteOrgUser } from "@/lib/inviteUser";
import type { Role } from "@/lib/rbac";
import { insertCatalogEntry, deleteCatalogEntry, catalogNameSchema } from "@/lib/catalogs";
import { can } from "@/lib/rbac";

const inviteSchema = z.object({
  email: z.string().trim().email("Correo inválido."),
  fullName: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  role: z.enum(["admin", "manager", "member", "viewer"]),
});

export type ActionResult = { ok: boolean; error?: string };

// Invita a un nuevo usuario a la organización del admin actual. Usa el cliente
// service-role (createAdminClient) SOLO tras verificar que el llamante es admin
// de su organización; el org_id se toma del perfil, nunca del formulario.
export async function inviteTeamUser(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede invitar usuarios." };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const admin = createAdminClient();
  const res = await inviteOrgUser(admin, {
    email: parsed.data.email,
    fullName: parsed.data.fullName,
    orgId: profile.orgId,
    role: parsed.data.role as Role,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/ajustes");
  return { ok: true };
}

// Activa/desactiva a un usuario de la organización (soft, reversible). No libera
// el cupo de Supabase; para eso habría que borrar la cuenta de auth.
export async function setUserActive(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede gestionar usuarios." };
  }
  if (userId === profile.userId) {
    return { ok: false, error: "No puedes desactivar tu propia cuenta." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ active })
    .eq("id", userId)
    .eq("org_id", profile.orgId); // candado: solo dentro de su organización
  if (error) {
    console.error("setUserActive:", error.message);
    return { ok: false, error: "No se pudo actualizar el usuario." };
  }

  revalidatePath("/ajustes");
  return { ok: true };
}

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
