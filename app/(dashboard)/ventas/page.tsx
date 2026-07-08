import { ShoppingCart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { toleranceRange, closestMatch, type MeasurementRow } from "@/lib/measurementSearch";
import { clampPage } from "@/lib/ventasCart";
import { can } from "@/lib/rbac";
import { SalePanel } from "@/components/ventas/SalePanel";
import { VentasFilters } from "./VentasFilters";

// El legacy (Venta Retenes) pagina 75 productos por página.
const PAGE_SIZE = 75;

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

  const [{ data: brandsData }, { data: orgData }] = await Promise.all([
    supabase.from("product_brands").select("id, name").order("name"),
    supabase.from("organizations").select("exchange_rate").eq("id", profile.orgId).single(),
  ]);
  const brands = brandsData ?? [];
  const exchangeRate = orgData?.exchange_rate ?? 0;

  // El legacy ordena SIEMPRE por medida_externa, medida_interna, altura,
  // pestaña, tope (todas ASC) — con o sin filtro de medida activo — y pagina
  // 75 por página. Cuando hay un filtro de medida, además calcula a qué
  // página saltar automáticamente (la que contiene la coincidencia exacta o
  // la más cercana), sin reordenar los resultados por cercanía.
  const hasMeasurementFilter = Boolean(sp.mi || sp.me || sp.alt || sp.pest || sp.tope);
  const explicitPage = sp.page ? Math.max(1, Number(sp.page) || 1) : null;

  let query = supabase
    .from("products")
    .select(RESULT_SELECT, { count: hasMeasurementFilter ? undefined : "exact" })
    .eq("product_stock.branch_id", branchId)
    .order("external_mm", { nullsFirst: false })
    .order("internal_mm", { nullsFirst: false })
    .order("height_mm", { nullsFirst: false })
    .order("flange_mm", { nullsFirst: false })
    .order("stop_mm", { nullsFirst: false })
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

  let rows: ProductResultRow[];
  let page: number;
  let totalPages: number;
  // Productos que se resaltan (color -intenso) tras una búsqueda por medida:
  // TODOS los que comparten exactamente las medidas activas de la coincidencia
  // más cercana, no solo esa fila — el legacy aplica `-intenso` por fila
  // comparando contra $medidas_cercanas, así que dos productos con el mismo
  // MI/ME (p.ej.) quedan ambos resaltados. El auto-scroll apunta a la primera
  // fila resaltada de la página (nro_registro_cercano). Solo se calcula en una
  // búsqueda nueva (sin `?page=` explícito), no al paginar a mano.
  let highlightProductIds: string[] = [];

  if (hasMeasurementFilter) {
    // Con filtro de medida se trae todo el conjunto ya ordenado (acotado a un
    // límite generoso) para poder calcular la página de cercanía exactamente
    // igual que el legacy, y luego se recorta la página a mostrar en JS.
    const { data } = await query.limit(5000);
    const allRows = (data ?? []) as unknown as ProductResultRow[];
    totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));

    if (explicitPage) {
      page = clampPage(explicitPage, totalPages);
    } else {
      const measurementRows: MeasurementRow[] = allRows.map((r) => ({
        internalMm: r.internal_mm,
        externalMm: r.external_mm,
        heightMm: r.height_mm,
        flangeMm: r.flange_mm,
        stopMm: r.stop_mm,
      }));
      const targets = {
        externalMm: sp.me ? Number(sp.me) : undefined,
        internalMm: sp.mi ? Number(sp.mi) : undefined,
        heightMm: sp.alt ? Number(sp.alt) : undefined,
        flangeMm: sp.pest ? Number(sp.pest) : undefined,
        stopMm: sp.tope ? Number(sp.tope) : undefined,
      };
      const match = closestMatch(measurementRows, targets, PAGE_SIZE);
      page = clampPage(match.page, totalPages);
      highlightProductIds = match.matchingIndices
        .map((i) => allRows[i]?.id)
        .filter((id): id is string => Boolean(id));
    }
    rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  } else {
    const { data, count } = await query.range(0, PAGE_SIZE * 200 - 1);
    const allRows = (data ?? []) as unknown as ProductResultRow[];
    totalPages = Math.max(1, Math.ceil((count ?? allRows.length) / PAGE_SIZE));
    page = clampPage(explicitPage ?? 1, totalPages);
    rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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
          highlightProductIds={highlightProductIds}
          exchangeRate={exchangeRate}
          canEditExchangeRate={can(profile.role, "settings:write")}
        />
      )}
    </div>
  );
}
