"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { acceptTerms } from "@/app/(dashboard)/terms-actions";

// Aviso bloqueante: el admin debe aceptar los Términos antes de operar. Se
// muestra en el primer ingreso y cada vez que LEGAL_VERSION cambia.
export function TermsGate({ orgName }: { orgName: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setLoading(true);
    setError(null);
    const res = await acceptTerms();
    if (!res.ok) {
      setError(res.error ?? "No se pudo registrar la aceptación.");
      setLoading(false);
      return;
    }
    window.location.reload();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="max-w-md p-6">
        <h1 className="text-lg font-bold text-slate-800">
          Términos y Condiciones
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Antes de usar la plataforma con <strong>{orgName}</strong>, revisa y
          acepta nuestros{" "}
          <Link href="/terminos" target="_blank" className="text-brand hover:underline">
            Términos
          </Link>{" "}
          y la{" "}
          <Link href="/privacidad" target="_blank" className="text-brand hover:underline">
            Política de Privacidad
          </Link>
          .
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <Button onClick={onAccept} disabled={loading} className="mt-4 w-full">
          {loading ? "Registrando…" : "Acepto los Términos"}
        </Button>
      </Card>
    </main>
  );
}
