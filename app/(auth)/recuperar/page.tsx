"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function RecuperarPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const origin = window.location.origin;
    // El enlace del correo lleva a /auth/callback, que canjea el código y
    // redirige a /restablecer para definir la nueva contraseña.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/restablecer`,
    });
    // Mensaje genérico siempre (anti-enumeración de cuentas).
    setSent(true);
    setLoading(false);
  }

  return (
    <Card className="p-6">
      {sent ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-slate-600">
            Si existe una cuenta con ese correo, te enviamos un enlace para
            restablecer tu contraseña. Revisa tu bandeja de entrada.
          </p>
          <Link href="/login" className="text-sm text-brand hover:underline">
            Volver al inicio de sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-slate-600">
            Ingresa tu correo y te enviaremos un enlace para restablecer tu
            contraseña.
          </p>
          <Field
            label="Correo"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Enviando…" : "Enviar enlace"}
          </Button>
          <p className="text-center text-sm">
            <Link href="/login" className="text-brand hover:underline">
              Volver al inicio de sesión
            </Link>
          </p>
        </form>
      )}
    </Card>
  );
}
