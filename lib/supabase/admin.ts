import "server-only";
import { createClient } from "@supabase/supabase-js";

// Cliente service_role: BYPASSA RLS. Úsalo SOLO en server actions del panel
// /superadmin, nunca expuesto al cliente ni a rutas de organización.
// Permite al dueño del SaaS gestionar TODAS las organizaciones (crear, togglear
// módulos, dar de alta usuarios) sin pelear con las policies de aislamiento.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurada");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
