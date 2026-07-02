import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { movementTypeLabel, MOVEMENT_TYPES, type MovementType } from "@/lib/stockMovements";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";

const PAGE_SIZE = 25;

type SearchParams = {
  code?: string;
  branchId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: string;
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

const MOVEMENT_SELECT =
  "id, movement_type, quantity_delta, resulting_quantity, reason, sale_id, created_at, products!inner(code), branches!inner(name), profiles(full_name)";

export default async function MovimientosProductoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("movimientos_producto");
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: branchesData } = await supabase.from("branches").select("id, name").order("name");
  const branches = branchesData ?? [];

  const page = Math.max(1, Number(sp.page) || 1);
  let movementsQuery = supabase
    .from("stock_movements")
    .select(MOVEMENT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.code)
    movementsQuery = movementsQuery.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.branchId) movementsQuery = movementsQuery.eq("branch_id", sp.branchId);
  if (sp.type) movementsQuery = movementsQuery.eq("movement_type", sp.type);
  if (sp.from) movementsQuery = movementsQuery.gte("created_at", sp.from);
  if (sp.to) movementsQuery = movementsQuery.lte("created_at", `${sp.to}T23:59:59`);
  const { data: movementsData, count: movementsCount } = await movementsQuery;
  const movementRows = (movementsData ?? []) as unknown as MovementRow[];
  const totalMovements = movementsCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalMovements / PAGE_SIZE));

  function buildHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.code) params.set("code", sp.code);
    if (sp.branchId) params.set("branchId", sp.branchId);
    if (sp.type) params.set("type", sp.type);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    params.set("page", String(targetPage));
    return `/movimientos-producto?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Movimientos de Producto" subtitle={`${totalMovements} registrado(s)`} />

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
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Tipo</span>
            <select name="type" defaultValue={sp.type ?? ""} className={fieldInputClass}>
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
            <input type="date" name="from" defaultValue={sp.from ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Hasta</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} className={fieldInputClass} />
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
    </div>
  );
}
