import { Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
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
const RESULT_LIMIT = 2000;

type SearchParams = {
  q?: string;
  branchId?: string;
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
  if (matchingCustomerIds) query = query.in("sales.customer_id", matchingCustomerIds);

  const { data } = matchingCustomerIds?.length === 0 ? { data: [] } : await query;
  const rows = ((data ?? []) as unknown as SaleItemRow[]).filter((r) => r.sales !== null);
  rows.sort((a, b) => (b.sales!.created_at < a.sales!.created_at ? -1 : 1));

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
                    const createdAt = row.sales!.created_at;
                    if (createdAt !== prevCreatedAt) {
                      band = 1 - band;
                      prevCreatedAt = createdAt;
                    }
                    const returned = returnedByItem.get(row.id) ?? 0;
                    const remaining = row.quantity - returned;
                    return (
                      <tr key={row.id} className={band === 0 ? "bg-emerald-100" : "bg-yellow-100"}>
                        <td className="px-3 py-2">{row.sales!.branches?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-500">{formatDateTime(createdAt)}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {SALE_TYPE_LABEL[row.sales!.sale_type as SaleType]}
                        </td>
                        <td className="px-3 py-2">{row.sales!.customers?.full_name ?? ""}</td>
                        <td className="px-3 py-2 text-slate-500">{row.sales!.customers?.nit ?? "—"}</td>
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
    </div>
  );
}
