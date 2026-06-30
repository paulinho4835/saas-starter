import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { normalizeFeatures, type Features } from "@/lib/features";

// ¿El usuario autenticado es operador de la plataforma (dueño del SaaS)?
// Lee platform_admins con la sesión del usuario (policy self-select).
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return !!data;
});

// Feature flags de la organización del usuario actual. Cacheado por request.
export const getOrgFeatures = cache(async (): Promise<Features> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return normalizeFeatures(null);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organizations(features)")
    .eq("id", user.id)
    .single();

  const raw = (profile?.organizations as { features?: unknown } | null)?.features;
  return normalizeFeatures(raw);
});
