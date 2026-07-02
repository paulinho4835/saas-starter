import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { AdjustStockButton } from "@/components/ajuste-inventario/AdjustStockButton";

type SearchParams = {
  code?: string;
  branchId?: string;
};

type StockRow = {
  id: string;
  product_id: string;
  branch_id: string;
  quantity: number;
  products: { code: string } | null;
  branches: { name: string } | null;
};

const STOCK_SELECT =
  "id, product_id, branch_id, quantity, products!inner(code), branches!inner(name)";

export default async function AjusteInventarioPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("ajuste_inventario");
  const sp = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();
  const canAdjust = can(profile?.role, "productos:write");

  const { data: branchesData } = await supabase
    .from("branches")
    .select("id, name")
    .eq("is_warehouse", false)
    .order("name");
  const branches = branchesData ?? [];

  let stockQuery = supabase.from("product_stock").select(STOCK_SELECT).order("branch_id").limit(100);
  if (sp.code) stockQuery = stockQuery.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.branchId) stockQuery = stockQuery.eq("branch_id", sp.branchId);
  const { data: stockData } = await stockQuery;
  const stockRows = (stockData ?? []) as unknown as StockRow[];

  return (
    <div className="space-y-6">
      <PageHeader title="Ajuste de Inventario" />

      <Card className="p-4">
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
        </form>
      </Card>

      <Card>
        {stockRows.length === 0 ? (
          <EmptyState title="Sin resultados" description="Ajusta los filtros de búsqueda." />
        ) : (
          <ul className="divide-y divide-slate-200">
            {stockRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">
                    {row.products?.code ?? "—"}{" "}
                    <span className="font-normal text-slate-400">· {row.branches?.name ?? "—"}</span>
                  </p>
                  <p className="text-xs text-slate-400">Stock: {row.quantity}</p>
                </div>
                {canAdjust && (
                  <div className="flex shrink-0 gap-2">
                    <AdjustStockButton productId={row.product_id} branchId={row.branch_id} direction="add" />
                    <AdjustStockButton productId={row.product_id} branchId={row.branch_id} direction="reduce" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
