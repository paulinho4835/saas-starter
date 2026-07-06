"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ASSIGNABLE_MODULES, type AssignableModuleKey } from "@/lib/features";

const createUserSchema = z.object({
  email: z.string().trim().email("Correo inválido."),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
  fullName: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  role: z.enum(["admin", "manager", "member", "viewer"]),
  branchId: z.string().trim().optional(),
});

export type ActionResult = { ok: boolean; error?: string };

// Crea un usuario del equipo con la contraseña que define el admin (no envía
// correo ni invitación: el admin le entrega la contraseña directamente al
// trabajador). Usa el cliente service-role SOLO tras verificar que el llamante
// es admin de su organización; el org_id se toma del perfil, nunca del formulario.
export async function createTeamUser(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede crear usuarios." };
  }

  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
    branchId: formData.get("branchId") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const admin = createAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  });
  if (createErr || !created.user) {
    return { ok: false, error: createErr?.message ?? "No se pudo crear el usuario." };
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    org_id: profile.orgId,
    role: parsed.data.role,
    full_name: parsed.data.fullName,
    branch_id: parsed.data.branchId || null,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id); // rollback
    return { ok: false, error: `No se pudo crear el perfil: ${profErr.message}` };
  }

  revalidatePath("/usuarios");
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

  revalidatePath("/usuarios");
  return { ok: true };
}

// Asigna (o quita) la sucursal fija de un vendedor. Solo el admin, y solo
// dentro de su propia organización.
export async function setUserBranch(
  userId: string,
  branchId: string | null,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede asignar sucursales." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ branch_id: branchId })
    .eq("id", userId)
    .eq("org_id", profile.orgId);
  if (error) {
    console.error("setUserBranch:", error.message);
    return { ok: false, error: "No se pudo actualizar la sucursal del usuario." };
  }

  revalidatePath("/usuarios");
  return { ok: true };
}

const ASSIGNABLE_KEY_SET = new Set(ASSIGNABLE_MODULES.map((m) => m.key));

const modulesSchema = z
  .array(z.string())
  .nullable()
  .refine(
    (arr) => arr === null || arr.every((k) => ASSIGNABLE_KEY_SET.has(k as AssignableModuleKey)),
    { message: "Módulo inválido." },
  );

// Guarda el override de módulos visibles de un usuario. `null` = sin override
// (el usuario vuelve a ver todo lo que su rol permite). El admin no puede
// editar sus propios permisos (evita que se bloquee a sí mismo el acceso).
export async function setUserModules(
  userId: string,
  modules: AssignableModuleKey[] | null,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede asignar permisos." };
  }
  if (userId === profile.userId) {
    return { ok: false, error: "No puedes editar tus propios permisos." };
  }

  const parsed = modulesSchema.safeParse(modules);
  if (!parsed.success) {
    return { ok: false, error: "Lista de módulos inválida." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ allowed_modules: parsed.data })
    .eq("id", userId)
    .eq("org_id", profile.orgId);
  if (error) {
    console.error("setUserModules:", error.message);
    return { ok: false, error: "No se pudo actualizar los permisos." };
  }

  revalidatePath("/usuarios");
  return { ok: true };
}
