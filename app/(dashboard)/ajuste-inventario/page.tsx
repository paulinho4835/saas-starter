import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { movementTypeLabel, MOVEMENT_TYPES, type MovementType } from "@/lib/stockMovements";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { AdjustStockButton } from "@/components/ajuste-inventario/AdjustStockButton";

const PAGE_SIZE = 25;

type SearchParams = {
  code?: string;
  branchId?: string;
  hcode?: string;
  hbranchId?: string;
  htype?: string;
  hfrom?: string;
  hto?: string;
  hpage?: string;
};

type StockRow = {
  id: string;
  product_id: string;
  branch_id: string;
  quantity: number;
  products: { code: string } | null;
  branches: { name: string } | null;
};

type MovementRow = {
  id: string;
  movement_type: MovementType;
  quantity_delta: number;
  resulting_quantity: number;
  reason: string | null;
  sale_id: string | null;
  created_at: string;
  products: { code: string } | null;
  branches: { name: string } | null;
  profiles: { full_name: string } | null;
};

const STOCK_SELECT =
  "id, product_id, branch_id, quantity, products!inner(code), branches!inner(name)";
const MOVEMENT_SELECT =
  "id, movement_type, quantity_delta, resulting_quantity, reason, sale_id, created_at, products!inner(code), branches!inner(name), profiles(full_name)";

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

  const { data: branchesData } = await supabase.from("branches").select("id, name").order("name");
  const branches = branchesData ?? [];

  // ── Bloque "Productos": stock actual, filtrable por código y sucursal ────
  let stockQuery = supabase.from("product_stock").select(STOCK_SELECT).order("branch_id").limit(100);
  if (sp.code) stockQuery = stockQuery.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.branchId) stockQuery = stockQuery.eq("branch_id", sp.branchId);
  const { data: stockData } = await stockQuery;
  const stockRows = (stockData ?? []) as unknown as StockRow[];

  // ── Bloque "Historial": movimientos, filtrable por código, sucursal, tipo y fecha ──
  const hpage = Math.max(1, Number(sp.hpage) || 1);
  let movementsQuery = supabase
    .from("stock_movements")
    .select(MOVEMENT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((hpage - 1) * PAGE_SIZE, hpage * PAGE_SIZE - 1);
  if (sp.hcode)
    movementsQuery = movementsQuery.ilike("products.code", `%${escapePostgrestFilterValue(sp.hcode)}%`);
  if (sp.hbranchId) movementsQuery = movementsQuery.eq("branch_id", sp.hbranchId);
  if (sp.htype) movementsQuery = movementsQuery.eq("movement_type", sp.htype);
  if (sp.hfrom) movementsQuery = movementsQuery.gte("created_at", sp.hfrom);
  if (sp.hto) movementsQuery = movementsQuery.lte("created_at", `${sp.hto}T23:59:59`);
  const { data: movementsData, count: movementsCount } = await movementsQuery;
  const movementRows = (movementsData ?? []) as unknown as MovementRow[];
  const totalMovements = movementsCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalMovements / PAGE_SIZE));

  function buildHistorialHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.code) params.set("code", sp.code);
    if (sp.branchId) params.set("branchId", sp.branchId);
    if (sp.hcode) params.set("hcode", sp.hcode);
    if (sp.hbranchId) params.set("hbranchId", sp.hbranchId);
    if (sp.htype) params.set("htype", sp.htype);
    if (sp.hfrom) params.set("hfrom", sp.hfrom);
    if (sp.hto) params.set("hto", sp.hto);
    params.set("hpage", String(targetPage));
    return `/ajuste-inventario?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ajuste de Inventario" />

      {/* ── Productos ─────────────────────────────────────────────────── */}
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <input type="hidden" name="hpage" value="1" />
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
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Sin resultados"
            description="Ajusta los filtros de búsqueda."
          />
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

      {/* ── Historial de movimientos ──────────────────────────────────── */}
      <PageHeader title="Historial de movimientos" subtitle={`${totalMovements} registrado(s)`} />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Código</span>
            <input type="text" name="hcode" defaultValue={sp.hcode ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Sucursal</span>
            <select name="hbranchId" defaultValue={sp.hbranchId ?? ""} className={fieldInputClass}>
              <option value="">Todas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Tipo</span>
            <select name="htype" defaultValue={sp.htype ?? ""} className={fieldInputClass}>
              <option value="">Todos</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {movementTypeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Desde</span>
            <input type="date" name="hfrom" defaultValue={sp.hfrom ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Hasta</span>
            <input type="date" name="hto" defaultValue={sp.hto ?? ""} className={fieldInputClass} />
          </label>
          <Button type="submit">Buscar</Button>
        </form>
      </Card>

      <Card>
        {movementRows.length === 0 ? (
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Sin movimientos"
            description="Ajusta los filtros de búsqueda."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {movementRows.map((m) => (
              <li key={m.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {m.products?.code ?? "—"}{" "}
                    <span className="font-normal text-slate-400">· {m.branches?.name ?? "—"}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(m.created_at).toLocaleString("es-BO", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {movementTypeLabel(m.movement_type)} · {m.quantity_delta > 0 ? "+" : ""}
                  {m.quantity_delta} · Stock resultante: {m.resulting_quantity} ·{" "}
                  {m.profiles?.full_name ?? "Sistema"}
                  {m.reason ? ` · ${m.reason}` : ""}
                  {m.sale_id ? ` · Venta ${m.sale_id.slice(0, 8)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          {hpage > 1 ? (
            <ButtonLink variant="secondary" size="sm" href={buildHistorialHref(hpage - 1)}>
              Anterior
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Anterior
            </Button>
          )}
          <span>
            Página {hpage} de {totalPages}
          </span>
          {hpage < totalPages ? (
            <ButtonLink variant="secondary" size="sm" href={buildHistorialHref(hpage + 1)}>
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
