import { ShoppingCart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { toleranceRange } from "@/lib/measurementSearch";
import { SalePanel } from "@/components/ventas/SalePanel";
import { VentasFilters } from "./VentasFilters";

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
  internal_mm: number | null;
  external_mm: number | null;
  height_mm: number | null;
  flange_mm: number | null;
  stop_mm: number | null;
  product_brands: { name: string } | null;
  product_stock: { quantity: number }[];
};

const RESULT_SELECT =
  "id, code, application, price_sf_bs, price_cf_bs, price_may_bs, internal_mm, external_mm, height_mm, flange_mm, stop_mm, product_brands(name), product_stock!inner(quantity)";

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
    .order("internal_mm", { nullsFirst: false })
    .order("external_mm", { nullsFirst: false })
    .order("height_mm", { nullsFirst: false })
    .order("flange_mm", { nullsFirst: false })
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
    internalMm: r.internal_mm,
    externalMm: r.external_mm,
    heightMm: r.height_mm,
    flangeMm: r.flange_mm,
    stopMm: r.stop_mm,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Ventas" subtitle={`${products.length} resultado(s)`} />

      <VentasFilters
        brands={brands}
        initial={{
          code: sp.code ?? "",
          application: sp.application ?? "",
          brandId: sp.brandId ?? "",
          mi: sp.mi ?? "",
          me: sp.me ?? "",
          alt: sp.alt ?? "",
          pest: sp.pest ?? "",
          tope: sp.tope ?? "",
        }}
      />

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
