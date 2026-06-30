import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rutas que NO requieren sesión. Todo lo demás exige estar autenticado.
// - "/login", "/recuperar", "/restablecer": flujo de autenticación.
// - "/bienvenida": el invitado define su contraseña desde el enlace del correo.
// - "/auth/callback": canjea el código/token del correo por sesión.
// - "/terminos", "/privacidad": documentos legales públicos.
// - "/p": ejemplo de formularios públicos por token (sin sesión).
const PUBLIC_PATHS = [
  "/login",
  "/recuperar",
  "/restablecer",
  "/bienvenida",
  "/auth/callback",
  "/terminos",
  "/privacidad",
  "/p",
];

// Páginas de autenticación: si ya hay sesión, redirigir al panel. NO incluye
// "/restablecer": un usuario con sesión de recuperación debe poder completar el
// cambio de contraseña.
const AUTH_PAGES = ["/login"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/api/"); // Las API routes manejan su propio auth.

  if (!isPublic && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Si ya tiene sesión y va a /login, redirigir al panel.
  if (user && AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
