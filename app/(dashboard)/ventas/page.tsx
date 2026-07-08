import { ShoppingCart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { toleranceRange } from "@/lib/measurementSearch";
import { clampPage } from "@/lib/ventasCart";
import { can } from "@/lib/rbac";
import { SalePanel } from "@/components/ventas/SalePanel";
import { VentasFilters } from "./VentasFilters";

const PAGE_SIZE = 25;

type SearchParams = {
  code?: string;
  application?: string;
  brandId?: string;
  mi?: string;
  me?: string;
  alt?: string;
  pest?: string;
  tope?: string;
  page?: string;
};

type ProductResultRow = {
  id: string;
  code: string;
  application: string | null;
  notes: string | null;
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
  "id, code, application, notes, price_sf_bs, price_cf_bs, price_may_bs, internal_mm, external_mm, height_mm, flange_mm, stop_mm, product_brands(name), product_stock!inner(quantity)";

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

  const [{ data: brandsData }, { data: orgData }] = await Promise.all([
    supabase.from("product_brands").select("id, name").order("name"),
    supabase.from("organizations").select("exchange_rate").eq("id", profile.orgId).single(),
  ]);
  const brands = brandsData ?? [];
  const exchangeRate = orgData?.exchange_rate ?? 0;

  // Si hay algún filtro de medida activo, se prioriza la cercanía al valor
  // buscado y se muestran TODOS los resultados dentro del rango de
  // tolerancia sin paginar (paginar rompería el orden por cercanía). Sin
  // filtro de medida, se pagina de a PAGE_SIZE como el resto de los
  // módulos.
  const hasMeasurementFilter = Boolean(sp.mi || sp.me || sp.alt || sp.pest || sp.tope);
  const requestedPage = Math.max(1, Number(sp.page) || 1);

  let query = supabase
    .from("products")
    .select(RESULT_SELECT, { count: hasMeasurementFilter ? undefined : "exact" })
    .eq("product_stock.branch_id", branchId)
    .order("internal_mm", { nullsFirst: false })
    .order("external_mm", { nullsFirst: false })
    .order("height_mm", { nullsFirst: false })
    .order("flange_mm", { nullsFirst: false })
    .order("code");

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

  query = hasMeasurementFilter
    ? query.limit(1000)
    : query.range(0, PAGE_SIZE * 200 - 1); // acotado; el recorte real de página ocurre abajo tras contar

  const { data, count } = await query;
  let rows = (data ?? []) as unknown as ProductResultRow[];

  let page = 1;
  let totalPages = 1;

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
  } else {
    totalPages = Math.max(1, Math.ceil((count ?? rows.length) / PAGE_SIZE));
    page = clampPage(requestedPage, totalPages);
    rows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  const products = rows.map((r) => ({
    id: r.id,
    code: r.code,
    application: r.application,
    notes: r.notes,
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

  // Filtros activos serializados (sin `page`). Se pasan como string a
  // SalePanel — un Client Component no puede recibir una función desde el
  // servidor, así que el link de cada página se arma en el cliente a partir
  // de este querystring base.
  const baseParams = new URLSearchParams();
  if (sp.code) baseParams.set("code", sp.code);
  if (sp.application) baseParams.set("application", sp.application);
  if (sp.brandId) baseParams.set("brandId", sp.brandId);
  if (sp.mi) baseParams.set("mi", sp.mi);
  if (sp.me) baseParams.set("me", sp.me);
  if (sp.alt) baseParams.set("alt", sp.alt);
  if (sp.pest) baseParams.set("pest", sp.pest);
  if (sp.tope) baseParams.set("tope", sp.tope);
  const baseQuery = baseParams.toString();

  return (
    <div className="space-y-6">
      <PageHeader title="Ventas" subtitle={`${products.length} resultado(s)`} />

      {products.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-6 w-6" />}
          title="Sin resultados"
          description="Ajusta los filtros de búsqueda."
        />
      ) : (
        <SalePanel
          products={products}
          filters={
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
          }
          page={page}
          totalPages={totalPages}
          baseQuery={baseQuery}
          exchangeRate={exchangeRate}
          canEditExchangeRate={can(profile.role, "settings:write")}
        />
      )}
    </div>
  );
}
