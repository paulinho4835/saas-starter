# Dashboard — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el dashboard placeholder (`Clientes`/`Items` genéricos) por un panel real: capital invertido al costo (solo admin, con desglose por sucursal), ventas del período con selector (7d/30d/mes/todo), top 10 productos vendidos, y alerta de stock bajo.

**Architecture:** Dos funciones SQL nuevas (`security invoker`, `stable`) para las agregaciones que cruzan tablas (`dashboard_capital_by_branch`, `dashboard_top_products`) — mismo patrón que `transfer_stock` de Almacén. El resto (ventas del período, stock bajo) se resuelve con queries planas + agregación en JS, igual que el resto del código. Página server component con un selector de período client component chico (sin debounce, es un `<select>`).

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (Postgres + RLS + funciones SQL), Tailwind, Vitest.

## Global Constraints

- Ver spec completo: `docs/superpowers/specs/2026-07-02-dashboard-design.md`.
- Español neutro en toda la UI (sin voseo).
- **Capital solo visible para `profile.role === "admin"`** — chequeo inline en la página, no un permiso nuevo en `lib/rbac.ts` (no es una acción de escritura, es visibilidad condicional de una sección, igual que ya hace `AjusteInventarioPage` con `canAdjust`).
- El dashboard sigue siendo `core` (sin feature flag, visible para todos los roles que ya ven `/dashboard` hoy) — no se toca `lib/features.ts` ni `lib/rbac.ts`.
- Las funciones SQL son **`security invoker`**, no `definer`: respetan RLS igual que el resto del código.
- La alerta de "stock bajo" excluye la sucursal `is_warehouse = true` (el almacén tiene volumen mayor por diseño).
- Fuera de alcance: gráficos, comparación contra período anterior, export, dashboard personalizable. Ver spec.

---

### Task 1: Migración — funciones `dashboard_capital_by_branch` y `dashboard_top_products`

**Files:**
- Create: `supabase/migrations/0007_dashboard.sql`

**Interfaces:**
- Produces: `dashboard_capital_by_branch(p_org_id uuid) returns table(branch_id uuid, branch_name text, capital_bs numeric)`, `dashboard_top_products(p_org_id uuid, p_since timestamptz, p_limit integer) returns table(product_id uuid, code text, brand_name text, quantity_sold bigint, revenue_bs numeric)`.
- Consumido por: Task 3 (`page.tsx`).

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- Dashboard: agregaciones que cruzan tablas (capital al costo, top productos).
-- Ver docs/superpowers/specs/2026-07-02-dashboard-design.md
-- ============================================================================

create or replace function dashboard_capital_by_branch(p_org_id uuid)
returns table (branch_id uuid, branch_name text, capital_bs numeric)
language sql
security invoker
stable
as $$
  select
    b.id,
    b.name,
    coalesce(sum(ps.quantity * p.cost_usd * p.exchange_rate), 0)::numeric
  from branches b
  left join product_stock ps on ps.branch_id = b.id
  left join products p on p.id = ps.product_id
  where b.org_id = p_org_id
  group by b.id, b.name
  order by b.name;
$$;

grant execute on function dashboard_capital_by_branch(uuid) to authenticated, service_role;

create or replace function dashboard_top_products(p_org_id uuid, p_since timestamptz, p_limit integer)
returns table (
  product_id     uuid,
  code           text,
  brand_name     text,
  quantity_sold  bigint,
  revenue_bs     numeric
)
language sql
security invoker
stable
as $$
  select
    p.id,
    p.code,
    pb.name,
    sum(si.quantity)::bigint,
    sum(si.subtotal_bs)::numeric
  from sale_items si
  join sales s on s.id = si.sale_id
  join products p on p.id = si.product_id
  left join product_brands pb on pb.id = p.brand_id
  where s.org_id = p_org_id and s.created_at >= p_since
  group by p.id, p.code, pb.name
  order by sum(si.quantity) desc
  limit p_limit;
$$;

grant execute on function dashboard_top_products(uuid, timestamptz, integer) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar y verificar**

Run (contra el contenedor local compartido, `supabase db reset` no está
linkeado en este repo — ver nota en `project_productos-sucursales-stock-status`
memory):

```bash
docker exec -i supabase_db_productos-sucursales-stock psql -U postgres -d postgres < supabase/migrations/0007_dashboard.sql
```

Expected: `CREATE FUNCTION` x2, `GRANT` x2, sin errores. Verificar a mano:

```sql
select * from dashboard_capital_by_branch('00000000-0000-0000-0000-000000000001');
select * from dashboard_top_products('00000000-0000-0000-0000-000000000001', now() - interval '30 days', 10);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_dashboard.sql
git commit -m "feat(db): add dashboard aggregation functions"
```

---

### Task 2: `app/(dashboard)/dashboard/PeriodSelect.tsx` — selector de período

**Files:**
- Create: `app/(dashboard)/dashboard/PeriodSelect.tsx`

**Interfaces:**
- Produces: `export type Period = "7d" | "30d" | "month" | "all"`, `export const PERIOD_LABEL: Record<Period, string>`, `export function PeriodSelect({ value }: { value: Period })`.
- Consumido por: Task 3 (`page.tsx`).

- [ ] **Step 1: Escribir el componente**

