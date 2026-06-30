"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

// Se llega aquí con una sesión de recuperación activa (el callback ya la creó).
export default function RestablecerPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

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
      setError("No se pudo actualizar la contraseña. Solicita un nuevo enlace.");
      setLoading(false);
      return;
    }
    setDone(true);
    setLoading(false);
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 1500);
  }

  return (
    <Card className="p-6">
      {done ? (
        <p className="text-center text-sm text-slate-600">
          Contraseña actualizada. Redirigiendo…
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-slate-600">Define tu nueva contraseña.</p>
          <Field
            label="Nueva contraseña"
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
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Guardando…" : "Guardar contraseña"}
          </Button>
        </form>
      )}
    </Card>
  );
}
