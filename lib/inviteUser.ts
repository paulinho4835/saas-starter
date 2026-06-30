import { headers } from "next/headers";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/rbac";

// Origen absoluto de la app, para construir el redirectTo del enlace de invitación
// (debe ser una URL absoluta y estar en la allowlist de Supabase).
async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

type InviteInput = {
  email: string;
  fullName: string;
  orgId: string;
  role: Role;
};

type InviteResult = { ok: true; userId: string } | { ok: false; error: string };

// Crea una cuenta por INVITACIÓN (sin contraseña) y su perfil en la organización.
// Supabase envía el correo con el enlace; el usuario define su propia contraseña
// en /bienvenida. Si el insert del perfil falla, revierte el usuario de auth.
// El cliente admin lo provee el caller (que puede tener su propio rollback, p. ej.
// borrar la organización recién creada).
export async function inviteOrgUser(
  admin: ReturnType<typeof createAdminClient>,
  { email, fullName, orgId, role }: InviteInput,
): Promise<InviteResult> {
  const origin = await appOrigin();

  const { data: invited, error: inviteErr } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/bienvenida`,
      data: { full_name: fullName },
    });
  if (inviteErr || !invited.user) {
    return {
      ok: false,
      error: inviteErr?.message ?? "No se pudo enviar la invitación.",
    };
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: invited.user.id,
    org_id: orgId,
    role,
    full_name: fullName,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(invited.user.id); // rollback
    return { ok: false, error: `No se pudo crear el perfil: ${profErr.message}` };
  }

  return { ok: true, userId: invited.user.id };
}
