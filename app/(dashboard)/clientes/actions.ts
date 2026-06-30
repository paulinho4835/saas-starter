"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";

// ── Esquema de validación ────────────────────────────────────────────────────
const customerSchema = z.object({
  full_name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  email: z.string().trim().email("Correo inválido.").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export type ActionResult = { ok: boolean; error?: string };

// Crea un cliente. Defensa en profundidad: además de la RLS, comprobamos el rol y
// rellenamos org_id desde el perfil (nunca confiamos en un org_id del cliente).
export async function createCustomer(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "clientes:write")) {
    return { ok: false, error: "No tienes permiso para crear clientes." };
  }

  const parsed = customerSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({
    org_id: profile.orgId,
    full_name: parsed.data.full_name,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
  });
  if (error) {
    console.error("createCustomer:", error.message);
    return { ok: false, error: "No se pudo crear el cliente." };
  }

  revalidatePath("/clientes");
  return { ok: true };
}

// Borra un cliente. Solo roles con permiso de borrado. La RLS confirma que el
// cliente pertenece a la organización del usuario.
export async function deleteCustomer(id: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "clientes:delete")) {
    return { ok: false, error: "No tienes permiso para eliminar clientes." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) {
    console.error("deleteCustomer:", error.message);
    return { ok: false, error: "No se pudo eliminar el cliente." };
  }

  revalidatePath("/clientes");
  return { ok: true };
}
