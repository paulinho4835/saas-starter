import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/rbac";
import type { AssignableModuleKey } from "@/lib/features";

export interface CurrentProfile {
  userId: string;
  orgId: string;
  role: Role;
  fullName: string;
  branchId: string | null;
  allowedModules: AssignableModuleKey[] | null;
  active: boolean;
  termsAcceptedAt: string | null;
  termsAcceptedVersion: string | null;
  orgName: string | null;
  orgFeatures: unknown;
  orgActive: boolean;
}

// Sesión del usuario autenticado. Cacheada por request (React `cache()`) para
// que getProfile/isPlatformAdmin/getOrgFeatures no repitan cada una su propio
// round-trip a Supabase Auth dentro del mismo render — comparten esta misma
// llamada memoizada.
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// Perfil del usuario autenticado (org_id + rol + sucursal + datos de la
// organización). Cacheado por request. RLS sigue siendo la fuente de verdad;
// esto sirve para gates de UI y para rellenar org_id/branch_id en inserts
// (defensa en profundidad).
export const getProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "org_id, role, full_name, branch_id, allowed_modules, active, terms_accepted_at, terms_accepted_version, organizations(name, features, active)",
    )
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  const org = profile.organizations as
    | { name?: string; features?: unknown; active?: boolean }
    | null;

  return {
    userId: user.id,
    orgId: profile.org_id,
    role: profile.role as Role,
    fullName: profile.full_name,
    branchId: profile.branch_id,
    allowedModules: (profile.allowed_modules as AssignableModuleKey[] | null) ?? null,
    active: profile.active ?? true,
    termsAcceptedAt: profile.terms_accepted_at ?? null,
    termsAcceptedVersion: profile.terms_accepted_version ?? null,
    orgName: org?.name ?? null,
    orgFeatures: org?.features ?? null,
    orgActive: org?.active ?? true,
  };
});
