import Link from "next/link";
import { Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { SimpleCatalogManager } from "@/components/ui/SimpleCatalogManager";
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
  brand_id: string;
  family_id: string;
  origin_id: string | null;
  supplier_id: string | null;
  internal_mm: number | null;
  external_mm: number | null;
  height_mm: number | null;
  flange_mm: number | null;
  stop_mm: number | null;
  application: string | null;
  cost_usd: number | null;
  margin_sf_pct: number | null;
  margin_cf_pct: number | null;
  margin_may_pct: number | null;
  price_sf_bs: number;
  price_cf_bs: number;
  price_may_bs: number;
  product_brands: { name: string } | null;
  product_families: { name: string } | null;
  product_origins: { name: string } | null;
};

const PRODUCT_SELECT =
  "id, code, brand_id, family_id, origin_id, supplier_id, internal_mm, external_mm, height_mm, flange_mm, stop_mm, application, cost_usd, margin_sf_pct, margin_cf_pct, margin_may_pct, price_sf_bs, price_cf_bs, price_may_bs, product_brands(name), product_families(name), product_origins(name)";

function fmt(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

// Las columnas CF/SF/MAY muestran siempre el precio de venta final en Bs
// (price_*_bs) — el mismo que usa Ventas — sin importar si el producto tiene
// margen % configurado (alta manual) o vino de una carga por Excel.
function fmtPrice(priceBs: number): string {
  return priceBs > 0 ? `${fmt(priceBs)} Bs` : "—";
}

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    tab?: string;
    page?: string;
    brandId?: string;
    familyId?: string;
    originId?: string;
    supplierId?: string;
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
    const q = (sp.q ?? "").trim();

    let query = supabase
      .from("products")
      .select(PRODUCT_SELECT, { count: "exact" })
      .order("code")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (q) {
      const safeQ = escapePostgrestFilterValue(q);
      query = query.or(`code.ilike.%${safeQ}%,application.ilike.%${safeQ}%`);
    }
    if (sp.brandId) query = query.eq("brand_id", sp.brandId);
    if (sp.familyId) query = query.eq("family_id", sp.familyId);
    if (sp.originId) query = query.eq("origin_id", sp.originId);
    if (sp.supplierId) query = query.eq("supplier_id", sp.supplierId);

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
        const existing = (stockData ?? []).find(
          (s) => s.product_id === p.id && s.branch_id === b.id,
        );
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
    if (sp.q) params.set("q", sp.q);
    if (sp.brandId) params.set("brandId", sp.brandId);
    if (sp.familyId) params.set("familyId", sp.familyId);
    if (sp.originId) params.set("originId", sp.originId);
    if (sp.supplierId) params.set("supplierId", sp.supplierId);
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
              {canWriteProductos && (
                <ProductFormModal
                  mode="create"
                  brands={brands}
                  families={families}
                  origins={origins}
                  suppliers={suppliers}
                  branches={branches}
                  exchangeRate={exchangeRate}
                />
              )}
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
              tab === t.key
                ? "border-b-2 border-brand text-brand-fg"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "productos" && (
        <>
          <Card className="p-4">
            <form className="flex flex-wrap items-end gap-3" method="get">
              <input type="hidden" name="tab" value="productos" />
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Buscar</span>
                <input
                  type="text"
                  name="q"
                  defaultValue={sp.q ?? ""}
                  placeholder="Código o aplicación"
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
                <span className="mb-1 block text-slate-600">Familia</span>
                <select name="familyId" defaultValue={sp.familyId ?? ""} className={fieldInputClass}>
                  <option value="">Todas</option>
                  {families.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Procedencia</span>
                <select name="originId" defaultValue={sp.originId ?? ""} className={fieldInputClass}>
                  <option value="">Todas</option>
                  {origins.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Proveedor</span>
                <select name="supplierId" defaultValue={sp.supplierId ?? ""} className={fieldInputClass}>
                  <option value="">Todos</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit">Buscar</Button>
            </form>
          </Card>

          <Card className="overflow-auto">
            {products.length === 0 ? (
              <EmptyState
                icon={<Wrench className="h-6 w-6" />}
                title="Sin productos"
                description="Crea el primer producto o importa un Excel."
              />
            ) : (
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
                      <tr key={p.id}>
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
                          <div className="flex items-center gap-1">
                            {canWriteProductos && (
                              <ProductFormModal
                                mode="edit"
                                product={p}
                                stock={stockByProduct.get(p.id)}
                                brands={brands}
                                families={families}
                                origins={origins}
                                suppliers={suppliers}
                                branches={branches}
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
