"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { calculatePrices } from "@/lib/pricing";
import {
  createProduct,
  updateProduct,
  updateProductStock,
} from "@/app/(dashboard)/productos/actions";

type CatalogOption = { id: string; name: string };

type ProductDetail = {
  id: string;
  code: string;
  brand_id: string;
  family_id: string;
  origin_id: string | null;
  supplier_id: string | null;
  internal_mm: number | null;
  external_mm: number | null;
  height_mm: number | null;
  flange_mm: number | null;
  stop_mm: number | null;
  application: string | null;
  notes: string | null;
  cost_usd: number | null;
  margin_sf_pct: number | null;
  margin_cf_pct: number | null;
  margin_may_pct: number | null;
};

type StockRow = { branch_id: string; branch_name: string; quantity: number };

export function ProductFormModal({
  mode,
  product,
  stock,
  brands,
  families,
  origins,
  suppliers,
  branches,
  exchangeRate,
}: {
  mode: "create" | "edit";
  product?: ProductDetail;
  stock?: StockRow[];
  brands: CatalogOption[];
  families: CatalogOption[];
  origins: CatalogOption[];
  suppliers: CatalogOption[];
  branches: CatalogOption[];
  exchangeRate: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const [costUsd, setCostUsd] = useState(product?.cost_usd?.toString() ?? "");
  const [marginSf, setMarginSf] = useState(product?.margin_sf_pct?.toString() ?? "");
  const [marginCf, setMarginCf] = useState(product?.margin_cf_pct?.toString() ?? "");
  const [marginMay, setMarginMay] = useState(product?.margin_may_pct?.toString() ?? "");

  const preview = useMemo(() => {
    if (costUsd === "" || marginSf === "" || marginCf === "" || marginMay === "") {
      return null;
    }
    const cost = Number(costUsd);
    const sf = Number(marginSf);
    const cf = Number(marginCf);
    const may = Number(marginMay);
    if (![cost, sf, cf, may].every((n) => Number.isFinite(n))) return null;
    return calculatePrices({
      costUsd: cost,
      exchangeRate,
      marginSfPct: sf,
      marginCfPct: cf,
      marginMayPct: may,
    });
  }, [costUsd, exchangeRate, marginSf, marginCf, marginMay]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const res =
      mode === "create"
        ? await createProduct(formData)
        : await updateProduct(product!.id, formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo guardar el producto.", "error");
      return;
    }
    toast(mode === "create" ? "Producto creado." : "Producto actualizado.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant={mode === "create" ? "primary" : "secondary"}
        size={mode === "create" ? "md" : "sm"}
        onClick={() => setOpen(true)}
      >
        {mode === "create" ? "Nuevo producto" : "Editar"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={mode === "create" ? "Nuevo producto" : `Editar ${product?.code}`}
        size="xl"
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Código" name="code" required defaultValue={product?.code} />
            <label className="block text-sm">
              <FieldLabel>Marca</FieldLabel>
              <select
                name="brand_id"
                required
                defaultValue={product?.brand_id ?? ""}
                className={fieldInputClass}
              >
                <option value="" disabled>
                  Selecciona…
                </option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <FieldLabel>Familia</FieldLabel>
              <select
                name="family_id"
                required
                defaultValue={product?.family_id ?? ""}
                className={fieldInputClass}
              >
                <option value="" disabled>
                  Selecciona…
                </option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Interno (mm)" name="internal_mm" type="number" step="0.01" defaultValue={product?.internal_mm ?? ""} />
            <Field label="Externo (mm)" name="external_mm" type="number" step="0.01" defaultValue={product?.external_mm ?? ""} />
            <Field label="Altura (mm)" name="height_mm" type="number" step="0.01" defaultValue={product?.height_mm ?? ""} />
            <Field label="Pestaña (mm)" name="flange_mm" type="number" step="0.01" defaultValue={product?.flange_mm ?? ""} />
            <Field label="Tope (mm)" name="stop_mm" type="number" step="0.01" defaultValue={product?.stop_mm ?? ""} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <FieldLabel>Procedencia</FieldLabel>
              <select
                name="origin_id"
                defaultValue={product?.origin_id ?? ""}
                className={fieldInputClass}
              >
                <option value="">—</option>
                {origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <FieldLabel>Proveedor</FieldLabel>
              <select
                name="supplier_id"
                defaultValue={product?.supplier_id ?? ""}
                className={fieldInputClass}
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-sm">
            <FieldLabel>Aplicación</FieldLabel>
            <textarea
              name="application"
              rows={2}
              defaultValue={product?.application ?? ""}
              className={fieldInputClass}
            />
          </label>

          <label className="block text-sm">
            <FieldLabel>Notas</FieldLabel>
            <textarea
              name="notes"
              rows={2}
              defaultValue={product?.notes ?? ""}
              placeholder="Ej. En almacén hay 2 docenas"
              className={fieldInputClass}
            />
          </label>

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
              <input
                type="text"
                disabled
                value={exchangeRate}
                className={fieldInputClass}
                title="Se edita en Ajustes → Tipo de cambio y afecta a todos los productos."
              />
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
              label="CF %"
              name="margin_cf_pct"
              type="number"
              step="0.01"
              required
              value={marginCf}
              onChange={(e) => setMarginCf(e.target.value)}
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

          <p className="text-xs text-slate-400">
            El tipo de cambio es global y se edita en Ajustes → Tipo de cambio.
          </p>

          {preview && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Precios calculados — SF: {preview.priceSfBs} Bs · CF: {preview.priceCfBs} Bs
              · MAY: {preview.priceMayBs} Bs
            </p>
          )}

          {mode === "create" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <FieldLabel>Sucursal (stock inicial)</FieldLabel>
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
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>

        {mode === "edit" && product && stock && (
          <StockSection productId={product.id} stock={stock} />
        )}
      </Modal>
    </>
  );
}

function StockSection({
  productId,
  stock,
}: {
  productId: string;
  stock: StockRow[];
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(stock.map((s) => [s.branch_id, String(s.quantity)])),
  );
  const [savingBranchId, setSavingBranchId] = useState<string | null>(null);
  const router = useRouter();

  async function save(branchId: string) {
    const quantity = Number(values[branchId]);
    if (!Number.isFinite(quantity) || quantity < 0) {
      toast("La cantidad debe ser un número mayor o igual a 0.", "error");
      return;
    }
    setSavingBranchId(branchId);
    const res = await updateProductStock(productId, branchId, quantity);
    setSavingBranchId(null);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar el stock.", "error");
      return;
    }
    toast("Stock actualizado.");
    router.refresh();
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-4">
      <h4 className="mb-2 text-sm font-semibold text-slate-700">Stock por sucursal</h4>
      <ul className="space-y-2">
        {stock.map((s) => (
          <li key={s.branch_id} className="flex items-center gap-2">
            <span className="w-40 truncate text-sm text-slate-600">{s.branch_name}</span>
            <input
              type="number"
              min={0}
              value={values[s.branch_id] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [s.branch_id]: e.target.value }))
              }
              className={fieldInputClass}
            />
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={savingBranchId === s.branch_id}
              onClick={() => save(s.branch_id)}
            >
              Guardar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
