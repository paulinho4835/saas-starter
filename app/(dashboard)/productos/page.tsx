import Link from "next/link";
import { Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { toleranceRange } from "@/lib/measurementSearch";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SimpleCatalogManager } from "@/components/ui/SimpleCatalogManager";
import { ScrollHint } from "@/components/ui/ScrollHint";
import { ProductRegistrationForm } from "@/components/productos/ProductRegistrationForm";
import { ProductFormModal } from "@/components/productos/ProductFormModal";
import { DeleteProductButton } from "@/components/productos/DeleteProductButton";
import { ImportProductsDialog } from "@/components/productos/ImportProductsDialog";
import {
  createBrand,
  deleteBrand,
  createFamily,
  deleteFamily,
  createOrigin,
  deleteOrigin,
} from "@/app/(dashboard)/productos/actions";

const PAGE_SIZE = 25;
const TABS = [
  { key: "productos", label: "Productos" },
  { key: "marcas", label: "Marcas" },
  { key: "familias", label: "Familias" },
  { key: "procedencias", label: "Procedencias" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type ProductRow = {
  id: string;
  code: string;
  supplier_id: string | null;
  internal_mm: number | null;
  external_mm: number | null;
  height_mm: number | null;
  flange_mm: number | null;
  stop_mm: number | null;
  application: string | null;
  notes: string | null;
  cost_usd: number | null;
  margin_sf_pct: number | null;
  margin_may_pct: number | null;
  price_sf_bs: number;
  price_cf_bs: number;
  price_may_bs: number;
  product_brands: { name: string } | null;
  product_families: { name: string } | null;
  product_origins: { name: string } | null;
};

const PRODUCT_SELECT_BASE =
  "id, code, supplier_id, internal_mm, external_mm, height_mm, flange_mm, stop_mm, application, notes, cost_usd, margin_sf_pct, margin_may_pct, price_sf_bs, price_cf_bs, price_may_bs";

// PostgREST/supabase-js NO restringe las filas del recurso "padre" cuando se
// filtra sobre una columna de un recurso embebido sin `!inner` (ej.
// `product_families(name)` + `.ilike("product_families.name", ...)`): el
// filtro solo afecta qué fila del embed se devuelve, no cuáles productos
// vuelven. Verificado manualmente contra datos reales — ver task-6-report.md.
// `product_families`/`product_brands` son FK NOT NULL en `products`, así que
// `!inner` ahí es siempre seguro (todo producto tiene marca y familia).
// `product_origins`/`suppliers` son FK nullable (`origin_id`/`supplier_id`
// pueden ser null) — aplicar `!inner` sin condición ocultaría de TODAS las
// búsquedas los productos sin procedencia/proveedor asignado, aunque el
// usuario no esté filtrando por esas columnas. Por eso solo se vuelven
// `!inner` cuando el usuario realmente está filtrando por esa columna.
function buildProductSelect(sp: { origin?: string; supplier?: string }): string {
  const originJoin = sp.origin ? "product_origins!inner(name)" : "product_origins(name)";
  const supplierJoin = sp.supplier ? "suppliers!inner(name)" : "suppliers(name)";
  return `${PRODUCT_SELECT_BASE}, product_brands!inner(name), product_families!inner(name), ${originJoin}, ${supplierJoin}`;
}

function fmt(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

function fmtPrice(priceBs: number): string {
  return priceBs > 0 ? `${fmt(priceBs)} Bs` : "—";
}

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    page?: string;
    code?: string;
    family?: string;
    brand?: string;
    origin?: string;
    supplier?: string;
    mi?: string;
    me?: string;
    alt?: string;
    pest?: string;
    tope?: string;
    application?: string;
  }>;
}) {
  await requireNavAccess("productos");
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "productos";

  const profile = await getProfile();
  const supabase = await createClient();

  const [
    { data: brandsData },
    { data: familiesData },
    { data: originsData },
    { data: branchesData },
    { data: suppliersData },
    { data: orgData },
  ] = await Promise.all([
    supabase.from("product_brands").select("id, name").order("name"),
    supabase.from("product_families").select("id, name").order("name"),
    supabase.from("product_origins").select("id, name").order("name"),
    supabase.from("branches").select("id, name").eq("is_warehouse", false).order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("organizations").select("exchange_rate").eq("id", profile?.orgId ?? "").single(),
  ]);
  const brands = brandsData ?? [];
  const families = familiesData ?? [];
  const origins = originsData ?? [];
  const branches = branchesData ?? [];
  const suppliers = suppliersData ?? [];
  const exchangeRate = orgData?.exchange_rate ?? 0;

  const canWriteProductos = can(profile?.role, "productos:write");
  const canDeleteProductos = can(profile?.role, "productos:delete");
  const canImport = can(profile?.role, "productos:import");
  const canWriteCatalogos = can(profile?.role, "catalogos:write");

  let products: ProductRow[] = [];
  let totalCount = 0;
  let page = 1;
  let stockByProduct = new Map<string, { branch_id: string; branch_name: string; quantity: number }[]>();

  if (tab === "productos") {
    page = Math.max(1, Number(sp.page) || 1);

    let query = supabase
      .from("products")
      .select(buildProductSelect(sp), { count: "exact" })
      .eq("active", true)
      .order("code")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (sp.code) query = query.ilike("code", `%${escapePostgrestFilterValue(sp.code)}%`);
    if (sp.family) query = query.ilike("product_families.name", `%${escapePostgrestFilterValue(sp.family)}%`);
    if (sp.brand) query = query.ilike("product_brands.name", `%${escapePostgrestFilterValue(sp.brand)}%`);
    if (sp.origin) query = query.ilike("product_origins.name", `%${escapePostgrestFilterValue(sp.origin)}%`);
    if (sp.supplier) query = query.ilike("suppliers.name", `%${escapePostgrestFilterValue(sp.supplier)}%`);
    if (sp.application)
      query = query.ilike("application", `%${escapePostgrestFilterValue(sp.application)}%`);
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

    const { data, count } = await query;
    products = (data ?? []) as unknown as ProductRow[];
    totalCount = count ?? 0;

    const productIds = products.map((p) => p.id);
    const { data: stockData } =
      productIds.length > 0
        ? await supabase
            .from("product_stock")
            .select("product_id, branch_id, quantity")
            .in("product_id", productIds)
        : { data: [] as { product_id: string; branch_id: string; quantity: number }[] };

    for (const p of products) {
      const rows = branches.map((b) => {
        const existing = (stockData ?? []).find((s) => s.product_id === p.id && s.branch_id === b.id);
        return { branch_id: b.id, branch_name: b.name, quantity: existing?.quantity ?? 0 };
      });
      stockByProduct.set(p.id, rows);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function buildHref(targetPage: number) {
    const params = new URLSearchParams();
    params.set("tab", "productos");
    params.set("page", String(targetPage));
    if (sp.code) params.set("code", sp.code);
    if (sp.family) params.set("family", sp.family);
    if (sp.brand) params.set("brand", sp.brand);
    if (sp.origin) params.set("origin", sp.origin);
    if (sp.supplier) params.set("supplier", sp.supplier);
    if (sp.mi) params.set("mi", sp.mi);
    if (sp.me) params.set("me", sp.me);
    if (sp.alt) params.set("alt", sp.alt);
    if (sp.pest) params.set("pest", sp.pest);
    if (sp.tope) params.set("tope", sp.tope);
    if (sp.application) params.set("application", sp.application);
    return `/productos?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos"
        subtitle={tab === "productos" ? `${totalCount} registrados` : undefined}
        action={
          tab === "productos" ? (
            <div className="flex gap-2">
              {canImport && <ImportProductsDialog branches={branches} />}
              <ButtonLink href="/productos/exportar" variant="secondary">
                Exportar Excel
              </ButtonLink>
            </div>
          ) : null
        }
      />

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/productos?tab=${t.key}`}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.key ? "border-b-2 border-brand text-brand-fg" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "productos" && (
        <>
          {canWriteProductos && (
            <ProductRegistrationForm
              brands={brands}
              families={families}
              origins={origins}
              suppliers={suppliers}
              branches={branches}
              exchangeRate={exchangeRate}
            />
          )}

          <Card className="overflow-auto">
            <form method="get" className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
              <input type="hidden" name="tab" value="productos" />
              <Field label="Código" name="code" defaultValue={sp.code ?? ""} className="w-28" />
              <Field label="Familia" name="family" defaultValue={sp.family ?? ""} className="w-28" />
              <Field label="MI" name="mi" type="number" step="0.01" defaultValue={sp.mi ?? ""} className="w-20" />
              <Field label="ME" name="me" type="number" step="0.01" defaultValue={sp.me ?? ""} className="w-20" />
              <Field
                label="Altura"
                name="alt"
                type="number"
                step="0.01"
                defaultValue={sp.alt ?? ""}
                className="w-20"
              />
              <Field
                label="Pestaña"
                name="pest"
                type="number"
                step="0.01"
                defaultValue={sp.pest ?? ""}
                className="w-20"
              />
              <Field
                label="Tope"
                name="tope"
                type="number"
                step="0.01"
                defaultValue={sp.tope ?? ""}
                className="w-20"
              />
              <Field
                label="Aplicación"
                name="application"
                defaultValue={sp.application ?? ""}
                className="w-40"
              />
              <Field label="Marca" name="brand" defaultValue={sp.brand ?? ""} className="w-28" />
              <Field label="Procedencia" name="origin" defaultValue={sp.origin ?? ""} className="w-28" />
              <Field label="Proveedor" name="supplier" defaultValue={sp.supplier ?? ""} className="w-28" />
              <Button type="submit">Buscar</Button>
              <ButtonLink variant="secondary" href="/productos?tab=productos">
                Limpiar
              </ButtonLink>
            </form>

            {products.length === 0 ? (
              <EmptyState
                icon={<Wrench className="h-6 w-6" />}
                title="Sin productos"
                description="Crea el primer producto o importa un Excel."
              />
            ) : (
              <>
                <ScrollHint />
                <table className="w-full min-w-[1200px] text-sm">
                  <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Familia</th>
                      <th className="px-3 py-2">Código producto</th>
                      <th className="px-3 py-2">Marca</th>
                      <th className="px-3 py-2">Stock</th>
                      <th className="px-3 py-2">Costo $</th>
                      <th className="bg-emerald-100 px-3 py-2 text-center text-emerald-800">CF Bs</th>
                      <th className="bg-amber-100 px-3 py-2 text-center text-amber-800">SF Bs</th>
                      <th className="bg-rose-100 px-3 py-2 text-center text-rose-800">MAY Bs</th>
                      <th className="px-3 py-2">MI</th>
                      <th className="px-3 py-2">ME</th>
                      <th className="px-3 py-2">ALT</th>
                      <th className="px-3 py-2">PEST</th>
                      <th className="px-3 py-2">TOPE</th>
                      <th className="px-3 py-2">Aplicación</th>
                      <th className="px-3 py-2">Procedencia</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {products.map((p) => {
                      const totalStock = (stockByProduct.get(p.id) ?? []).reduce(
                        (sum, s) => sum + s.quantity,
                        0,
                      );
                      return (
                        <tr key={p.id} className="group">
                          <td className="px-3 py-2 text-slate-500">{p.product_families?.name ?? "—"}</td>
                          <td className="px-3 py-2 font-medium text-slate-800">{p.code}</td>
                          <td className="px-3 py-2 text-slate-500">{p.product_brands?.name ?? "—"}</td>
                          <td className="px-3 py-2 font-semibold text-red-600">{totalStock}</td>
                          <td className="px-3 py-2 text-slate-500">{fmt(p.cost_usd)}</td>
                          <td className="bg-emerald-50 px-3 py-2 text-center text-emerald-900">
                            {fmtPrice(p.price_cf_bs)}
                          </td>
                          <td className="bg-amber-50 px-3 py-2 text-center text-amber-900">
                            {fmtPrice(p.price_sf_bs)}
                          </td>
                          <td className="bg-rose-50 px-3 py-2 text-center text-rose-900">
                            {fmtPrice(p.price_may_bs)}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{fmt(p.internal_mm)}</td>
                          <td className="px-3 py-2 text-slate-500">{fmt(p.external_mm)}</td>
                          <td className="px-3 py-2 text-slate-500">{fmt(p.height_mm)}</td>
                          <td className="px-3 py-2 text-slate-500">{fmt(p.flange_mm)}</td>
                          <td className="px-3 py-2 text-slate-500">{fmt(p.stop_mm)}</td>
                          <td className="max-w-[200px] truncate px-3 py-2 text-slate-500">
                            {p.application || "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{p.product_origins?.name ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              {canWriteProductos && (
                                <ProductFormModal
                                  product={{
                                    id: p.id,
                                    code: p.code,
                                    brandName: p.product_brands?.name ?? "",
                                    familyName: p.product_families?.name ?? "",
                                    originName: p.product_origins?.name ?? null,
                                    supplier_id: p.supplier_id,
                                    internal_mm: p.internal_mm,
                                    external_mm: p.external_mm,
                                    height_mm: p.height_mm,
                                    flange_mm: p.flange_mm,
                                    stop_mm: p.stop_mm,
                                    application: p.application,
                                    notes: p.notes,
                                    cost_usd: p.cost_usd,
                                    margin_sf_pct: p.margin_sf_pct,
                                    margin_may_pct: p.margin_may_pct,
                                  }}
                                  stock={stockByProduct.get(p.id) ?? []}
                                  brands={brands}
                                  families={families}
                                  origins={origins}
                                  suppliers={suppliers}
                                  exchangeRate={exchangeRate}
                                />
                              )}
                              {canDeleteProductos && <DeleteProductButton id={p.id} code={p.code} />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
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
        </>
      )}

      {tab === "marcas" && (
        <SimpleCatalogManager
          itemLabel="marca"
          emptyLabel="Aún no hay marcas"
          items={brands}
          canWrite={canWriteCatalogos}
          onCreate={createBrand}
          onDelete={deleteBrand}
        />
      )}
      {tab === "familias" && (
        <SimpleCatalogManager
          itemLabel="familia"
          emptyLabel="Aún no hay familias"
          items={families}
          canWrite={canWriteCatalogos}
          onCreate={createFamily}
          onDelete={deleteFamily}
        />
      )}
      {tab === "procedencias" && (
        <SimpleCatalogManager
          itemLabel="procedencia"
          emptyLabel="Aún no hay procedencias"
          items={origins}
          canWrite={canWriteCatalogos}
          onCreate={createOrigin}
          onDelete={deleteOrigin}
        />
      )}
    </div>
  );
}
