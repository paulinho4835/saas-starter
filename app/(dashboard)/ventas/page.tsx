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

  const { data: brandsData } = await supabase.from("product_brands").select("id, name").order("name");
  const brands = brandsData ?? [];

  // Si hay algún filtro de medida activo, se prioriza la cercanía al valor
  // buscado (no un orden ascendente crudo, que entierra la coincidencia
  // exacta detrás de valores menores dentro del rango de tolerancia) y se
  // muestran TODOS los resultados dentro del rango de tolerancia, sin recorte
  // — el rango ya acota el universo a productos con esa medida, no hace falta
  // limitar más. Sin filtro de medida, se mantiene el límite normal de
  // navegación general del catálogo.
  const RESULT_LIMIT = 50;
  const hasMeasurementFilter = Boolean(sp.mi || sp.me || sp.alt || sp.pest || sp.tope);

  let query = supabase
    .from("products")
    .select(RESULT_SELECT)
    .eq("product_stock.branch_id", branchId)
    .order("internal_mm", { nullsFirst: false })
    .order("external_mm", { nullsFirst: false })
    .order("height_mm", { nullsFirst: false })
    .order("flange_mm", { nullsFirst: false })
    .order("code")
    .limit(hasMeasurementFilter ? 1000 : RESULT_LIMIT);

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
  let rows = (data ?? []) as unknown as ProductResultRow[];

  if (hasMeasurementFilter) {
    const targetMi = sp.mi ? Number(sp.mi) : null;
    const targetMe = sp.me ? Number(sp.me) : null;
    const targetAlt = sp.alt ? Number(sp.alt) : null;
    const targetPest = sp.pest ? Number(sp.pest) : null;
    const targetTope = sp.tope ? Number(sp.tope) : null;

    function distance(row: ProductResultRow): number {
      let total = 0;
      if (targetMi !== null) total += Math.abs((row.internal_mm ?? targetMi) - targetMi);
      if (targetMe !== null) total += Math.abs((row.external_mm ?? targetMe) - targetMe);
      if (targetAlt !== null) total += Math.abs((row.height_mm ?? targetAlt) - targetAlt);
      if (targetPest !== null) total += Math.abs((row.flange_mm ?? targetPest) - targetPest);
      if (targetTope !== null) total += Math.abs((row.stop_mm ?? targetTope) - targetTope);
      return total;
    }

    rows = [...rows].sort((a, b) => distance(a) - distance(b));
  }

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
        <SalePanel products={products} />
      )}
    </div>
  );
}
