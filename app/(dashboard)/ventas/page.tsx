import { ShoppingCart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { toleranceRange } from "@/lib/measurementSearch";
import { SalePanel } from "@/components/ventas/SalePanel";

type SearchParams = {
  code?: string;
  application?: string;
  brandId?: string;
  mi?: string;
  me?: string;
  alt?: string;
  pest?: string;
  tope?: string;
};

type ProductResultRow = {
  id: string;
  code: string;
  application: string | null;
  price_sf_bs: number;
  price_cf_bs: number;
  price_may_bs: number;
  product_brands: { name: string } | null;
  product_stock: { quantity: number }[];
};

const RESULT_SELECT =
  "id, code, application, price_sf_bs, price_cf_bs, price_may_bs, product_brands(name), product_stock!inner(quantity)";

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("ventas");
  const sp = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();

  if (!profile?.branchId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Ventas" />
        <EmptyState
          icon={<ShoppingCart className="h-6 w-6" />}
          title="No tienes una sucursal asignada"
          description="Pide al administrador que te asigne una sucursal en Ajustes antes de vender."
        />
      </div>
    );
  }

  const branchId = profile.branchId;

  const [{ data: brandsData }, { data: customersData }] = await Promise.all([
    supabase.from("product_brands").select("id, name").order("name"),
    supabase.from("customers").select("id, full_name").order("full_name"),
  ]);
  const brands = brandsData ?? [];
  const customers = customersData ?? [];

  let query = supabase
    .from("products")
    .select(RESULT_SELECT)
    .eq("product_stock.branch_id", branchId)
    .order("code")
    .limit(50);

  if (sp.code) query = query.ilike("code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.application)
    query = query.ilike("application", `%${escapePostgrestFilterValue(sp.application)}%`);
  if (sp.brandId) query = query.eq("brand_id", sp.brandId);
  if (sp.mi) {
    const [lo, hi] = toleranceRange(Number(sp.mi));
    query = query.gte("internal_mm", lo).lte("internal_mm", hi);
  }
  if (sp.me) {
    const [lo, hi] = toleranceRange(Number(sp.me));
    query = query.gte("external_mm", lo).lte("external_mm", hi);
  }
  if (sp.alt) {
    const [lo, hi] = toleranceRange(Number(sp.alt));
    query = query.gte("height_mm", lo).lte("height_mm", hi);
  }
  if (sp.pest) {
    const [lo, hi] = toleranceRange(Number(sp.pest));
    query = query.gte("flange_mm", lo).lte("flange_mm", hi);
  }
  if (sp.tope) {
    const [lo, hi] = toleranceRange(Number(sp.tope));
    query = query.gte("stop_mm", lo).lte("stop_mm", hi);
  }

  const { data } = await query;
  const rows = (data ?? []) as unknown as ProductResultRow[];
  const products = rows.map((r) => ({
    id: r.id,
    code: r.code,
    application: r.application,
    brandName: r.product_brands?.name ?? "—",
    priceSfBs: r.price_sf_bs,
    priceCfBs: r.price_cf_bs,
    priceMayBs: r.price_may_bs,
    stock: r.product_stock[0]?.quantity ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Ventas" subtitle={`${products.length} resultado(s)`} />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Código</span>
            <input
              type="text"
              name="code"
              defaultValue={sp.code ?? ""}
              className={fieldInputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Aplicación</span>
            <input
              type="text"
              name="application"
              defaultValue={sp.application ?? ""}
              className={fieldInputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Marca</span>
            <select name="brandId" defaultValue={sp.brandId ?? ""} className={fieldInputClass}>
              <option value="">Todas</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">MI</span>
            <input
              type="number"
              step="0.01"
              name="mi"
              defaultValue={sp.mi ?? ""}
              className={`${fieldInputClass} w-24`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">ME</span>
            <input
              type="number"
              step="0.01"
              name="me"
              defaultValue={sp.me ?? ""}
              className={`${fieldInputClass} w-24`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Altura</span>
            <input
              type="number"
              step="0.01"
              name="alt"
              defaultValue={sp.alt ?? ""}
              className={`${fieldInputClass} w-24`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Pestaña</span>
            <input
              type="number"
              step="0.01"
              name="pest"
              defaultValue={sp.pest ?? ""}
              className={`${fieldInputClass} w-24`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Tope</span>
            <input
              type="number"
              step="0.01"
              name="tope"
              defaultValue={sp.tope ?? ""}
              className={`${fieldInputClass} w-24`}
            />
          </label>
          <Button type="submit">Buscar</Button>
        </form>
      </Card>

      {products.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-6 w-6" />}
          title="Sin resultados"
          description="Ajusta los filtros de búsqueda."
        />
      ) : (
        <SalePanel products={products} customers={customers} />
      )}
    </div>
  );
}
