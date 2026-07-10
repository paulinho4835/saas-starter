import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, getProfile } from "@/lib/auth";
import { normalizeFeatures, type Features } from "@/lib/features";

// ¿El usuario autenticado es operador de la plataforma (dueño del SaaS)?
// Lee platform_admins con la sesión del usuario (policy self-select).
// Usa getAuthUser() (cacheado) en vez de su propio auth.getUser() para no
// repetir ese round-trip si getProfile()/getOrgFeatures() ya lo pidieron
// dentro del mismo request.
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getAuthUser();
  if (!user) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return !!data;
});

// Feature flags de la organización del usuario actual. Cacheado por request.
// Reusa getProfile() (que ya trae organizations(features)) en vez de repetir
// la consulta a profiles.
export const getOrgFeatures = cache(async (): Promise<Features> => {
  const profile = await getProfile();
  return normalizeFeatures(profile?.orgFeatures ?? null);
});
