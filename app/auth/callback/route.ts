import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Canjea el enlace del correo por una sesión y redirige a `next`.
// Soporta dos formatos:
//   - PKCE: ?code=...           (recuperación de contraseña, OAuth)
//   - OTP:  ?token_hash=&type=  (invitación de usuario, magic link)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "invite" | "recovery" | "email" | "magiclink" | "signup",
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Falló el canje: de vuelta al login con un marcador de error.
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
