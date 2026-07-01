import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/rbac";

export interface CurrentProfile {
  userId: string;
  orgId: string;
  role: Role;
  fullName: string;
  branchId: string | null;
}

// Perfil del usuario autenticado (org_id + rol + sucursal). Cacheado por request.
// RLS sigue siendo la fuente de verdad; esto sirve para gates de UI y para
// rellenar org_id/branch_id en inserts (defensa en profundidad).
export const getProfile = cache(async (): Promise<CurrentProfile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role, full_name, branch_id")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  return {
    userId: user.id,
    orgId: profile.org_id,
    role: profile.role as Role,
    fullName: profile.full_name,
    branchId: profile.branch_id,
  };
});
