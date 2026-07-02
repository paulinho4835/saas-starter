import { Warehouse } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { AlmacenFilters } from "./AlmacenFilters";
import { TransferStockButton } from "@/components/almacen/TransferStockButton";

type SearchParams = {
  code?: string;
  application?: string;
  brandId?: string;
};

type StockRow = {
  quantity: number;
  products: {
    id: string;
    code: string;
    application: string | null;
    brand_id: string | null;
    product_brands: { name: string } | null;
  } | null;
};

const STOCK_SELECT =
  "quantity, products!inner(id, code, application, brand_id, product_brands(name))";

export default async function AlmacenPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("almacen");
  const sp = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();
  const canTransfer = can(profile?.role, "almacen:transfer");

  if (!profile?.orgId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Almacén" />
        <EmptyState icon={<Warehouse className="h-6 w-6" />} title="Sesión no válida" description="" />
      </div>
    );
  }

  const [{ data: warehouse }, { data: destinationBranchesData }, { data: brandsData }] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name")
      .eq("org_id", profile.orgId)
      .eq("is_warehouse", true)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, name")
      .eq("org_id", profile.orgId)
      .eq("is_warehouse", false)
      .order("name"),
    supabase.from("product_brands").select("id, name").order("name"),
  ]);
  const destinationBranches = destinationBranchesData ?? [];
  const brands = brandsData ?? [];

  if (!warehouse) {
    return (
      <div className="space-y-6">
        <PageHeader title="Almacén" />
        <EmptyState
          icon={<Warehouse className="h-6 w-6" />}
          title="No hay un almacén configurado"
          description="Pide al administrador que marque una sucursal como almacén."
        />
      </div>
    );
  }

  let query = supabase
    .from("product_stock")
    .select(STOCK_SELECT)
    .eq("branch_id", warehouse.id)
    .order("products(code)")
    .limit(50);

  if (sp.code) query = query.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.application)
    query = query.ilike("products.application", `%${escapePostgrestFilterValue(sp.application)}%`);
  if (sp.brandId) query = query.eq("products.brand_id", sp.brandId);

  const { data } = await query;
  const rows = (data ?? []) as unknown as StockRow[];

  return (
    <div className="space-y-6">
      <PageHeader title="Almacén" subtitle={`${warehouse.name} · ${rows.length} resultado(s)`} />

      <AlmacenFilters
        brands={brands}
        initial={{
          code: sp.code ?? "",
          application: sp.application ?? "",
          brandId: sp.brandId ?? "",
        }}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Warehouse className="h-6 w-6" />}
            title="Sin resultados"
            description="Ajusta los filtros de búsqueda."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {rows.map((row) =>
              row.products ? (
                <li key={row.products.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">
                      {row.products.code}{" "}
                      <span className="font-normal text-slate-400">
                        · {row.products.product_brands?.name ?? "—"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {row.products.application ?? "—"} · Stock: {row.quantity}
                    </p>
                  </div>
                  {canTransfer && (
                    <div className="shrink-0">
                      <TransferStockButton
                        productId={row.products.id}
                        destinationBranches={destinationBranches}
                      />
                    </div>
                  )}
                </li>
              ) : null,
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}
