"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin } from "@/lib/superadmin";
import { inviteOrgUser } from "@/lib/inviteUser";
import {
  IMPERSONATION_ORG_NAME_COOKIE,
  IMPERSONATION_RETURN_TOKEN_COOKIE,
} from "@/lib/impersonation";
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

const IMPERSONATION_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// "Ver como": intercambia la sesión del navegador del superadmin por la del
// admin real de la organización destino, así TODAS las páginas del dashboard
// funcionan sin cambios (RLS filtra por auth.uid() real, no por una bandera
// de la app). Ver docs/superpowers/specs/2026-07-05-impersonacion-superadmin-design.md
export async function startImpersonation(orgId: string): Promise<ActionResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "No autorizado." };
  }

  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .single();
  if (!org) return { ok: false, error: "Organización no encontrada." };

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("role", "admin")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!targetProfile) {
    return { ok: false, error: "Esta organización no tiene un administrador activo." };
  }

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(targetProfile.id);
  if (userErr || !userData?.user?.email) {
    return { ok: false, error: "No se pudo resolver el correo del administrador destino." };
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    return { ok: false, error: "No se pudo generar el acceso." };
  }

  // Guardar cómo volver ANTES de reemplazar la sesión.
  const supabase = await createClient();
  const {
    data: { session: currentSession },
  } = await supabase.auth.getSession();
  if (!currentSession) {
    return { ok: false, error: "Sesión no válida." };
  }
  const platformAdminId = currentSession.user.id;

  const cookieStore = await cookies();
  cookieStore.set(
    IMPERSONATION_RETURN_TOKEN_COOKIE,
    currentSession.refresh_token,
    IMPERSONATION_COOKIE_OPTS,
  );
  cookieStore.set(IMPERSONATION_ORG_NAME_COOKIE, org.name, {
    ...IMPERSONATION_COOKIE_OPTS,
    httpOnly: false,
  });

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyErr) {
    cookieStore.delete(IMPERSONATION_RETURN_TOKEN_COOKIE);
    cookieStore.delete(IMPERSONATION_ORG_NAME_COOKIE);
    return { ok: false, error: "No se pudo iniciar la impersonación." };
  }

  await admin.from("impersonation_log").insert({
    platform_admin_id: platformAdminId,
    target_org_id: orgId,
    target_profile_id: targetProfile.id,
  });

  redirect("/dashboard");
}

// Cierra la impersonación activa y restaura la sesión del superadmin.
export async function endImpersonation(): Promise<void> {
  const cookieStore = await cookies();
  const returnToken = cookieStore.get(IMPERSONATION_RETURN_TOKEN_COOKIE)?.value;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const admin = createAdminClient();
    await admin
      .from("impersonation_log")
      .update({ ended_at: new Date().toISOString() })
      .eq("target_profile_id", user.id)
      .is("ended_at", null);
  }

  cookieStore.delete(IMPERSONATION_RETURN_TOKEN_COOKIE);
  cookieStore.delete(IMPERSONATION_ORG_NAME_COOKIE);

  if (returnToken) {
    const { error } = await supabase.auth.refreshSession({ refresh_token: returnToken });
    if (error) await supabase.auth.signOut();
  } else {
    await supabase.auth.signOut();
  }

  redirect("/superadmin");
}
