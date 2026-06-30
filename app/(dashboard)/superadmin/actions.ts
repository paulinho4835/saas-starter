"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin } from "@/lib/superadmin";
import { inviteOrgUser } from "@/lib/inviteUser";
import type { FeatureKey } from "@/lib/features";

export type ActionResult = { ok: boolean; error?: string };

const createOrgSchema = z.object({
  orgName: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  adminEmail: z.string().trim().email("Correo inválido."),
  adminName: z.string().trim().min(1, "El nombre del admin es obligatorio.").max(120),
});

// Crea una organización nueva e invita a su primer administrador. Si la
// invitación falla, revierte la organización (no dejar huérfanas).
export async function createOrg(formData: FormData): Promise<ActionResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = createOrgSchema.safeParse({
    orgName: formData.get("orgName"),
    adminEmail: formData.get("adminEmail"),
    adminName: formData.get("adminName"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const admin = createAdminClient();
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: parsed.data.orgName, features: {} })
    .select("id")
    .single();
  if (orgErr || !org) {
    console.error("createOrg:", orgErr?.message);
    return { ok: false, error: "No se pudo crear la organización." };
  }

  const res = await inviteOrgUser(admin, {
    email: parsed.data.adminEmail,
    fullName: parsed.data.adminName,
    orgId: org.id,
    role: "admin",
  });
  if (!res.ok) {
    await admin.from("organizations").delete().eq("id", org.id); // rollback
    return { ok: false, error: res.error };
  }

  revalidatePath("/superadmin");
  return { ok: true };
}

// Enciende/apaga un feature (addon) de una organización en su jsonb `features`.
export async function toggleFeature(
  orgId: string,
  key: FeatureKey,
  enabled: boolean,
): Promise<ActionResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "No autorizado." };
  }

  const admin = createAdminClient();
  const { data: org, error: readErr } = await admin
    .from("organizations")
    .select("features")
    .eq("id", orgId)
    .single();
  if (readErr || !org) {
    return { ok: false, error: "Organización no encontrada." };
  }

  const features = { ...(org.features as Record<string, unknown>), [key]: enabled };
  const { error } = await admin
    .from("organizations")
    .update({ features })
    .eq("id", orgId);
  if (error) {
    console.error("toggleFeature:", error.message);
    return { ok: false, error: "No se pudo actualizar el módulo." };
  }

  revalidatePath("/superadmin");
  return { ok: true };
}

// Suspende/reactiva una organización (bloquea el acceso a todos sus usuarios).
export async function setOrgActive(
  orgId: string,
  active: boolean,
): Promise<ActionResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "No autorizado." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ active })
    .eq("id", orgId);
  if (error) {
    return { ok: false, error: "No se pudo actualizar la organización." };
  }
  revalidatePath("/superadmin");
  return { ok: true };
}
