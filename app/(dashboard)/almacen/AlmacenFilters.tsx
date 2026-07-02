"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { fieldInputClass } from "@/components/ui/Field";

// Filtro dinámico: cada tecleo actualiza la URL (debounced) y Next.js vuelve
// a pedir la página del servidor con los nuevos searchParams — mismo patrón
// que app/(dashboard)/ventas/VentasFilters.tsx.
const DEBOUNCE_MS = 300;

type Brand = { id: string; name: string };

type FilterValues = {
  code: string;
  application: string;
  brandId: string;
};

export function AlmacenFilters({
  brands,
  initial,
}: {
  brands: Brand[];
  initial: FilterValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function scheduleNavigate(next: FilterValues) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (next.code) params.set("code", next.code);
      if (next.application) params.set("application", next.application);
      if (next.brandId) params.set("brandId", next.brandId);
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `/almacen?${qs}` : "/almacen", { scroll: false });
      });
    }, DEBOUNCE_MS);
  }

  function update<K extends keyof FilterValues>(key: K, value: string) {
    const next = { ...values, [key]: value };
    setValues(next);
    scheduleNavigate(next);
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Código</span>
          <input
            type="text"
            value={values.code}
            onChange={(e) => update("code", e.target.value)}
            className={fieldInputClass}
            autoFocus
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Aplicación</span>
          <input
            type="text"
            value={values.application}
            onChange={(e) => update("application", e.target.value)}
            className={fieldInputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Marca</span>
          <select
            value={values.brandId}
            onChange={(e) => update("brandId", e.target.value)}
            className={fieldInputClass}
          >
            <option value="">Todas</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <span className="pb-2 text-xs text-slate-400" aria-live="polite">
          {isPending ? "Buscando…" : ""}
        </span>
      </div>
    </Card>
  );
}
