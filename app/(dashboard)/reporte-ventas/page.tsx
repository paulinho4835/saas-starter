import { FileBarChart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { SALE_TYPES, SALE_TYPE_LABEL, QR_TYPES, type SaleType } from "@/lib/saleType";
import { clampPage } from "@/lib/ventasCart";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { ScrollHint } from "@/components/ui/ScrollHint";

// Reporte de solo lectura: una fila por producto vendido, con totales al pie.
// Ver docs/superpowers/specs/2026-07-02-reporte-ventas-design.md
// Se pagina por VENTA (no por línea) para poder ordenar/paginar de verdad en
// el servidor: sales.created_at es una columna nativa de la tabla base, así
// que .order()/.range() funcionan de forma exacta (a diferencia de ordenar
// por una tabla referenciada desde sale_items). Los TOTALES de Bs se calculan
// aparte con el RPC report_sales_totals sobre TODO el rango filtrado, nunca
// se truncan por la paginación de la tabla en pantalla.
const PAGE_SIZE = 100;
const EFECTIVO_TYPES = SALE_TYPES.filter((t) => !QR_TYPES.includes(t));

type SearchParams = {
  q?: string;
  branchId?: string;
  saleType?: string;
  from?: string;
  to?: string;
  page?: string;
};

type SaleItemRow = {
  id: string;
  unit_price_bs: number;
  quantity: number;
  subtotal_bs: number;
  products: { code: string } | null;
};

type SaleRow = {
  id: string;
  created_at: string;
  sale_type: string;
  branches: { name: string } | null;
  customers: { full_name: string; nit: string | null } | null;
  seller: { full_name: string } | null;
  sale_items: SaleItemRow[];
};

type DisplayRow = SaleItemRow & { sale: Omit<SaleRow, "sale_items"> };

const SALE_SELECT =
  "id, created_at, sale_type, branches(name), customers(full_name, nit), seller:profiles(full_name), sale_items!inner(id, unit_price_bs, quantity, subtotal_bs, products(code))";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
}

