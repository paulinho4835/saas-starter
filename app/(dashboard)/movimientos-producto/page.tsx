import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { movementTypeLabel, type MovementType } from "@/lib/stockMovements";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { ExportExcelButton } from "@/components/ui/ExportExcelButton";

const PAGE_SIZE = 25;

type SearchParams = {
  code?: string;
  branchId?: string;
  from?: string;
  to?: string;
  page?: string;
};

type MovementRow = {
  id: string;
  movement_type: MovementType;
  quantity_delta: number;
  resulting_quantity: number;
  sale_id: string | null;
  created_at: string;
  products: { id: string; code: string } | null;
  branches: { name: string } | null;
  profiles: { full_name: string } | null;
};

const MOVEMENT_SELECT =
  "id, movement_type, quantity_delta, resulting_quantity, sale_id, created_at, products!inner(id, code), branches!inner(name), profiles(full_name)";

// Fila ya "pivotada" como en el sistema anterior: el monto de venta/devolución
// va bajo la columna de su tipo, en vez de una columna genérica de precio.
type DisplayRow = {
  id: string;
  tipoMovimiento: string;
  fecha: string;
  ajusteInventario: number | null;
  cantidad: number;
  compraCf: number | null;
  compraSf: number | null;
  compraMay: number | null;
  devolucion: number | null;
  usuario: string;
  stockActualizado: number;
  productCode: string;
  branchName: string;
};

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
  if (sp.from) movementsQuery = movementsQuery.gte("created_at", sp.from);
  if (sp.to) movementsQuery = movementsQuery.lte("created_at", `${sp.to}T23:59:59`);
  const { data: movementsData, count: movementsCount } = await movementsQuery;
  const movementRows = (movementsData ?? []) as unknown as MovementRow[];
  const totalMovements = movementsCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalMovements / PAGE_SIZE));

  // Ventas y devoluciones no guardan el monto en stock_movements — se cruza
  // con sale_items (precio/tier) y sale_returns (monto) por (sale_id, product_id).
  const saleIds = [...new Set(movementRows.map((m) => m.sale_id).filter((id): id is string => !!id))];

  const saleItemMap = new Map<string, { priceTier: "sf" | "cf" | "may"; subtotalBs: number }>();
  const returnMap = new Map<string, number>();
  if (saleIds.length > 0) {
    const [{ data: saleItemsData }, { data: returnsData }] = await Promise.all([
      supabase.from("sale_items").select("sale_id, product_id, price_tier, subtotal_bs").in("sale_id", saleIds),
      supabase.from("sale_returns").select("sale_id, product_id, amount_bs").in("sale_id", saleIds),
    ]);
    for (const item of saleItemsData ?? []) {
      saleItemMap.set(`${item.sale_id}-${item.product_id}`, {
        priceTier: item.price_tier as "sf" | "cf" | "may",
        subtotalBs: item.subtotal_bs,
      });
    }
    for (const ret of returnsData ?? []) {
      const key = `${ret.sale_id}-${ret.product_id}`;
      returnMap.set(key, (returnMap.get(key) ?? 0) + ret.amount_bs);
    }
  }

  const rows: DisplayRow[] = movementRows
    .filter((m) => m.products)
    .map((m) => {
      const key = m.sale_id && m.products ? `${m.sale_id}-${m.products.id}` : null;
      const saleItem = key ? saleItemMap.get(key) : undefined;
      const returnAmount = key ? returnMap.get(key) : undefined;

      let ajusteInventario: number | null = null;
      let compraCf: number | null = null;
      let compraSf: number | null = null;
      let compraMay: number | null = null;
      let devolucion: number | null = null;

      if (m.movement_type === "venta" && saleItem) {
        if (saleItem.priceTier === "cf") compraCf = saleItem.subtotalBs;
        else if (saleItem.priceTier === "sf") compraSf = saleItem.subtotalBs;
        else compraMay = saleItem.subtotalBs;
      } else if (m.movement_type === "devolucion") {
        devolucion = returnAmount ?? null;
      } else {
        ajusteInventario = m.quantity_delta;
      }

      return {
        id: m.id,
        tipoMovimiento: movementTypeLabel(m.movement_type),
        fecha: new Date(m.created_at).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" }),
        ajusteInventario,
        cantidad: Math.abs(m.quantity_delta),
        compraCf,
        compraSf,
        compraMay,
        devolucion,
        usuario: m.profiles?.full_name ?? "Sistema",
        stockActualizado: m.resulting_quantity,
        productCode: m.products!.code,
        branchName: m.branches?.name ?? "—",
      };
    });

  function buildHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.code) params.set("code", sp.code);
    if (sp.branchId) params.set("branchId", sp.branchId);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    params.set("page", String(targetPage));
    return `/movimientos-producto?${params.toString()}`;
  }

  function fmt(value: number | null): string {
    return value === null ? "" : String(value);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Movimientos de Producto" subtitle={`${totalMovements} registrado(s)`} />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Código de producto</span>
            <input type="text" name="code" defaultValue={sp.code ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Desde</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Hasta</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} className={fieldInputClass} />
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
          <Button type="submit">Ver movimientos</Button>
          <ButtonLink variant="secondary" href="/movimientos-producto">
            Limpiar
          </ButtonLink>
        </form>
      </Card>

      <Card className="overflow-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Sin movimientos"
            description="Ajusta los filtros de búsqueda."
          />
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">Tipo movimiento</th>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Ajuste de inventario</th>
                <th className="px-4 py-2">Cantidad</th>
                <th className="px-4 py-2">Compra CF</th>
                <th className="px-4 py-2">Compra SF</th>
                <th className="px-4 py-2">Compra MAY</th>
                <th className="px-4 py-2">Devolución</th>
                <th className="px-4 py-2">Usuario</th>
                <th className="px-4 py-2">Stock actualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{r.tipoMovimiento}</td>
                  <td className="px-4 py-2 text-slate-500">{r.fecha}</td>
                  <td className="px-4 py-2 text-slate-500">{fmt(r.ajusteInventario)}</td>
                  <td className="px-4 py-2 text-slate-500">{r.cantidad}</td>
                  <td className="px-4 py-2 text-slate-500">{fmt(r.compraCf)}</td>
                  <td className="px-4 py-2 text-slate-500">{fmt(r.compraSf)}</td>
                  <td className="px-4 py-2 text-slate-500">{fmt(r.compraMay)}</td>
                  <td className="px-4 py-2 text-slate-500">{fmt(r.devolucion)}</td>
                  <td className="px-4 py-2 text-slate-500">{r.usuario}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">{r.stockActualizado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {rows.length > 0 && (
        <p className="text-lg font-semibold text-slate-800">
          Stock actualizado: {rows[0].stockActualizado}
        </p>
      )}

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
        <ExportExcelButton
          filenamePrefix="movimientos-producto"
          sheetName="Movimientos"
          rows={rows.map((r) => ({
            "Tipo movimiento": r.tipoMovimiento,
            Fecha: r.fecha,
            "Código producto": r.productCode,
            Sucursal: r.branchName,
            "Ajuste de inventario": r.ajusteInventario ?? "",
            Cantidad: r.cantidad,
            "Compra CF": r.compraCf ?? "",
            "Compra SF": r.compraSf ?? "",
            "Compra MAY": r.compraMay ?? "",
            Devolución: r.devolucion ?? "",
            Usuario: r.usuario,
            "Stock actualizado": r.stockActualizado,
          }))}
        />
      )}
    </div>
  );
}
