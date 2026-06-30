"use server";

import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LEGAL_VERSION } from "@/lib/legal";

// Registra la aceptación de los Términos por el admin de la organización. Solo el
// rol 'admin' acepta (en nombre de toda la organización). La policy de RLS
// permite que el admin actualice su propia fila.
export async function acceptTerms(): Promise<{ ok: boolean; error?: string }> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return {
      ok: false,
      error: "Solo el administrador de la organización acepta los términos.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      terms_accepted_at: new Date().toISOString(),
      terms_accepted_version: LEGAL_VERSION,
    })
    .eq("id", profile.userId);

  if (error) {
    console.error("acceptTerms:", error.message);
    return {
      ok: false,
      error: "No se pudo registrar la aceptación. Intenta de nuevo.",
    };
  }
  return { ok: true };
}
