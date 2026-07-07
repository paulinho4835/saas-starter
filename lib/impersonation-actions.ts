"use server";

import { cookies } from "next/headers";
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