export default async function ReporteVentasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("reporte_ventas");
  const sp = await searchParams;
  const supabase = await createClient();
  const profile = await getProfile();

  const { data: branchesData } = await supabase.from("branches").select("id, name").order("name");
  const branches = branchesData ?? [];

  const from = sp.from || todayIso();
  const to = sp.to || todayIso();
  const toEndOfDay = `${to}T23:59:59`;
  const saleTypesFilter = sp.saleType === "qr" ? QR_TYPES : sp.saleType ? [sp.saleType] : null;

  // El filtro de cliente se resuelve aparte: PostgREST no soporta `.or()`
  // sobre una tabla anidada (sales -> customers), así que primero se
  // resuelven los ids de cliente que matchean y luego se filtra por
  // `customer_id`.
  let matchingCustomerIds: string[] | null = null;
  if (sp.q) {
    const q = escapePostgrestFilterValue(sp.q);
    const { data: matchingCustomers } = await supabase
      .from("customers")
      .select("id")
      .or(`full_name.ilike.%${q}%,nit.ilike.%${q}%`);
    matchingCustomerIds = (matchingCustomers ?? []).map((c) => c.id as string);
  }
  const noMatches = matchingCustomerIds?.length === 0;

  function buildSalesQuery(countOnly: boolean) {
    let q = supabase
      .from("sales")
      .select(SALE_SELECT, countOnly ? { count: "exact", head: true } : undefined)
      .gte("created_at", from)
      .lte("created_at", toEndOfDay)
      .order("created_at", { ascending: false });
    if (sp.branchId) q = q.eq("branch_id", sp.branchId);
    if (saleTypesFilter) q = q.in("sale_type", saleTypesFilter);
    if (matchingCustomerIds) q = q.in("customer_id", matchingCustomerIds);
    return q;
  }

  const explicitPage = sp.page ? Math.max(1, Number(sp.page) || 1) : 1;
  let totalSales = 0;
  let page = 1;
  let salesRows: SaleRow[] = [];
  if (!noMatches) {
    const { count } = await buildSalesQuery(true);
    totalSales = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalSales / PAGE_SIZE));
    page = clampPage(explicitPage, totalPages);
    const { data } = await buildSalesQuery(false).range(
      (page - 1) * PAGE_SIZE,
      page * PAGE_SIZE - 1,
    );
    salesRows = (data ?? []) as unknown as SaleRow[];
  }
  const totalPages = Math.max(1, Math.ceil(totalSales / PAGE_SIZE));

  const rows: DisplayRow[] = salesRows.flatMap((s) =>
    s.sale_items.map((item) => ({
      ...item,
      sale: {
        id: s.id,
        created_at: s.created_at,
        sale_type: s.sale_type,
        branches: s.branches,
        customers: s.customers,
        seller: s.seller,
      },
    })),
  );

  function buildHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.branchId) params.set("branchId", sp.branchId);
    if (sp.saleType) params.set("saleType", sp.saleType);
    params.set("from", from);
    params.set("to", to);
    params.set("page", String(targetPage));
    return `/reporte-ventas?${params.toString()}`;
  }

  // Totales sobre TODO el rango filtrado (no solo la página en pantalla).
  const { data: totalsData } = noMatches
    ? { data: null }
    : await supabase.rpc("report_sales_totals", {
        p_org_id: profile?.orgId ?? "",
        p_from: from,
        p_to: toEndOfDay,
        p_branch_id: sp.branchId ?? null,
        p_sale_types: saleTypesFilter,
        p_customer_ids: matchingCustomerIds,
        p_efectivo_types: EFECTIVO_TYPES,
        p_qr_types: QR_TYPES,
      });
  const totals = (totalsData?.[0] ?? null) as
    | { total_bs: number; total_efectivo_bs: number; total_qr_bs: number; items_count: number }
    | null;
  const totalBs = Number(totals?.total_bs ?? 0);
  const totalEfectivoBs = Number(totals?.total_efectivo_bs ?? 0);
  const totalQrBs = Number(totals?.total_qr_bs ?? 0);
  const totalItemsCount = Number(totals?.items_count ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Reporte de Ventas" subtitle={`${totalItemsCount} producto(s) vendido(s) en el rango`} />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Desde</span>
            <input type="date" name="from" defaultValue={from} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Hasta</span>
            <input type="date" name="to" defaultValue={to} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Cliente (nombre o NIT)</span>
            <input type="text" name="q" defaultValue={sp.q ?? ""} className={`${fieldInputClass} w-56`} />
          </label>
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
            <span className="mb-1 block text-slate-600">Tipo de venta</span>
            <select name="saleType" defaultValue={sp.saleType ?? ""} className={fieldInputClass}>
              <option value="">Todas</option>
              {SALE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SALE_TYPE_LABEL[t]}
                </option>
              ))}
              <option value="qr">QR (con y sin factura)</option>
            </select>
          </label>
          <Button type="submit">Generar</Button>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<FileBarChart className="h-6 w-6" />}
            title="Sin ventas en este rango"
            description="Ajusta los filtros de búsqueda."
          />
        ) : (
          <>
            <ScrollHint />
            <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2">Sucursal</th>
                  <th className="px-3 py-2">Tipo de venta</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">NIT</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Precio (Bs)</th>
                  <th className="px-3 py-2">Cant.</th>
                  <th className="px-3 py-2">Subtotal (Bs)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{formatDateTime(row.sale.created_at)}</td>
                    <td className="px-3 py-2">{row.sale.seller?.full_name ?? "—"}</td>
                    <td className="px-3 py-2">{row.sale.branches?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {SALE_TYPE_LABEL[row.sale.sale_type as SaleType]}
                    </td>
                    <td className="px-3 py-2">{row.sale.customers?.full_name ?? ""}</td>
                    <td className="px-3 py-2 text-slate-500">{row.sale.customers?.nit ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{row.products?.code ?? "—"}</td>
                    <td className="px-3 py-2">{row.unit_price_bs}</td>
                    <td className="px-3 py-2">{row.quantity}</td>
                    <td className="px-3 py-2">{row.subtotal_bs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
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
            Página {page} de {totalPages} (por venta)
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

      {totalItemsCount > 0 && (
        <Card className="flex flex-wrap gap-6 p-4 text-sm">
          <p>
            <span className="text-slate-500">Total ventas (líneas):</span>{" "}
            <span className="font-semibold text-slate-800">{totalItemsCount}</span>
          </p>
          <p>
            <span className="text-slate-500">Total Bs:</span>{" "}
            <span className="font-semibold text-slate-800">{totalBs.toFixed(2)}</span>
          </p>
          <p>
            <span className="text-slate-500">Total Efectivo Bs:</span>{" "}
            <span className="font-semibold text-slate-800">{totalEfectivoBs.toFixed(2)}</span>
          </p>
          <p>
            <span className="text-slate-500">Ventas QR Bs (con y sin factura):</span>{" "}
            <span className="font-semibold text-slate-800">{totalQrBs.toFixed(2)}</span>
          </p>
        </Card>
      )}
    </div>
  );
}
