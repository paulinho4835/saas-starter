import { Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { clampPage } from "@/lib/ventasCart";
import { SALE_TYPE_LABEL, type SaleType } from "@/lib/saleType";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { ScrollHint } from "@/components/ui/ScrollHint";
import { ReturnRowAction } from "@/components/devoluciones/ReturnRowAction";

// Buscar ventas confirmadas y devolver (parcial o totalmente) sus líneas.
// Ver docs/superpowers/specs/2026-07-02-devoluciones-design.md
// Se pagina por VENTA (no por línea), igual que en Reporte de Ventas:
// sales.created_at es una columna nativa de la tabla base, así que
// .order()/.range() paginan de verdad en el servidor en vez de traer hasta
// 2000 filas y recortar en JS (con el riesgo de que una venta con muchas
// líneas quedara fuera del límite y no se pudiera devolver).
const PAGE_SIZE = 100;

type SearchParams = {
  q?: string;
  branchId?: string;
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
  sale_items: SaleItemRow[];
};

type DisplayRow = SaleItemRow & { sale: Omit<SaleRow, "sale_items"> };

const SALE_SELECT =
  "id, created_at, sale_type, branches(name), customers(full_name, nit), sale_items!inner(id, unit_price_bs, quantity, subtotal_bs, products(code))";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
}

export default async function DevolucionesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("devoluciones");
  const sp = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();
  const canReturn = can(profile?.role, "devoluciones:create");

  const { data: branchesData } = await supabase.from("branches").select("id, name").order("name");
  const branches = branchesData ?? [];

  const from = sp.from || todayIso();
  const to = sp.to || todayIso();
  const toEndOfDay = `${to}T23:59:59`;

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
      },
    })),
  );

  function buildHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.branchId) params.set("branchId", sp.branchId);
    params.set("from", from);
    params.set("to", to);
    params.set("page", String(targetPage));
    return `/devoluciones?${params.toString()}`;
  }

  const saleItemIds = rows.map((r) => r.id);
  const returnedByItem = new Map<string, number>();
  if (saleItemIds.length > 0) {
    const { data: returnsData } = await supabase
      .from("sale_returns")
      .select("sale_item_id, quantity")
      .in("sale_item_id", saleItemIds);
    for (const r of returnsData ?? []) {
      const key = r.sale_item_id as string;
      returnedByItem.set(key, (returnedByItem.get(key) ?? 0) + (r.quantity as number));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Devoluciones" subtitle={`${rows.length} producto(s) vendido(s) en el rango`} />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Nombre o NIT cliente</span>
            <input type="text" name="q" defaultValue={sp.q ?? ""} className={`${fieldInputClass} w-56`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Desde</span>
            <input type="date" name="from" defaultValue={from} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Hasta</span>
            <input type="date" name="to" defaultValue={to} className={fieldInputClass} />
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
          <Button type="submit">Buscar Ventas</Button>
          <ButtonLink variant="secondary" href="/devoluciones">
            Limpiar
          </ButtonLink>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Undo2 className="h-6 w-6" />}
            title="Sin ventas en este rango"
            description="Ajusta los filtros de búsqueda."
          />
        ) : (
          <>
            <ScrollHint />
            <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Sucursal</th>
                  <th className="px-3 py-2">Fecha de venta</th>
                  <th className="px-3 py-2">Tipo de venta</th>
                  <th className="px-3 py-2">Nombre cliente</th>
                  <th className="px-3 py-2">NIT cliente</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Precio venta</th>
                  <th className="px-3 py-2">Nro pedidos</th>
                  <th className="px-3 py-2">Devuelto</th>
                  <th className="px-3 py-2">Restante</th>
                  <th className="px-3 py-2">Devolución</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let band = 0;
                  let prevCreatedAt: string | null = null;
                  return rows.map((row) => {
                    const createdAt = row.sale.created_at;
                    if (createdAt !== prevCreatedAt) {
                      band = 1 - band;
                      prevCreatedAt = createdAt;
                    }
                    const returned = returnedByItem.get(row.id) ?? 0;
                    const remaining = row.quantity - returned;
                    return (
                      <tr key={row.id} className={band === 0 ? "bg-emerald-100" : "bg-yellow-100"}>
                        <td className="px-3 py-2">{row.sale.branches?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-500">{formatDateTime(createdAt)}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {SALE_TYPE_LABEL[row.sale.sale_type as SaleType]}
                        </td>
                        <td className="px-3 py-2">{row.sale.customers?.full_name ?? ""}</td>
                        <td className="px-3 py-2 text-slate-500">{row.sale.customers?.nit ?? "—"}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{row.products?.code ?? "—"}</td>
                        <td className="px-3 py-2">{row.unit_price_bs}</td>
                        <td className="px-3 py-2">{row.quantity}</td>
                        <td className="px-3 py-2">{returned}</td>
                        <td className="px-3 py-2">{remaining}</td>
                        <td className="px-3 py-2">
                          {!canReturn ? (
                            <span className="text-xs text-slate-400">Sin permiso</span>
                          ) : remaining <= 0 ? (
                            <span className="text-xs text-slate-400">Devuelto completo</span>
                          ) : (
                            <ReturnRowAction saleItemId={row.id} max={remaining} />
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
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
    </div>
  );
}
