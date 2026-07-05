import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
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
          <ButtonLink variant="secondary" href="/ajuste-inventario">
            Limpiar
          </ButtonLink>
        </form>
      </Card>

      <Card className="overflow-auto">
        {stockRows.length === 0 ? (
          <EmptyState title="Sin resultados" description="Ajusta los filtros de búsqueda." />
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ID producto</th>
                <th className="px-4 py-2">Código producto</th>
                <th className="px-4 py-2">Sucursal</th>
                <th className="px-4 py-2">Stock</th>
                <th className="px-4 py-2"></th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {stockRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2 text-slate-500">{row.product_id.slice(0, 8)}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">{row.products?.code ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{row.branches?.name ?? "—"}</td>
                  <td className="px-4 py-2 font-semibold text-slate-800">{row.quantity}</td>
                  <td className="px-4 py-2">
                    {canAdjust && (
                      <AdjustStockButton productId={row.product_id} branchId={row.branch_id} direction="add" />
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {canAdjust && (
                      <AdjustStockButton productId={row.product_id} branchId={row.branch_id} direction="reduce" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
