"use client";

import { useEffect, useRef } from "react";
import { Pin } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ScrollHint } from "@/components/ui/ScrollHint";
import { pageWindow, type PriceTier } from "@/lib/ventasCart";

export type ProductResult = {
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
// Colores exactos del legacy (public/css/table.css: .verde/.amarillo/.rojo).
const TIER_ROW_CLASS: Record<PriceTier, string> = {
  cf: "bg-[#c2dfc2]",
  sf: "bg-[#fffccf]",
  may: "bg-[#ffd6d6]",
};
// Variante -intenso del legacy: se aplica a la coincidencia más cercana tras
// una búsqueda por medida (.verde-intenso/.amarillo-intenso/.rojo-intenso).
const TIER_ROW_INTENSO: Record<PriceTier, string> = {
  cf: "bg-[#79c479]",
  sf: "bg-[#f3f378]",
  may: "bg-[#ffa4a4]",
};
// Fila seleccionada: td.row-selected del legacy (azul claro).
const SELECTED_ROW_CLASS = "bg-[#ced4ff]";
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
  highlightProductIds,
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
  highlightProductIds?: string[];
}) {
  const pageItems = pageWindow(page, totalPages);
  const highlightIdSet = new Set(highlightProductIds ?? []);
  const firstHighlightedId = products.find((p) => highlightIdSet.has(p.id))?.id ?? null;

  // Auto-scroll a la primera fila resaltada tras una búsqueda por medida,
  // igual que el legacy baja hasta la fila exacta (nro_registro_cercano). Solo
  // dispara cuando cambia el conjunto resaltado (una búsqueda nueva), no al
  // seleccionar o paginar.
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (firstHighlightedId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }, [firstHighlightedId]);

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
    <Card className="overflow-hidden">
      {/* Ventana de resultados con scroll interno propio, igual que el legacy
          (DataTable scrollY:"90vh" + scrollCollapse en ventas.js): la búsqueda
          se navega DENTRO de esta ventana de altura fija, con su thead estático
          arriba. El scroll de la página queda libre para bajar al carrito
          "Productos para la Venta". La altura casi llena el viewport bajo el
          encabezado para que siempre haya scroll interno (75 productos × 3
          filas). El auto-scroll a la coincidencia cercana ocurre dentro de esta
          misma ventana (su scroll ancestro más cercano). */}
      <div className="ventas-scroll max-h-[calc(100vh-11rem)] overflow-auto">
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
            const highlighted = highlightIdSet.has(p.id);
            return TIERS.map((tier, i) => (
              <tr
                key={`${p.id}-${tier}`}
                ref={i === 0 && p.id === firstHighlightedId ? highlightRowRef : undefined}
                onClick={() => onSelectProduct(p)}
                className={`cursor-pointer ${
                  selected
                    ? SELECTED_ROW_CLASS
                    : highlighted
                      ? TIER_ROW_INTENSO[tier]
                      : TIER_ROW_CLASS[tier]
                } ${outOfStock ? "opacity-50" : ""}`}
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
                  <td className="px-3 py-2 align-top" rowSpan={3}>
                    {/* Estilo exacto del legacy: <strong style="color:red;letter-spacing:2px">. */}
                    <strong className={`text-[#ff0000] tracking-[2px] ${outOfStock ? "opacity-70" : ""}`}>
                      {p.stock}
                    </strong>
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
                    // .btn-pers del legacy: 65x30, sin borde, fondo casi blanco,
                    // texto negro; hover pasa a azul sólido con texto blanco.
                    className="h-[30px] w-[65px] rounded-none bg-[#f9f9f9] font-normal text-black transition hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
      </div>

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
