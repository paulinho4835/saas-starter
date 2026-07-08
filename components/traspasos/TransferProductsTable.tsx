"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { pageWindow } from "@/lib/ventasCart";
import type { TransferProceso } from "@/components/traspasos/TransferQuantityModal";

export type TransferProduct = {
  id: string;
  code: string;
  application: string | null;
  stock: number;
};

// td.row-selected del legacy (azul claro) — mismo valor que ProductsTable.tsx de Ventas.
const SELECTED_ROW_CLASS = "bg-[#ced4ff]";

export function TransferProductsTable({
  products,
  selectedProductId,
  onSelectProduct,
  onOpenModal,
  page,
  totalPages,
  baseQuery,
  canManage,
}: {
  products: TransferProduct[];
  selectedProductId: string | null;
  onSelectProduct: (product: TransferProduct) => void;
  onOpenModal: (product: TransferProduct, proceso: TransferProceso) => void;
  page: number;
  totalPages: number;
  baseQuery: string;
  canManage: boolean;
}) {
  const pageItems = pageWindow(page, totalPages);

  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams(baseQuery);
    params.set("tab", "sol_env");
    params.set("page", String(targetPage));
    return `/traspasos?${params.toString()}`;
  }

  const arrowClass =
    "flex h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";
  const arrowDisabledClass =
    "flex h-9 min-w-9 cursor-not-allowed items-center justify-center rounded-lg border border-slate-100 px-3 text-slate-300";

  return (
    <Card className="overflow-hidden">
      <div className="max-h-[calc(100vh-11rem)] overflow-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Cantidad</th>
              {canManage && <th className="px-3 py-2"></th>}
              {canManage && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const selected = p.id === selectedProductId;
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelectProduct(p)}
                  className={`cursor-pointer ${selected ? SELECTED_ROW_CLASS : "hover:bg-slate-50"}`}
                >
                  <td className="px-3 py-2 font-medium text-slate-800">{p.code}</td>
                  <td className="px-3 py-2 text-slate-600">{p.stock}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenModal(p, "pedido");
                        }}
                      >
                        Pedido
                      </Button>
                    </td>
                  )}
                  {canManage && (
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenModal(p, "envio");
                        }}
                      >
                        Envío
                      </Button>
                    </td>
                  )}
                </tr>
              );
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
              <span key={`gap-${i}`} className="flex h-9 w-9 items-center justify-center text-slate-400" aria-hidden="true">
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
