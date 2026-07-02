import { ArrowLeftRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TraspasosFilters } from "./TraspasosFilters";
import { TransferBetweenBranchesButton } from "@/components/traspasos/TransferBetweenBranchesButton";

type SearchParams = {
  code?: string;
  application?: string;
  brandId?: string;
  branchId?: string;
};

type StockRow = {
  quantity: number;
  branch_id: string;
  branches: { name: string } | null;
  products: {
    id: string;
    code: string;
    application: string | null;
    brand_id: string | null;
    product_brands: { name: string } | null;
  } | null;
};

const STOCK_SELECT =
  "quantity, branch_id, branches!inner(name), products!inner(id, code, application, brand_id, product_brands(name))";

export default async function TraspasosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("traspasos");
  const sp = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();
  const canTransfer = can(profile?.role, "traspasos:create");

  if (!profile?.orgId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Traspasos" />
        <EmptyState icon={<ArrowLeftRight className="h-6 w-6" />} title="Sesión no válida" description="" />
      </div>
    );
  }

  const [{ data: branchesData }, { data: brandsData }] = await Promise.all([
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("product_brands").select("id, name").order("name"),
  ]);
  const branches = branchesData ?? [];
  const brands = brandsData ?? [];

  let query = supabase
    .from("product_stock")
    .select(STOCK_SELECT)
    .gt("quantity", 0)
    .order("products(code)")
    .limit(100);

  if (sp.code) query = query.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.application)
    query = query.ilike("products.application", `%${escapePostgrestFilterValue(sp.application)}%`);
  if (sp.brandId) query = query.eq("products.brand_id", sp.brandId);
  if (sp.branchId) query = query.eq("branch_id", sp.branchId);

  const { data } = await query;
  const rows = (data ?? []) as unknown as StockRow[];

  return (
    <div className="space-y-6">
      <PageHeader title="Traspasos" subtitle={`Stock disponible para transferir · ${rows.length} resultado(s)`} />

      <TraspasosFilters
        branches={branches}
        brands={brands}
        initial={{
          code: sp.code ?? "",
          application: sp.application ?? "",
          brandId: sp.brandId ?? "",
          branchId: sp.branchId ?? "",
        }}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="h-6 w-6" />}
            title="Sin resultados"
            description="Ajusta los filtros de búsqueda."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {rows.map((row) =>
              row.products ? (
                <li
                  key={`${row.products.id}-${row.branch_id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">
                      {row.products.code}{" "}
                      <span className="font-normal text-slate-400">
                        · {row.products.product_brands?.name ?? "—"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {row.products.application ?? "—"} · {row.branches?.name ?? "—"} · Stock: {row.quantity}
                    </p>
                  </div>
                  {canTransfer && (
                    <div className="shrink-0">
                      <TransferBetweenBranchesButton
                        productId={row.products.id}
                        fromBranchId={row.branch_id}
                        fromBranchName={row.branches?.name ?? "esta sucursal"}
                        maxQuantity={row.quantity}
                        destinationBranches={branches.filter((b) => b.id !== row.branch_id)}
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
