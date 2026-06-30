import { redirect } from "next/navigation";
import { getOrgFeatures } from "@/lib/superadmin";
import type { FeatureKey } from "@/lib/features";
import { getProfile } from "@/lib/auth";
import { canSeeNav } from "@/lib/rbac";

// Bloquea el acceso directo (por URL) a un módulo apagado para la organización.
// El menú ya lo oculta; esto cierra la puerta de entrar a mano a /items, etc.
export async function requireFeature(key: FeatureKey) {
  const features = await getOrgFeatures();
  if (!features[key]) redirect("/dashboard");
}

// Verifica feature habilitada Y que el rol del usuario pueda ver ese módulo.
// Usar en lugar de requireFeature() para módulos con restricción por rol.
export async function requireNavAccess(key: FeatureKey) {
  const [features, profile] = await Promise.all([getOrgFeatures(), getProfile()]);
  if (!features[key] || !canSeeNav(profile?.role, key)) redirect("/dashboard");
}
