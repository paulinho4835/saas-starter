"use client";

import { useState } from "react";
import { endImpersonation } from "@/app/(dashboard)/superadmin/actions";

// Solo se renderiza (desde app/(dashboard)/layout.tsx) cuando existe la
// cookie de impersonación en ESTE navegador — el negocio impersonado nunca
// la ve, porque nunca corre en su sesión/dispositivo.
export function ImpersonationBanner({ orgName }: { orgName: string }) {
  const [loading, setLoading] = useState(false);

  async function onExit() {
    setLoading(true);
    await endImpersonation();
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
      <span>Viendo como: {orgName}</span>
      <button
        type="button"
        onClick={onExit}
        disabled={loading}
        className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30 disabled:opacity-50"
      >
        {loading ? "Saliendo…" : "Salir"}
      </button>
    </div>
  );
}
