"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { calculateLineSubtotal, calculateSaleTotal } from "@/lib/sales";
import { SALE_TYPES, SALE_TYPE_LABEL, priceTierForSaleType, type SaleType } from "@/lib/saleType";
import { createSale } from "@/app/(dashboard)/ventas/actions";

// Anclados: personales por navegador (no por org), para recordar rápido
// "cuál repuesto era" cuando un cliente vuelve después de un tiempo. Guarda
// una foto del producto al momento de anclar — precio/stock pueden quedar
// desactualizados si no aparece en la búsqueda actual, pero el server
// siempre revalida stock real al confirmar la venta.
const PINNED_STORAGE_KEY = "ventas:pinnedProducts";

type ProductResult = {
  id: string;
  code: string;
  application: string | null;
  brandName: string;
  priceSfBs: number;
  priceCfBs: number;
  priceMayBs: number;
  stock: number;
  internalMm: number | null;
  externalMm: number | null;
  heightMm: number | null;
  flangeMm: number | null;
  stopMm: number | null;
};

type CartLine = {
  productId: string;
  code: string;
  unitPriceBs: string;
  quantity: string;
  maxStock: number;
};

function formatMm(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

function priceForSaleType(product: ProductResult, saleType: SaleType): number {
  const tier = priceTierForSaleType(saleType);
  if (tier === "sf") return product.priceSfBs;
  if (tier === "cf") return product.priceCfBs;
  return product.priceMayBs;
}

export function SalePanel({
  products,
}: {
  products: ProductResult[];
}) {
  const [saleType, setSaleType] = useState<SaleType>("sin_factura");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerNit, setCustomerNit] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState<ProductResult[]>([]);
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
      if (raw) setPinned(JSON.parse(raw));
    } catch {
      // localStorage corrupto o bloqueado: seguir sin anclados.
    }
  }, []);

  function togglePin(product: ProductResult) {
    setPinned((prev) => {
      const next = prev.some((p) => p.id === product.id)
        ? prev.filter((p) => p.id !== product.id)
        : [...prev, product];
      try {
        window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Si no se puede guardar, igual se refleja en la sesión actual.
      }
      return next;
    });
  }

  const pinnedIds = new Set(pinned.map((p) => p.id));

  function addToCart(product: ProductResult) {
    setCart((prev) => [
      ...prev,
      {
        productId: product.id,
        code: product.code,
        unitPriceBs: String(priceForSaleType(product, saleType)),
        quantity: "1",
        maxStock: product.stock,
      },
    ]);
  }

  // Una venta = un solo tipo: si cambia el tipo con productos ya en el
  // carrito, recalcula el precio de todas las líneas al nuevo tipo.
  function changeSaleType(next: SaleType) {
    setSaleType(next);
    setCart((prev) =>
      prev.map((line) => {
        const product = products.find((p) => p.id === line.productId);
        if (!product) return line;
        return { ...line, unitPriceBs: String(priceForSaleType(product, next)) };
      }),
    );
  }

  function updateLine(index: number, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  const total = calculateSaleTotal(
    cart.map((l) => ({
      unitPriceBs: Number(l.unitPriceBs) || 0,
      quantity: Number(l.quantity) || 0,
    })),
  );

  async function onConfirm() {
    if (cart.length === 0) {
      toast("Agrega al menos un producto.", "error");
      return;
    }
    const invalidLine = cart.find(
      (l) =>
        !Number.isFinite(Number(l.unitPriceBs)) ||
        !Number.isInteger(Number(l.quantity)) ||
        Number(l.quantity) <= 0,
    );
    if (invalidLine) {
      toast("Revisa precios y cantidades del carrito.", "error");
      return;
    }

    setLoading(true);
    const formData = new FormData();
    if (customerName) formData.set("customerName", customerName);
    if (customerNit) formData.set("customerNit", customerNit);
    formData.set("saleType", saleType);
    formData.set(
      "items",
      JSON.stringify(
        cart.map((l) => ({
          productId: l.productId,
          unitPriceBs: Number(l.unitPriceBs),
          quantity: Number(l.quantity),
        })),
      ),
    );
    const res = await createSale(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(`Venta registrada: ${res.total} Bs.`);
    setCart([]);
    setCustomerName("");
    setCustomerNit("");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {pinned.length > 0 && (
          <Card className="p-3">
            <div className="flex flex-wrap gap-2">
              {pinned.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-1 text-xs"
                >
                  <span className="font-medium text-slate-800">{p.code}</span>
                  <span className="text-slate-500">{priceForSaleType(p, saleType)} Bs</span>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    className="rounded-full bg-brand-600 px-2 py-0.5 font-medium text-white hover:bg-brand-700"
                  >
                    Agregar
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePin(p)}
                    className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                    title="Desanclar"
                  >
                    <PinOff className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="max-h-[75vh] overflow-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Marca</th>
              <th className="px-3 py-2">Stock</th>
              <th className="bg-emerald-100 px-3 py-2 text-center text-emerald-800">CF</th>
              <th className="bg-amber-100 px-3 py-2 text-center text-amber-800">SF</th>
              <th className="bg-rose-100 px-3 py-2 text-center text-rose-800">MAY</th>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">MI</th>
              <th className="px-3 py-2">ME</th>
              <th className="px-3 py-2">ALT</th>
              <th className="px-3 py-2">PEST</th>
              <th className="px-3 py-2">TOPE</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const outOfStock = p.stock <= 0;
              const activeTier = priceTierForSaleType(saleType);
              return (
                <tr
                  key={p.id}
                  className={`border-b border-slate-100 ${outOfStock ? "opacity-50" : ""}`}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => togglePin(p)}
                      className={`rounded p-1 hover:bg-slate-100 ${pinnedIds.has(p.id) ? "text-brand-600" : "text-slate-300"}`}
                      title={pinnedIds.has(p.id) ? "Desanclar" : "Anclar"}
                    >
                      {pinnedIds.has(p.id) ? <Pin className="h-4 w-4 fill-current" /> : <Pin className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{p.code}</p>
                    <p className="text-xs text-slate-500">{p.application || "—"}</p>
                  </td>
                  <td className="px-3 py-2">{p.brandName}</td>
                  <td className={`px-3 py-2 ${outOfStock ? "text-red-500" : ""}`}>{p.stock}</td>
                  <td
                    className={`bg-emerald-50 px-3 py-2 text-center text-emerald-900 ${activeTier === "cf" ? "font-bold ring-1 ring-inset ring-emerald-400" : ""}`}
                  >
                    {p.priceCfBs}
                  </td>
                  <td
                    className={`bg-amber-50 px-3 py-2 text-center text-amber-900 ${activeTier === "sf" ? "font-bold ring-1 ring-inset ring-amber-400" : ""}`}
                  >
                    {p.priceSfBs}
                  </td>
                  <td
                    className={`bg-rose-50 px-3 py-2 text-center text-rose-900 ${activeTier === "may" ? "font-bold ring-1 ring-inset ring-rose-400" : ""}`}
                  >
                    {p.priceMayBs}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={outOfStock}
                      onClick={() => addToCart(p)}
                      className="rounded bg-brand-50 px-2 py-1 font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-400"
                    >
                      Agregar
                    </button>
                  </td>
                  <td className="px-3 py-2">{formatMm(p.internalMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.externalMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.heightMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.flangeMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.stopMm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </Card>
      </div>

      <Card className="h-fit space-y-4 p-4">
        <h3 className="font-semibold text-slate-800">Carrito</h3>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Tipo de venta</span>
          <select
            value={saleType}
            onChange={(e) => changeSaleType(e.target.value as SaleType)}
            className={fieldInputClass}
          >
            {SALE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SALE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Nombre del cliente (opcional)</span>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Venta de mostrador"
            className={fieldInputClass}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">NIT (opcional)</span>
          <input
            type="text"
            value={customerNit}
            onChange={(e) => setCustomerNit(e.target.value)}
            className={fieldInputClass}
          />
        </label>

        {cart.length === 0 ? (
          <p className="text-sm text-slate-500">Agrega productos de la lista.</p>
        ) : (
          <ul className="space-y-3">
            {cart.map((line, i) => (
              <li key={i} className="space-y-1 border-b border-slate-100 pb-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700">{line.code}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={line.unitPriceBs}
                    onChange={(e) => updateLine(i, { unitPriceBs: e.target.value })}
                    className={`${fieldInputClass} w-24`}
                  />
                  <input
                    type="number"
                    min={1}
                    max={line.maxStock}
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className={`${fieldInputClass} w-20`}
                  />
                  <span className="flex items-center text-slate-500">
                    ={" "}
                    {calculateLineSubtotal({
                      unitPriceBs: Number(line.unitPriceBs) || 0,
                      quantity: Number(line.quantity) || 0,
                    })}{" "}
                    Bs
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-right text-lg font-semibold text-slate-800">Total: {total} Bs</p>

        <Button className="w-full" disabled={loading || cart.length === 0} onClick={onConfirm}>
          {loading ? "Confirmando…" : "Confirmar venta"}
        </Button>
      </Card>
    </div>
  );
}
