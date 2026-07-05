import { cookies } from "next/headers";

// Nombres de cookie compartidos entre el server action que arranca/termina
// la impersonación (app/(dashboard)/superadmin/actions.ts) y este lector de
// solo lectura, seguro de llamar desde un Server Component (el layout).
export const IMPERSONATION_RETURN_TOKEN_COOKIE = "imp_return_token";
export const IMPERSONATION_ORG_NAME_COOKIE = "imp_org_name";

// Nombre de la organización que se está impersonando, o null si no aplica.
// Solo lectura — seguro desde un Server Component (no intenta escribir cookies).
export async function getImpersonationOrgName(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(IMPERSONATION_ORG_NAME_COOKIE)?.value ?? null;
}
