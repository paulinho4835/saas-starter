import { ArrowLeftRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireNavAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { clampPage } from "@/lib/ventasCart";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import type { TransferRole, TransferType } from "@/lib/transferStatus";
import { TraspasosFilters } from "./TraspasosFilters";
import { SolicitudEnvioTab } from "@/components/traspasos/SolicitudEnvioTab";
import { SalientesEntrantesTab } from "@/components/traspasos/SalientesEntrantesTab";
import type { TransferProduct } from "@/components/traspasos/TransferProductsTable";
import type { TransferCardData, TransferCardItem } from "@/components/traspasos/TransferStatusCard";

// El legacy pagina el listado de Solicitud/Envío de a 10 (Producto::filtro_producto_por_codigo).
const PAGE_SIZE = 10;

type TabKey = "sol_env" | "salientes" | "entrantes";

type SearchParams = {
  tab?: string;
  code?: string;
  page?: string;
};

type TransferItemRow = {
  product_id: string;
  quantity_requested: number;
  quantity_sent: number | null;
  products: { code: string; application: string | null } | null;
};

type TransferRow = {
  id: string;
  type: TransferType;
  status: TransferCardData["status"];
  created_at: string;
  from_branch: { name: string } | null;
  to_branch: { name: string } | null;
  transfer_items: TransferItemRow[];
};

const TRANSFER_SELECT =
  "id, type, status, created_at, from_branch:branches!transfers_from_branch_id_fkey(name), to_branch:branches!transfers_to_branch_id_fkey(name), transfer_items(product_id, quantity_requested, quantity_sent, products(code, application))";

export default async function TraspasosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("traspasos");
  const sp = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();

  if (!profile?.branchId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Traspasos" />
        <EmptyState
          icon={<ArrowLeftRight className="h-6 w-6" />}
          title="No tienes una sucursal asignada"
          description="Pide al administrador que te asigne una sucursal en Ajustes antes de hacer traspasos."
        />
      </div>
    );
  }

  const branchId = profile.branchId;
  const canManage = can(profile.role, "traspasos:create");
  const tab: TabKey = sp.tab === "salientes" || sp.tab === "entrantes" ? sp.tab : "sol_env";

  const { data: branchesData } = await supabase
    .from("branches")
    .select("id, name")
    .neq("id", branchId)
    .order("name");
  const branches = branchesData ?? [];

  async function buildTransferCards(
    type: TransferType,
    branchColumn: "from_branch_id" | "to_branch_id",
    role: TransferRole,
  ): Promise<TransferCardData[]> {
    const { data } = await supabase
      .from("transfers")
      .select(TRANSFER_SELECT)
      .eq("type", type)
      .eq(branchColumn, branchId)
      .not("status", "in", "(entregado,rechazado,cancelado)")
      .order("created_at", { ascending: true });

    const rows = (data ?? []) as unknown as TransferRow[];

    // "Stock actual" solo aplica a Pedidos donde mi sucursal decide enviar
    // (role='origin') — se muestra para decidir cuánto puede realmente
    // cubrir, igual que el legacy.
    let stockByProduct = new Map<string, number>();
    if (type === "pedido" && role === "origin") {
      const productIds = [...new Set(rows.flatMap((r) => r.transfer_items.map((i) => i.product_id)))];
      if (productIds.length > 0) {
        const { data: stockRows } = await supabase
          .from("product_stock")
          .select("product_id, quantity")
          .eq("branch_id", branchId)
          .in("product_id", productIds);
        stockByProduct = new Map(
          (stockRows ?? []).map((s) => [s.product_id as string, s.quantity as number]),
        );
      }
    }

    return rows.map((r) => {
      const counterBranch = role === "origin" ? r.to_branch : r.from_branch;
      const items: TransferCardItem[] = r.transfer_items.map((i) => ({
        productId: i.product_id,
        code: i.products?.code ?? "—",
        application: i.products?.application ?? null,
        quantityRequested: i.quantity_requested,
        quantitySent: i.quantity_sent,
        currentStock:
          type === "pedido" && role === "origin" ? (stockByProduct.get(i.product_id) ?? 0) : null,
      }));
      return {
        id: r.id,
        createdAt: r.created_at,
        counterBranchName: counterBranch?.name ?? "—",
        status: r.status,
        role,
        type: r.type,
        items,
      };
    });
  }

  if (tab === "salientes") {
    const [pedidos, envios] = await Promise.all([
      buildTransferCards("pedido", "to_branch_id", "destination"),
      buildTransferCards("envio", "from_branch_id", "origin"),
    ]);
    return (
      <div className="space-y-6">
        <PageHeader title="Traspasos" />
        {tabsNav(tab)}
        <SalientesEntrantesTab
          pedidoTitle="Pedidos de Productos"
          envioTitle="Envío de productos"
          pedidos={pedidos}
          envios={envios}
          canManage={canManage}
        />
      </div>
    );
  }

  if (tab === "entrantes") {
    const [pedidos, envios] = await Promise.all([
      buildTransferCards("pedido", "from_branch_id", "origin"),
      buildTransferCards("envio", "to_branch_id", "destination"),
    ]);
    return (
      <div className="space-y-6">
        <PageHeader title="Traspasos" />
        {tabsNav(tab)}
        <SalientesEntrantesTab
          pedidoTitle="Pedidos"
          envioTitle="Recepción de Envíos"
          pedidos={pedidos}
          envios={envios}
          canManage={canManage}
        />
      </div>
    );
  }

  // tab === "sol_env"
  const explicitPage = sp.page ? Math.max(1, Number(sp.page) || 1) : 1;
  let query = supabase
    .from("products")
    .select("id, code, application, product_stock!inner(quantity)", { count: "exact" })
    .eq("active", true)
    .eq("product_stock.branch_id", branchId)
    .order("created_at", { ascending: false });
  if (sp.code) query = query.ilike("code", `%${escapePostgrestFilterValue(sp.code)}%`);

  const { data, count } = await query.range(0, PAGE_SIZE * 200 - 1);
  const allRows = (data ?? []) as unknown as {
    id: string;
    code: string;
    application: string | null;
    product_stock: { quantity: number }[];
  }[];
  const totalPages = Math.max(1, Math.ceil((count ?? allRows.length) / PAGE_SIZE));
  const page = clampPage(explicitPage, totalPages);
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const products: TransferProduct[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    application: r.application,
    stock: r.product_stock[0]?.quantity ?? 0,
  }));

  const baseParams = new URLSearchParams();
  if (sp.code) baseParams.set("code", sp.code);
  const baseQuery = baseParams.toString();

  return (
    <div className="space-y-6">
      <PageHeader title="Traspasos" />
      {tabsNav(tab)}
      <SolicitudEnvioTab
        products={products}
        page={page}
        totalPages={totalPages}
        baseQuery={baseQuery}
        branches={branches}
        ownBranchId={branchId}
        filters={<TraspasosFilters initialCode={sp.code ?? ""} />}
        canManage={canManage}
      />
    </div>
  );
}

function tabsNav(active: TabKey) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "sol_env", label: "Solicitud/Envío" },
    { key: "salientes", label: "Salientes" },
    { key: "entrantes", label: "Entrantes" },
  ];
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <a
          key={t.key}
          href={`/traspasos?tab=${t.key}`}
          className={`px-4 py-2 text-sm font-medium ${
            t.key === active ? "border-b-2 border-brand text-brand" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}
