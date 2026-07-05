import { Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { ExportExcelButton } from "@/components/ui/ExportExcelButton";

// Reporte de solo lectura: una fila por producto+sucursal, con totales al
// pie sobre TODO lo que matchea el filtro (no solo la página visible).
// Ver docs/superpowers/specs/2026-07-05-reporte-productos-design.md
const PAGE_SIZE = 30;

type SearchParams = {
  branchId?: string;
  brandId?: string;
  page?: string;
};

type StockRow = {
  quantity: number;
  branches: { name: string } | null;
  products: {
    code: string;
    cost_usd: number | null;
    price_cf_bs: number;
    price_sf_bs: number;
    price_may_bs: number;
    internal_mm: number | null;
    external_mm: number | null;
    height_mm: number | null;
    flange_mm: number | null;
    stop_mm: number | null;
    product_brands: { name: string } | null;
  } | null;
};

const STOCK_SELECT =
  "quantity, branches!inner(name), products!inner(code, cost_usd, price_cf_bs, price_sf_bs, price_may_bs, internal_mm, external_mm, height_mm, flange_mm, stop_mm, product_brands(name))";

function fmt(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

export default async function ReporteProductosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("reporte_productos");
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: branchesData }, { data: brandsData }] = await Promise.all([
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("product_brands").select("id, name").order("name"),
  ]);
  const branches = branchesData ?? [];
  const brands = brandsData ?? [];

  const page = Math.max(1, Number(sp.page) || 1);

  function applyFilters<T>(query: T): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = query as any;
    if (sp.branchId) q = q.eq("branch_id", sp.branchId);
    if (sp.brandId) q = q.eq("products.brand_id", sp.brandId);
    return q;
  }

  const pagedQuery = applyFilters(
    supabase
      .from("product_stock")
      .select(STOCK_SELECT, { count: "exact" })
      .order("products(code)")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  );
  const { data: pagedData, count } = await pagedQuery;
  const rows = (pagedData ?? []) as unknown as StockRow[];
  const totalItems = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  // Totales sobre TODO lo filtrado, no solo la página actual.
  const totalsQuery = applyFilters(
    supabase.from("product_stock").select("quantity, products!inner(cost_usd, brand_id)"),
  );
  const { data: totalsRaw } = await totalsQuery;
  const totalsData = (totalsRaw ?? []) as unknown as {
    quantity: number;
    products: { cost_usd: number | null } | null;
  }[];
  const totalStock = totalsData.reduce((sum, r) => sum + r.quantity, 0);
  const totalCostUsd = totalsData.reduce(
    (sum, r) => sum + r.quantity * (r.products?.cost_usd ?? 0),
    0,
  );

  function buildHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.branchId) params.set("branchId", sp.branchId);
    if (sp.brandId) params.set("brandId", sp.brandId);
    params.set("page", String(targetPage));
    return `/reporte-productos?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Reporte producto" subtitle={`${totalItems} resultado(s)`} />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Sucursal</span>
            <select name="branchId" defaultValue={sp.branchId ?? ""} className={fieldInputClass}>
              <option value="">Todas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Marca</span>
            <select name="brandId" defaultValue={sp.brandId ?? ""} className={fieldInputClass}>
              <option value="">Todas</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Generar</Button>
          <ButtonLink variant="secondary" href="/reporte-productos">
            Limpiar
          </ButtonLink>
        </form>
      </Card>

      <Card className="overflow-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Sin resultados"
            description="Ajusta los filtros de búsqueda."
          />
        ) : (
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">Código producto</th>
                <th className="px-4 py-2">Sucursal</th>
                <th className="px-4 py-2">Marca</th>
                <th className="px-4 py-2">Stock</th>
                <th className="px-4 py-2">Costo origen dólares</th>
                <th className="px-4 py-2">Con factura</th>
                <th className="px-4 py-2">Sin factura</th>
                <th className="px-4 py-2">Por mayor</th>
                <th className="px-4 py-2">Medida interna</th>
                <th className="px-4 py-2">Medida externa</th>
                <th className="px-4 py-2">Altura</th>
                <th className="px-4 py-2">Pestaña</th>
                <th className="px-4 py-2">Tope</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((r, i) =>
                r.products ? (
                  <tr key={`${r.products.code}-${r.branches?.name ?? i}`}>
                    <td className="px-4 py-2 font-medium text-slate-800">{r.products.code}</td>
                    <td className="px-4 py-2 text-slate-500">{r.branches?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-500">
                      {r.products.product_brands?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{r.quantity}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.cost_usd)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.price_cf_bs)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.price_sf_bs)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.price_may_bs)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.internal_mm)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.external_mm)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.height_mm)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.flange_mm)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmt(r.products.stop_mm)}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          {page > 1 ? (
            <ButtonLink variant="secondary" size="sm" href={buildHref(page - 1)}>
              Anterior
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Anterior
            </Button>
          )}
          <span>
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <ButtonLink variant="secondary" size="sm" href={buildHref(page + 1)}>
              Siguiente
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Siguiente
            </Button>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-1">
          <p className="font-semibold text-slate-800">Cantidad total items: {totalItems}</p>
          <p className="font-semibold text-slate-800">Stock total: {totalStock}</p>
          <p className="font-semibold text-slate-800">
            Costo total origen en dólares: {fmt(totalCostUsd)} $
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ExportExcelButton
          filenamePrefix="reporte-productos"
          sheetName="Productos"
          rows={rows.map((r) => ({
            "Código producto": r.products?.code ?? "",
            Sucursal: r.branches?.name ?? "",
            Marca: r.products?.product_brands?.name ?? "",
            Stock: r.quantity,
            "Costo origen dólares": r.products?.cost_usd ?? "",
            "Con factura": r.products?.price_cf_bs ?? "",
            "Sin factura": r.products?.price_sf_bs ?? "",
            "Por mayor": r.products?.price_may_bs ?? "",
            "Medida interna": r.products?.internal_mm ?? "",
            "Medida externa": r.products?.external_mm ?? "",
            Altura: r.products?.height_mm ?? "",
            Pestaña: r.products?.flange_mm ?? "",
            Tope: r.products?.stop_mm ?? "",
          }))}
        />
      )}
    </div>
  );
}