```typescript
"use client";

import { useRouter } from "next/navigation";
import { fieldInputClass } from "@/components/ui/Field";

export type Period = "7d" | "30d" | "month" | "all";

export const PERIOD_LABEL: Record<Period, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  month: "Este mes",
  all: "Todo el tiempo",
};

export function PeriodSelect({ value }: { value: Period }) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) => router.replace(`/dashboard?period=${e.target.value}`, { scroll: false })}
      className={`${fieldInputClass} w-auto`}
    >
      {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
        <option key={p} value={p}>
          {PERIOD_LABEL[p]}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/dashboard/PeriodSelect.tsx"
git commit -m "feat: add dashboard period selector"
```

---

### Task 3: `lib/dashboardPeriod.ts` — resolución de período a fecha

**Files:**
- Create: `lib/dashboardPeriod.ts`
- Test: `lib/dashboardPeriod.test.ts`

**Interfaces:**
- Consumes: `Period` (Task 2).
- Produces: `export function periodSince(period: Period, now?: Date): Date | null` (`null` para `"all"` — sin filtro de fecha).
- Consumido por: Task 4 (`page.tsx`).

- [ ] **Step 1: Escribir el test que falla primero**

```typescript
// lib/dashboardPeriod.test.ts
import { describe, expect, it } from "vitest";
import { periodSince } from "./dashboardPeriod";

describe("periodSince", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("returns 7 days back for '7d'", () => {
    expect(periodSince("7d", now)?.toISOString()).toBe("2026-07-08T12:00:00.000Z");
  });

  it("returns 30 days back for '30d'", () => {
    expect(periodSince("30d", now)?.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("returns the first day of the current month for 'month'", () => {
    expect(periodSince("month", now)?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("returns null for 'all' (no date filter)", () => {
    expect(periodSince("all", now)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/dashboardPeriod.test.ts`
Expected: FAIL — el módulo `./dashboardPeriod` no existe.

- [ ] **Step 3: Implementar**

```typescript
// lib/dashboardPeriod.ts
import type { Period } from "@/app/(dashboard)/dashboard/PeriodSelect";

// Resuelve un período del dashboard a la fecha desde la que filtrar
// `sales.created_at` / `sale_items` (vía `sales.created_at`). `null` para
// "all" significa "sin filtro de fecha".
export function periodSince(period: Period, now: Date = new Date()): Date | null {
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    case "all":
      return null;
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/dashboardPeriod.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboardPeriod.ts lib/dashboardPeriod.test.ts
git commit -m "feat: add dashboard period resolution helper"
```

---

### Task 4: `app/(dashboard)/dashboard/page.tsx` — reescribir la página

**Files:**
- Modify: `app/(dashboard)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getProfile()`, `PeriodSelect`/`Period`/`PERIOD_LABEL` (Task 2), `periodSince()` (Task 3), RPC `dashboard_capital_by_branch`/`dashboard_top_products` (Task 1), `Stat`/`Card`/`PageHeader` (`components/ui/`).
- Produces: página `/dashboard` reescrita.

- [ ] **Step 1: Escribir la página**

```typescript
import { Users, Wallet, ShoppingCart, Receipt, PackageX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { PeriodSelect, PERIOD_LABEL, type Period } from "./PeriodSelect";
import { periodSince } from "@/lib/dashboardPeriod";

type SearchParams = { period?: string };

const LOW_STOCK_THRESHOLD = 5;
const TOP_PRODUCTS_LIMIT = 10;
const LOW_STOCK_LIMIT = 10;

function isPeriod(value: string | undefined): value is Period {
  return value === "7d" || value === "30d" || value === "month" || value === "all";
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

  const topProducts = topProductsData ?? [];
  const sales = salesResult.data ?? [];
  const salesTotal = sales.reduce((sum, s) => sum + Number(s.total_bs), 0);
  const capitalByBranch = (capitalResult.data ?? []) as
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
        action={<PeriodSelect value={period} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clientes" value={clientes ?? 0} icon={<Users className="h-5 w-5" />} />
        <Stat
          label={`Ventas · ${PERIOD_LABEL[period]}`}
          value={formatBs(salesTotal)}
          icon={<Receipt className="h-5 w-5" />}
        />
        <Stat
          label={`Cantidad de ventas · ${PERIOD_LABEL[period]}`}
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
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/dashboard/page.tsx"
git commit -m "feat: rebuild dashboard with capital, sales, top products, low stock"
```

---

### Task 5: Verificación manual end-to-end

**Files:** ninguno (solo verificación interactiva, no se escribe código).

- [ ] **Step 1: Cargar datos de prueba si hace falta**

Si la organización demo no tiene ventas registradas, hacer 1-2 ventas desde
`/ventas` para que "Top productos" y "Ventas del período" no queden vacíos.

- [ ] **Step 2: Probar como admin**

Ir a `/dashboard` logueado como admin. Verificar: aparecen las 4 tarjetas
(Clientes, Ventas, Cantidad de ventas, Capital invertido), la tabla de Top
productos, la lista de Stock bajo, y la tabla de Capital por sucursal.
Cambiar el selector de período y confirmar que "Ventas"/"Top productos" se
actualizan (el resto no depende del período).

- [ ] **Step 3: Probar como manager/member**

Loguear con un rol no-admin. Verificar que la tarjeta "Capital invertido" y
la tabla "Capital por sucursal" **no aparecen**, pero sí el resto.

- [ ] **Step 4: Probar el caso sin ventas**

Con `period=7d` si no hay ventas recientes, verificar que "Top productos"
muestra "Sin ventas en este período" en vez de romperse o quedar vacío sin
explicación.
