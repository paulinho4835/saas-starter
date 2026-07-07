import { FileBarChart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { SALE_TYPES, SALE_TYPE_LABEL, QR_TYPES, paymentMethodForSaleType, type SaleType } from "@/lib/saleType";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { ScrollHint } from "@/components/ui/ScrollHint";

// Reporte de solo lectura: una fila por producto vendido, con totales al pie.
// Ver docs/superpowers/specs/2026-07-02-reporte-ventas-design.md
const RESULT_LIMIT = 2000;

type SearchParams = {
  q?: string;
  branchId?: string;
  saleType?: string;
  from?: string;
  to?: string;
};

type SaleItemRow = {
  id: string;
  unit_price_bs: number;
  quantity: number;
  subtotal_bs: number;
  products: { code: string } | null;
  sales: {
    created_at: string;
    sale_type: string;
    branches: { name: string } | null;
    customers: { full_name: string; nit: string | null } | null;
  } | null;
};

const SALE_ITEM_SELECT =
  "id, unit_price_bs, quantity, subtotal_bs, products(code), sales!inner(created_at, sale_type, branch_id, branches(name), customers(full_name, nit))";

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

  const { data: branchesData } = await supabase.from("branches").select("id, name").order("name");
  const branches = branchesData ?? [];

  const from = sp.from || todayIso();
  const to = sp.to || todayIso();

  // El filtro de cliente se resuelve aparte: PostgREST no soporta `.or()`
  // sobre una tabla anidada dos niveles (sale_items -> sales -> customers),
  // así que primero se resuelven los ids de cliente que matchean y luego se
  // filtra sale_items por `sales.customer_id`.
  let matchingCustomerIds: string[] | null = null;
  if (sp.q) {
    const q = escapePostgrestFilterValue(sp.q);
    const { data: matchingCustomers } = await supabase
      .from("customers")
      .select("id")
      .or(`full_name.ilike.%${q}%,nit.ilike.%${q}%`);
    matchingCustomerIds = (matchingCustomers ?? []).map((c) => c.id as string);
  }

  let query = supabase
    .from("sale_items")
    .select(SALE_ITEM_SELECT)
    .gte("sales.created_at", from)
    .lte("sales.created_at", `${to}T23:59:59`)
    .order("id", { ascending: false })
    .limit(RESULT_LIMIT);

  if (sp.branchId) query = query.eq("sales.branch_id", sp.branchId);
  if (sp.saleType === "qr") query = query.in("sales.sale_type", QR_TYPES);
  else if (sp.saleType) query = query.eq("sales.sale_type", sp.saleType);
  if (matchingCustomerIds) query = query.in("sales.customer_id", matchingCustomerIds);

  const { data } = matchingCustomerIds?.length === 0 ? { data: [] } : await query;
  const rows = ((data ?? []) as unknown as SaleItemRow[]).filter((r) => r.sales !== null);
  // Ordenar por fecha de venta descendente (el `order` de arriba ordena por
  // id de línea, ya que PostgREST no permite ordenar por una columna de una
  // tabla referenciada a través de !inner en este punto de la cadena).
  rows.sort((a, b) => (b.sales!.created_at < a.sales!.created_at ? -1 : 1));

  let totalBs = 0;
  let totalEfectivoBs = 0;
  let totalQrBs = 0;
  for (const row of rows) {
    totalBs += row.subtotal_bs;
    const method = paymentMethodForSaleType(row.sales!.sale_type as SaleType);
    if (method === "qr") totalQrBs += row.subtotal_bs;
    else totalEfectivoBs += row.subtotal_bs;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Reporte de Ventas" subtitle={`${rows.length} producto(s) vendido(s)`} />

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
                    <td className="px-3 py-2 text-slate-500">{formatDateTime(row.sales!.created_at)}</td>
                    <td className="px-3 py-2">{row.sales!.branches?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {SALE_TYPE_LABEL[row.sales!.sale_type as SaleType]}
                    </td>
                    <td className="px-3 py-2">{row.sales!.customers?.full_name ?? "Mostrador"}</td>
                    <td className="px-3 py-2 text-slate-500">{row.sales!.customers?.nit ?? "—"}</td>
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

      {rows.length > 0 && (
        <Card className="flex flex-wrap gap-6 p-4 text-sm">
          <p>
            <span className="text-slate-500">Total ventas:</span>{" "}
            <span className="font-semibold text-slate-800">{rows.length}</span>
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
