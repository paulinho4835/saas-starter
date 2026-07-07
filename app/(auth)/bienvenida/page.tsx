"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

// El usuario llega aquí desde el enlace de invitación del correo. El callback ya
// canjeó el token por sesión; aquí define su contraseña por primera vez.
export default function BienvenidaPage() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setHasSession(!!data.user));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError("No se pudo definir la contraseña. Solicita una nueva invitación.");
      setLoading(false);
      return;
    }
    window.location.href = "/ventas";
  }

  if (hasSession === false) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-slate-600">
          Este enlace de invitación no es válido o ya expiró. Pide al
          administrador que te envíe una nueva invitación.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          ¡Bienvenido! Define tu contraseña para activar tu cuenta.
        </p>
        <Field
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Confirmar contraseña"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button
          type="submit"
          disabled={loading || hasSession === null}
          className="w-full"
        >
          {loading ? "Activando…" : "Activar cuenta"}
        </Button>
      </form>
    </Card>
  );
}
