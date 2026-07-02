import { ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { PrintButton } from "@/components/pedidos/PrintButton";
import { PedidosList, type PedidoGroup } from "@/components/pedidos/PedidosList";

const LOW_STOCK_THRESHOLD = 5;

type SearchParams = {
  code?: string;
  branchId?: string;
};

type StockRow = {
  quantity: number;
  branches: { name: string } | null;
  products: {
    id: string;
    code: string;
    application: string | null;
    product_brands: { name: string } | null;
    suppliers: { name: string } | null;
    internal_mm: number | null;
    external_mm: number | null;
    height_mm: number | null;
    flange_mm: number | null;
    stop_mm: number | null;
  } | null;
};

const STOCK_SELECT =
  "quantity, branches!inner(name), products!inner(id, code, application, product_brands(name), suppliers(name), internal_mm, external_mm, height_mm, flange_mm, stop_mm)";

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("pedidos");
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: branchesData } = await supabase.from("branches").select("id, name").order("name");
  const branches = branchesData ?? [];

  let query = supabase
    .from("product_stock")
    .select(STOCK_SELECT)
    .lt("quantity", LOW_STOCK_THRESHOLD)
    .order("quantity", { ascending: true })
    .order("products(code)")
    .limit(200);

  if (sp.code) query = query.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.branchId) query = query.eq("branch_id", sp.branchId);

  const { data } = await query;
  const rows = (data ?? []) as unknown as StockRow[];

  const groupsBySupplier = new Map<string, PedidoGroup>();
  for (const [i, row] of rows.entries()) {
    if (!row.products) continue;
    const supplier = row.products.suppliers?.name ?? "Sin proveedor";
    if (!groupsBySupplier.has(supplier)) {
      groupsBySupplier.set(supplier, { supplier, rows: [] });
    }
    groupsBySupplier.get(supplier)!.rows.push({
      key: `${row.products.id}-${row.branches?.name ?? i}`,
      code: row.products.code,
      brand: row.products.product_brands?.name ?? null,
      application: row.products.application,
      branch: row.branches?.name ?? null,
      quantity: row.quantity,
      internalMm: row.products.internal_mm,
      externalMm: row.products.external_mm,
      heightMm: row.products.height_mm,
      flangeMm: row.products.flange_mm,
      stopMm: row.products.stop_mm,
    });
  }
  const sinProveedor = groupsBySupplier.get("Sin proveedor");
  groupsBySupplier.delete("Sin proveedor");
  const groups = [...groupsBySupplier.values()].sort((a, b) =>
    a.supplier.localeCompare(b.supplier, "es"),
  );
  if (sinProveedor) groups.push(sinProveedor);

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title="Pedidos"
          subtitle={`Productos con stock menor a ${LOW_STOCK_THRESHOLD} · ${rows.length} resultado(s)`}
        />
      </div>

      <Card className="p-4 print:hidden">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Código</span>
            <input type="text" name="code" defaultValue={sp.code ?? ""} className={fieldInputClass} />
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
          <Button type="submit">Buscar</Button>
          <div className="ml-auto">
            <PrintButton />
          </div>
        </form>
      </Card>

      <div className="hidden print:block print:mb-4 print:text-lg print:font-semibold">
        Pedido de reposición — stock menor a {LOW_STOCK_THRESHOLD}
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title="Sin productos por pedir"
            description="Ningún producto tiene stock menor a 5 con los filtros actuales."
          />
        </Card>
      ) : (
        <PedidosList groups={groups} />
      )}
    </div>
  );
}
