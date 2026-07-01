"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";

const supplierSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  contact_name: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type ActionResult = { ok: boolean; error?: string };

export async function createSupplier(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "proveedores:write")) {
    return { ok: false, error: "No tienes permiso para crear proveedores." };
  }

  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    contact_name: formData.get("contact_name"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({
    org_id: profile.orgId,
    name: parsed.data.name,
    phone: parsed.data.phone || null,
    contact_name: parsed.data.contact_name || null,
    notes: parsed.data.notes || null,
  });
  if (error) {
    console.error("createSupplier:", error.message);
    if (error.code === "23505") {
      return { ok: false, error: "Ya existe un proveedor con ese nombre." };
    }
    return { ok: false, error: "No se pudo crear el proveedor." };
  }

  revalidatePath("/proveedores");
  return { ok: true };
}

export async function deleteSupplier(id: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "proveedores:write")) {
    return { ok: false, error: "No tienes permiso para eliminar proveedores." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) {
    console.error("deleteSupplier:", error.message);
    return { ok: false, error: "No se pudo eliminar el proveedor." };
  }

  revalidatePath("/proveedores");
  return { ok: true };
}
