"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { fieldInputClass } from "@/components/ui/Field";

// Filtro dinámico: cada tecleo actualiza la URL (debounced) y Next.js
// vuelve a pedir la página del servidor con los nuevos searchParams — sin
// recarga completa, así la búsqueda "aparece sola" mientras se escribe.
const DEBOUNCE_MS = 300;

type Brand = { id: string; name: string };

type FilterValues = {
  code: string;
  application: string;
  brandId: string;
  mi: string;
  me: string;
  alt: string;
  pest: string;
  tope: string;
};

export function VentasFilters({
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
      if (next.mi) params.set("mi", next.mi);
      if (next.me) params.set("me", next.me);
      if (next.alt) params.set("alt", next.alt);
      if (next.pest) params.set("pest", next.pest);
      if (next.tope) params.set("tope", next.tope);
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `/ventas?${qs}` : "/ventas", { scroll: false });
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
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">MI</span>
          <input
            type="number"
            step="0.01"
            value={values.mi}
            onChange={(e) => update("mi", e.target.value)}
            className={`${fieldInputClass} w-24`}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">ME</span>
          <input
            type="number"
            step="0.01"
            value={values.me}
            onChange={(e) => update("me", e.target.value)}
            className={`${fieldInputClass} w-24`}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Altura</span>
          <input
            type="number"
            step="0.01"
            value={values.alt}
            onChange={(e) => update("alt", e.target.value)}
            className={`${fieldInputClass} w-24`}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Pestaña</span>
          <input
            type="number"
            step="0.01"
            value={values.pest}
            onChange={(e) => update("pest", e.target.value)}
            className={`${fieldInputClass} w-24`}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Tope</span>
          <input
            type="number"
            step="0.01"
            value={values.tope}
            onChange={(e) => update("tope", e.target.value)}
            className={`${fieldInputClass} w-24`}
          />
        </label>
        <span
          className="pb-2 text-xs text-slate-400"
          aria-live="polite"
        >
          {isPending ? "Buscando…" : ""}
        </span>
      </div>
    </Card>
  );
}
