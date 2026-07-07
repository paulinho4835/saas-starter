"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  IMPERSONATION_ORG_NAME_COOKIE,
  IMPERSONATION_RETURN_TOKEN_COOKIE,
} from "@/lib/impersonation";

// Limpia las cookies de impersonación en cualquier cierre de sesión normal
// (no solo el botón "Salir" del banner). Sin esto, si un superadmin usa "Ver
// como" y luego cierra sesión con el botón normal en vez de "Salir", la
// cookie queda pegada en el navegador y se le muestra a la siguiente cuenta
// que inicie sesión ahí.
export async function clearImpersonationCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_RETURN_TOKEN_COOKIE);
  cookieStore.delete(IMPERSONATION_ORG_NAME_COOKIE);
}

// Cierra sesión enteramente en el servidor. Antes el botón llamaba
// supabase.auth.signOut() desde el navegador y recién después navegaba con
// window.location.href — dos pasos separados con una carrera: si la
// limpieza de la cookie de sesión no alcanzaba a completarse antes de que
// el middleware evaluara /login, este veía la cookie vieja todavía válida y
// rebotaba de vuelta a /ventas (parecía que "cerrar sesión" no hacía nada,
// hasta un F5 posterior). Al hacerlo todo en una Server Action, el signOut()
// y el redirect van en la MISMA respuesta HTTP: la cookie ya está limpia
// cuando el navegador sigue la redirección, sin ventana para la carrera.
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_RETURN_TOKEN_COOKIE);
  cookieStore.delete(IMPERSONATION_ORG_NAME_COOKIE);
  redirect("/login");
}
