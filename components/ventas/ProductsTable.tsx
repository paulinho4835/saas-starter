"use client";

import { Pin } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ScrollHint } from "@/components/ui/ScrollHint";
import { pageWindow, type PriceTier } from "@/lib/ventasCart";

export type ProductResult = {
  id: string;
  code: string;
  application: string | null;
  notes: string | null;
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

function formatMm(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

const TIER_LABEL: Record<PriceTier, string> = { cf: "CF", sf: "SF", may: "MAY" };
const TIER_PRICE: Record<PriceTier, "priceCfBs" | "priceSfBs" | "priceMayBs"> = {
  cf: "priceCfBs",
  sf: "priceSfBs",
  may: "priceMayBs",
};
const TIER_ROW_CLASS: Record<PriceTier, string> = {
  cf: "bg-emerald-100",
  sf: "bg-yellow-100",
  may: "bg-rose-100",
};
const TIERS: PriceTier[] = ["cf", "sf", "may"];

export function ProductsTable({
  products,
  selectedProductId,
  onSelectProduct,
  onPriceClick,
  pinnedIds,
  onTogglePin,
  onSearchEquivalents,
  page,
  totalPages,
  baseQuery,
}: {
  products: ProductResult[];
  selectedProductId: string | null;
  onSelectProduct: (product: ProductResult) => void;
  onPriceClick: (product: ProductResult, tier: PriceTier) => void;
  pinnedIds: Set<string>;
  onTogglePin: (product: ProductResult) => void;
  onSearchEquivalents: (product: ProductResult) => void;
  page: number;
  totalPages: number;
  baseQuery: string;
}) {
  const pageItems = pageWindow(page, totalPages);

  // El link de cada página se arma aquí (cliente) a partir del querystring de
  // filtros activos que llega serializado desde el servidor, porque una
  // función no puede cruzar la frontera Server → Client Component.
  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams(baseQuery);
    params.set("page", String(targetPage));
    return `/ventas?${params.toString()}`;
  }

  const arrowClass =
    "flex h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";
  const arrowDisabledClass =
    "flex h-9 min-w-9 cursor-not-allowed items-center justify-center rounded-lg border border-slate-100 px-3 text-slate-300";

  return (
    <Card className="overflow-auto">
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
            const selected = p.id === selectedProductId;
            return TIERS.map((tier, i) => (
              <tr
                key={`${p.id}-${tier}`}
                onClick={() => onSelectProduct(p)}
                className={`cursor-pointer ${selected ? "bg-slate-300" : TIER_ROW_CLASS[tier]} ${outOfStock ? "opacity-50" : ""}`}
              >
                {i === 0 && (
                  <td className="px-3 py-2 align-top" rowSpan={3}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(p);
                      }}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      onPriceClick(p, tier);
                    }}
                    className="rounded bg-white px-2 py-1 font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                      onClick={(e) => {
                        e.stopPropagation();
                        onSearchEquivalents(p);
                      }}
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

      {totalPages > 1 && (
        <nav
          aria-label="Paginación"
          className="flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-100 p-3 text-sm"
        >
          {page > 1 ? (
            <a href={buildPageHref(page - 1)} className={arrowClass} aria-label="Página anterior">
              ‹
            </a>
          ) : (
            <span className={arrowDisabledClass} aria-hidden="true">
              ‹
            </span>
          )}

          {pageItems.map((item, i) =>
            item === "…" ? (
              <span
                key={`gap-${i}`}
                className="flex h-9 w-9 items-center justify-center text-slate-400"
                aria-hidden="true"
              >
                …
              </span>
            ) : item === page ? (
              <span
                key={item}
                aria-current="page"
                className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-brand-600 px-3 font-semibold text-white"
              >
                {item}
              </span>
            ) : (
              <a
                key={item}
                href={buildPageHref(item)}
                className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                {item}
              </a>
            ),
          )}

          {page < totalPages ? (
            <a href={buildPageHref(page + 1)} className={arrowClass} aria-label="Página siguiente">
              ›
            </a>
          ) : (
            <span className={arrowDisabledClass} aria-hidden="true">
              ›
            </span>
          )}
        </nav>
      )}
    </Card>
  );
}
