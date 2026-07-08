"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { calculatePrices } from "@/lib/pricing";
import { createProduct } from "@/app/(dashboard)/productos/actions";

type CatalogOption = { id: string; name: string };

export function ProductRegistrationForm({
  brands,
  families,
  origins,
  suppliers,
  branches,
  exchangeRate,
}: {
  brands: CatalogOption[];
  families: CatalogOption[];
  origins: CatalogOption[];
  suppliers: CatalogOption[];
  branches: CatalogOption[];
  exchangeRate: number;
}) {
  const [formKey, setFormKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [costUsd, setCostUsd] = useState("");
  const [marginSf, setMarginSf] = useState("");
  const [marginMay, setMarginMay] = useState("");
  const router = useRouter();

  const preview = useMemo(() => {
    if (costUsd === "" || marginSf === "" || marginMay === "") return null;
    const cost = Number(costUsd);
    const sf = Number(marginSf);
    const may = Number(marginMay);
    if (![cost, sf, may].every((n) => Number.isFinite(n))) return null;
    return calculatePrices({ costUsd: cost, exchangeRate, marginSfPct: sf, marginMayPct: may });
  }, [costUsd, exchangeRate, marginMay, marginSf]);

  const costBs = preview ? (Number(costUsd) * exchangeRate).toFixed(2) : "";

  function reset() {
    setCostUsd("");
    setMarginSf("");
    setMarginMay("");
    setFormKey((k) => k + 1);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const res = await createProduct(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo registrar el producto.", "error");
      return;
    }
    toast("Producto registrado.");
    reset();
    router.refresh();
  }

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Registro de Productos</h3>
      <form key={formKey} onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-6">
          <Field label="Código" name="code" required />
          <Field label="Interno (mm)" name="internal_mm" type="number" step="0.01" />
          <Field label="Externo (mm)" name="external_mm" type="number" step="0.01" />
          <Field label="Altura (mm)" name="height_mm" type="number" step="0.01" />
          <Field label="Pestaña (mm)" name="flange_mm" type="number" step="0.01" />
          <Field label="Tope (mm)" name="stop_mm" type="number" step="0.01" />
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Marca" name="brand" required list="brands-datalist" placeholder="Escribe o elige…" />
          <Field
            label="Familia"
            name="family"
            required
            list="families-datalist"
            placeholder="Escribe o elige…"
          />
          <Field label="Procedencia" name="origin" list="origins-datalist" placeholder="Escribe o elige…" />
          <label className="block text-sm">
            <FieldLabel>Proveedor</FieldLabel>
            <select name="supplier_id" defaultValue="" className={fieldInputClass}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <datalist id="brands-datalist">
          {brands.map((b) => (
            <option key={b.id} value={b.name} />
          ))}
        </datalist>
        <datalist id="families-datalist">
          {families.map((f) => (
            <option key={f.id} value={f.name} />
          ))}
        </datalist>
        <datalist id="origins-datalist">
          {origins.map((o) => (
            <option key={o.id} value={o.name} />
          ))}
        </datalist>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <FieldLabel>Sucursal</FieldLabel>
            <select name="branch_id" required defaultValue="" className={fieldInputClass}>
              <option value="" disabled>
                Selecciona…
              </option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Cantidad" name="quantity" type="number" min={0} defaultValue={0} required />
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          <Field
            label="Costo $"
            name="cost_usd"
            type="number"
            step="0.01"
            required
            value={costUsd}
            onChange={(e) => setCostUsd(e.target.value)}
          />
          <label className="block text-sm">
            <FieldLabel>T. Cambio</FieldLabel>
            <input type="text" disabled value={exchangeRate} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <FieldLabel>Costo Bs</FieldLabel>
            <input type="text" disabled value={costBs} className={fieldInputClass} />
          </label>
          <Field
            label="SF %"
            name="margin_sf_pct"
            type="number"
            step="0.01"
            required
            value={marginSf}
            onChange={(e) => setMarginSf(e.target.value)}
          />
          <Field
            label="MAY %"
            name="margin_may_pct"
            type="number"
            step="0.01"
            required
            value={marginMay}
            onChange={(e) => setMarginMay(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <FieldLabel>SF Bs</FieldLabel>
            <input type="text" disabled value={preview?.priceSfBs ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <FieldLabel>CF Bs (% {preview ? preview.marginCfPct : "—"})</FieldLabel>
            <input type="text" disabled value={preview?.priceCfBs ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <FieldLabel>MAY Bs</FieldLabel>
            <input type="text" disabled value={preview?.priceMayBs ?? ""} className={fieldInputClass} />
          </label>
        </div>

        <label className="block text-sm">
          <FieldLabel>Aplicación</FieldLabel>
          <textarea name="application" rows={2} className={fieldInputClass} />
        </label>

        <label className="block text-sm">
          <FieldLabel>Notas</FieldLabel>
          <textarea name="notes" rows={2} className={fieldInputClass} />
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={reset}>
            Limpiar Campos
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Guardando…" : "Registrar Producto"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
