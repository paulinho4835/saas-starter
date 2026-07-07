"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ScrollHint } from "@/components/ui/ScrollHint";
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

type PriceTier = "cf" | "sf" | "may";

// Tipo de venta representativo de cada tier, para cuando se agrega un
// producto haciendo clic directo en una fila CF/SF/MAY (en vez de elegir el
// tipo de venta primero) — el usuario puede afinar a la variante QR después
// desde el selector "Tipo de venta" si corresponde.
const DEFAULT_SALE_TYPE_FOR_TIER: Record<PriceTier, SaleType> = {
  cf: "con_factura",
  sf: "sin_factura",
  may: "mayorista",
};

const TIER_LABEL: Record<PriceTier, string> = { cf: "CF", sf: "SF", may: "MAY" };
const TIER_PRICE: Record<PriceTier, keyof ProductResult> = {
  cf: "priceCfBs",
  sf: "priceSfBs",
  may: "priceMayBs",
};
const TIER_ROW_CLASS: Record<PriceTier, string> = {
  cf: "bg-emerald-100",
  sf: "bg-yellow-100",
  may: "bg-rose-100",
};

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

  // Clic directo en una fila CF/SF/MAY de la tabla: cambia el tipo de venta
  // al de ese tier (recalculando el resto del carrito) y agrega la línea con
  // el precio de ESE tier, sin depender del estado `saleType` (que todavía no
  // se actualizó cuando corre este mismo handler).
  function selectTierAndAdd(product: ProductResult, tier: PriceTier) {
    const nextSaleType = DEFAULT_SALE_TYPE_FOR_TIER[tier];
    if (nextSaleType !== saleType) changeSaleType(nextSaleType);
    setCart((prev) => [
      ...prev,
      {
        productId: product.id,
        code: product.code,
        unitPriceBs: String(product[TIER_PRICE[tier]]),
        quantity: "1",
        maxStock: product.stock,
      },
    ]);
  }

  // "Equiv": busca repuestos equivalentes (mismas medidas, ±0.5mm de
  // tolerancia — mismo criterio que lib/measurementSearch.ts) sin importar
  // marca/código. El carrito no se pierde: sigue siendo el mismo componente,
  // solo cambian los resultados que le llegan por props.
  function searchEquivalents(product: ProductResult) {
    const params = new URLSearchParams();
    if (product.internalMm !== null) params.set("mi", String(product.internalMm));
    if (product.externalMm !== null) params.set("me", String(product.externalMm));
    if (product.heightMm !== null) params.set("alt", String(product.heightMm));
    if (product.flangeMm !== null) params.set("pest", String(product.flangeMm));
    if (product.stopMm !== null) params.set("tope", String(product.stopMm));
    router.push(`/ventas?${params.toString()}`);
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
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-brand-200 bg-brand-50 py-1.5 pl-3 pr-1 text-xs"
                >
                  <span className="font-medium text-slate-800">{p.code}</span>
                  <span className="flex items-center gap-1 text-slate-500">
                    <span className="rounded bg-emerald-100 px-1 text-emerald-800">CF {p.priceCfBs}</span>
                    <span className="rounded bg-amber-100 px-1 text-amber-800">SF {p.priceSfBs}</span>
                    <span className="rounded bg-rose-100 px-1 text-rose-800">MAY {p.priceMayBs}</span>
                  </span>
                  <span className="text-slate-500">
                    MI {formatMm(p.internalMm)} · ME {formatMm(p.externalMm)} · ALT {formatMm(p.heightMm)} · PEST{" "}
                    {formatMm(p.flangeMm)} · TOPE {formatMm(p.stopMm)}
                  </span>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    className="rounded-full bg-brand-600 px-2 py-0.5 font-medium text-white hover:bg-brand-700"
                  >
                    Agregar {priceForSaleType(p, saleType)} Bs
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
        <ScrollHint />
        <table className="w-full min-w-[820px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Marca</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Precios Bs</th>
              <th className="px-3 py-2">MI</th>
              <th className="px-3 py-2">ME</th>
              <th className="px-3 py-2">ALT</th>
              <th className="px-3 py-2">PEST</th>
              <th className="px-3 py-2">TOPE</th>
              <th className="px-3 py-2">Equiv</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const outOfStock = p.stock <= 0;
              const activeTier = priceTierForSaleType(saleType);
              const tiers: PriceTier[] = ["cf", "sf", "may"];
              return tiers.map((tier, i) => (
                <tr key={`${p.id}-${tier}`} className={`${TIER_ROW_CLASS[tier]} ${outOfStock ? "opacity-50" : ""}`}>
                  {i === 0 && (
                    <td className="px-3 py-2 align-top" rowSpan={3}>
                      <button
                        type="button"
                        onClick={() => togglePin(p)}
                        className={`rounded p-1 hover:bg-white/50 ${pinnedIds.has(p.id) ? "text-brand-700" : "text-slate-400"}`}
                        title={pinnedIds.has(p.id) ? "Desanclar" : "Anclar"}
                      >
                        {pinnedIds.has(p.id) ? <Pin className="h-4 w-4 fill-current" /> : <Pin className="h-4 w-4" />}
                      </button>
                    </td>
                  )}
                  {i === 0 && (
                    <td className="px-3 py-2 align-top" rowSpan={3}>
                      <p className="font-medium text-slate-800">{p.code}</p>
                      <p className="text-xs text-slate-500">{p.application || "—"}</p>
                    </td>
                  )}
                  {i === 0 && (
                    <td className="px-3 py-2 align-top" rowSpan={3}>
                      {p.brandName}
                    </td>
                  )}
                  {i === 0 && (
                    <td className={`px-3 py-2 align-top font-semibold ${outOfStock ? "text-red-700" : "text-red-600"}`} rowSpan={3}>
                      {p.stock}
                    </td>
                  )}
                  <td className="px-3 py-2 font-medium text-slate-700">{TIER_LABEL[tier]}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={outOfStock}
                      onClick={() => selectTierAndAdd(p, tier)}
                      className={`rounded bg-white px-2 py-1 font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${activeTier === tier ? "ring-2 ring-brand-500" : ""}`}
                      title="Agregar al carrito con este tipo de venta"
                    >
                      {p[TIER_PRICE[tier]]}
                    </button>
                  </td>
                  <td className="px-3 py-2">{formatMm(p.internalMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.externalMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.heightMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.flangeMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.stopMm)}</td>
                  <td className="px-3 py-2">
                    {tier === "sf" && (
                      <button
                        type="button"
                        onClick={() => searchEquivalents(p)}
                        className="rounded bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                        title="Buscar repuestos con las mismas medidas (±0.5mm)"
                      >
                        Equiv
                      </button>
                    )}
                  </td>
                </tr>
              ));
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
