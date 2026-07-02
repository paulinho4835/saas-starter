import { Users, Wallet, ShoppingCart, Receipt, PackageX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { PeriodSelect, PERIOD_LABEL, type Period } from "./PeriodSelect";
import { PaymentFilter, PAYMENT_FILTER_LABEL, type PaymentFilterValue } from "./PaymentFilter";
import { periodSince } from "@/lib/dashboardPeriod";

type SearchParams = { period?: string; payment?: string };

const LOW_STOCK_THRESHOLD = 5;
const TOP_PRODUCTS_LIMIT = 10;
const LOW_STOCK_LIMIT = 10;
const EFECTIVO_TYPES = ["sin_factura", "con_factura", "mayorista"];
const QR_TYPES = ["sin_factura_qr", "con_factura_qr"];

function isPeriod(value: string | undefined): value is Period {
  return value === "7d" || value === "30d" || value === "month" || value === "all";
}

function isPaymentFilter(value: string | undefined): value is PaymentFilterValue {
  return value === "total" || value === "efectivo" || value === "qr";
}

function formatBs(value: number): string {
  return new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + " Bs";
}

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : "30d";
  const payment: PaymentFilterValue = isPaymentFilter(sp.payment) ? sp.payment : "total";
  const since = periodSince(period);

  const profile = await getProfile();
  const supabase = await createClient();
  const isAdmin = profile?.role === "admin";

  const [{ count: clientes }, { data: topProductsData }, salesResult, capitalResult, lowStockResult] =
    await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.rpc("dashboard_top_products", {
        p_org_id: profile?.orgId ?? "",
        p_since: since ? since.toISOString() : "1970-01-01T00:00:00Z",
        p_limit: TOP_PRODUCTS_LIMIT,
      }),
      (async () => {
        let query = supabase.from("sales").select("total_bs");
        if (since) query = query.gte("created_at", since.toISOString());
        if (payment === "efectivo") query = query.in("sale_type", EFECTIVO_TYPES);
        if (payment === "qr") query = query.in("sale_type", QR_TYPES);
        return query;
      })(),
      isAdmin
        ? supabase.rpc("dashboard_capital_by_branch", { p_org_id: profile?.orgId ?? "" })
        : Promise.resolve({ data: null }),
      supabase
        .from("product_stock")
        .select("quantity, products!inner(code), branches!inner(name, is_warehouse)")
        .eq("branches.is_warehouse", false)
        .lte("quantity", LOW_STOCK_THRESHOLD)
        .order("quantity")
        .limit(LOW_STOCK_LIMIT),
    ]);

  const topProducts = (topProductsData ?? []) as {
    product_id: string;
    code: string;
    brand_name: string | null;
    quantity_sold: number;
    revenue_bs: number;
  }[];
  const sales = salesResult.data ?? [];
  const salesTotal = sales.reduce((sum, s) => sum + Number(s.total_bs), 0);
  const capitalByBranch = (capitalResult.data ?? null) as
    | { branch_id: string; branch_name: string; capital_bs: number }[]
    | null;
  const capitalTotal = capitalByBranch?.reduce((sum, c) => sum + Number(c.capital_bs), 0) ?? 0;
  const lowStock = (lowStockResult.data ?? []) as unknown as {
    quantity: number;
    products: { code: string } | null;
    branches: { name: string; is_warehouse: boolean } | null;
  }[];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hola, ${profile?.fullName ?? ""}`}
        subtitle="Resumen de tu organización"
        action={
          <div className="flex gap-2">
            <PeriodSelect value={period} />
            <PaymentFilter value={payment} period={period} />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clientes" value={clientes ?? 0} icon={<Users className="h-5 w-5" />} />
        <Stat
          label={`Ventas · ${PERIOD_LABEL[period]} · ${PAYMENT_FILTER_LABEL[payment]}`}
          value={formatBs(salesTotal)}
          icon={<Receipt className="h-5 w-5" />}
        />
        <Stat
          label={`Cantidad · ${PERIOD_LABEL[period]} · ${PAYMENT_FILTER_LABEL[payment]}`}
          value={sales.length}
          icon={<ShoppingCart className="h-5 w-5" />}
        />
        {isAdmin && (
          <Stat
            label="Capital invertido"
            value={formatBs(capitalTotal)}
            icon={<Wallet className="h-5 w-5" />}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 font-semibold text-slate-800">
            Top {TOP_PRODUCTS_LIMIT} productos vendidos · {PERIOD_LABEL[period]}
          </h2>
          {topProducts.length === 0 ? (
            <p className="text-sm text-slate-400">Sin ventas en este período.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {topProducts.map((p) => (
                <li key={p.product_id} className="flex items-center justify-between py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{p.code}</p>
                    <p className="text-xs text-slate-400">{p.brand_name ?? "—"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium text-slate-800">{p.quantity_sold} unid.</p>
                    <p className="text-xs text-slate-400">{formatBs(Number(p.revenue_bs))}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
            <PackageX className="h-4 w-4" /> Stock bajo (≤ {LOW_STOCK_THRESHOLD} unid.)
          </h2>
          {lowStock.length === 0 ? (
            <p className="text-sm text-slate-400">Sin alertas de stock bajo.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {lowStock.map((row, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <p className="truncate font-medium text-slate-800">{row.products?.code ?? "—"}</p>
                  <p className="text-xs text-slate-400">
                    {row.branches?.name ?? "—"} · {row.quantity} unid.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isAdmin && capitalByBranch && (
        <Card className="p-4">
          <h2 className="mb-3 font-semibold text-slate-800">Capital por sucursal</h2>
          <ul className="divide-y divide-slate-200">
            {capitalByBranch.map((c) => (
              <li key={c.branch_id} className="flex items-center justify-between py-2 text-sm">
                <p className="text-slate-800">{c.branch_name}</p>
                <p className="font-medium text-slate-800">{formatBs(Number(c.capital_bs))}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
