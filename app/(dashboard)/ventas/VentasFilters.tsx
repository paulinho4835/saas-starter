"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";

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

  function update<K extends keyof FilterValues>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function onFiltrar() {
    const params = new URLSearchParams();
    if (values.code) params.set("code", values.code);
    if (values.application) params.set("application", values.application);
    if (values.brandId) params.set("brandId", values.brandId);
    if (values.mi) params.set("mi", values.mi);
    if (values.me) params.set("me", values.me);
    if (values.alt) params.set("alt", values.alt);
    if (values.pest) params.set("pest", values.pest);
    if (values.tope) params.set("tope", values.tope);
    const qs = params.toString();
    router.push(qs ? `/ventas?${qs}` : "/ventas");
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm">
        <FieldLabel>Aplicación</FieldLabel>
        <input
          type="text"
          value={values.application}
          onChange={(e) => update("application", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Código</FieldLabel>
        <input
          type="text"
          value={values.code}
          onChange={(e) => update("code", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="col-span-2 block text-sm">
        <FieldLabel>Marca</FieldLabel>
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
        <FieldLabel>ME</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.me}
          onChange={(e) => update("me", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>MI</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.mi}
          onChange={(e) => update("mi", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Altura</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.alt}
          onChange={(e) => update("alt", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Pestaña</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.pest}
          onChange={(e) => update("pest", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="col-span-2 block text-sm">
        <FieldLabel>Tope</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.tope}
          onChange={(e) => update("tope", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <Button type="button" className="col-span-1" onClick={onFiltrar}>
        Filtrar
      </Button>
      <ButtonLink variant="secondary" className="col-span-1 text-center" href="/ventas">
        Limpiar
      </ButtonLink>
    </div>
  );
}
