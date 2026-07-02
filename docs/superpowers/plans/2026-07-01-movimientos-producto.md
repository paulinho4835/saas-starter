# Movimientos de Producto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraer la sección "Historial de movimientos" que hoy vive dentro
de `/ajuste-inventario` a su propia página `/movimientos-producto`, con su
propia entrada en el menú lateral, dejando Ajuste de Inventario solo para
aumentar/reducir stock.

**Architecture:** Movimiento de código de lectura, sin cambios de esquema.
Se crea una página nueva que reutiliza el mismo query sobre `stock_movements`
que hoy arma `ajuste-inventario/page.tsx`, se elimina ese bloque del archivo
original, y se registra la página nueva como feature flag + entrada de menú
con el mismo control de acceso (`requireNavAccess`) que ya usa Ajuste de
Inventario.

**Tech Stack:** Next.js 15 App Router (Server Component), TypeScript,
Tailwind, Supabase (solo lectura en este cambio).

## Global Constraints

- Español neutro en toda la UI (sin voseo).
- No se modifica el esquema de base de datos, RLS, ni ningún `actions.ts`.
- Sin botón "Exportar Excel" — confirmado fuera de alcance por el usuario.
- Sin columnas separadas por tipo de movimiento (Compra CF/SF/MAY,
  Devolución, Ajuste) — se mantiene una sola columna "Tipo" con
  `movementTypeLabel`, igual que hoy.
- `movimientos_producto` es visible solo para `admin` y `manager` en
  `NAV_WHITELIST` (mismo público que `ajuste_inventario` hoy), sin permiso
  nuevo en `Permission`/`MATRIX` — el único guard es `requireNavAccess`.
- Sin tests automatizados nuevos — este módulo no tiene suite para páginas
  que dependen de Supabase (mismo patrón que el resto de Ajuste de
  Inventario y Ventas). La verificación es manual + `npm run typecheck`.

---

### Task 1: Nueva página `/movimientos-producto`

**Files:**
- Create: `app/(dashboard)/movimientos-producto/page.tsx`

**Interfaces:**
- Consumes: `requireNavAccess` (`@/lib/guard`, firma
  `(key: FeatureKey) => Promise<void>`, hace `redirect` si no corresponde);
  `getProfile` (`@/lib/auth`); `createClient` (`@/lib/supabase/server`);
  `escapePostgrestFilterValue` (`@/lib/postgrest`); `movementTypeLabel`,
  `MOVEMENT_TYPES`, `type MovementType` (`@/lib/stockMovements`);
  `PageHeader` (`@/components/ui/PageHeader`); `Card`
  (`@/components/ui/Card`); `EmptyState` (`@/components/ui/EmptyState`);
  `Button`, `ButtonLink` (`@/components/ui/Button`); `fieldInputClass`
  (`@/components/ui/Field`). Todos estos ya existen sin cambios de firma.
  El `FeatureKey` `"movimientos_producto"` lo agrega la Task 3 — este
  archivo lo usa como string literal, TypeScript solo lo aceptará como
  válido una vez aplicada esa task (por eso el orden de commits no bloquea
  la compilación final, pero si se compila esta task sola antes de la
  Task 3, `npm run typecheck` marcará error en esta línea — es esperado,
  ver Step 3).
- Produces: página en la ruta `/movimientos-producto`. No expone nada que
  otras tasks consuman.

- [ ] **Step 1: Crear el archivo con el contenido completo**

Crea `app/(dashboard)/movimientos-producto/page.tsx` con exactamente este
contenido (es el bloque "Historial de movimientos" de
`ajuste-inventario/page.tsx` movido a su propia página, con los nombres de
searchParams simplificados al no compartir página con el bloque
"Productos"):

```tsx
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { movementTypeLabel, MOVEMENT_TYPES, type MovementType } from "@/lib/stockMovements";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";

const PAGE_SIZE = 25;

type SearchParams = {
  code?: string;
  branchId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: string;
};

type MovementRow = {
  id: string;
  movement_type: MovementType;
  quantity_delta: number;
  resulting_quantity: number;
  reason: string | null;
  sale_id: string | null;
  created_at: string;
  products: { code: string } | null;
  branches: { name: string } | null;
  profiles: { full_name: string } | null;
};

const MOVEMENT_SELECT =
  "id, movement_type, quantity_delta, resulting_quantity, reason, sale_id, created_at, products!inner(code), branches!inner(name), profiles(full_name)";

export default async function MovimientosProductoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("movimientos_producto");
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: branchesData } = await supabase.from("branches").select("id, name").order("name");
  const branches = branchesData ?? [];

  const page = Math.max(1, Number(sp.page) || 1);
  let movementsQuery = supabase
    .from("stock_movements")
    .select(MOVEMENT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.code)
    movementsQuery = movementsQuery.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.branchId) movementsQuery = movementsQuery.eq("branch_id", sp.branchId);
  if (sp.type) movementsQuery = movementsQuery.eq("movement_type", sp.type);
  if (sp.from) movementsQuery = movementsQuery.gte("created_at", sp.from);
  if (sp.to) movementsQuery = movementsQuery.lte("created_at", `${sp.to}T23:59:59`);
  const { data: movementsData, count: movementsCount } = await movementsQuery;
  const movementRows = (movementsData ?? []) as unknown as MovementRow[];
  const totalMovements = movementsCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalMovements / PAGE_SIZE));

  function buildHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.code) params.set("code", sp.code);
    if (sp.branchId) params.set("branchId", sp.branchId);
    if (sp.type) params.set("type", sp.type);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    params.set("page", String(targetPage));
    return `/movimientos-producto?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Movimientos de Producto" subtitle={`${totalMovements} registrado(s)`} />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Código</span>
            <input type="text" name="code" defaultValue={sp.code ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Sucursal</span>
            <select name="branchId" defaultValue={sp.branchId ?? ""} className={fieldInputClass}>
              <option value="">Todas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Tipo</span>
            <select name="type" defaultValue={sp.type ?? ""} className={fieldInputClass}>
              <option value="">Todos</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {movementTypeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Desde</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Hasta</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} className={fieldInputClass} />
          </label>
          <Button type="submit">Buscar</Button>
        </form>
      </Card>

      <Card>
        {movementRows.length === 0 ? (
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Sin movimientos"
            description="Ajusta los filtros de búsqueda."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {movementRows.map((m) => (
              <li key={m.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {m.products?.code ?? "—"}{" "}
                    <span className="font-normal text-slate-400">· {m.branches?.name ?? "—"}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(m.created_at).toLocaleString("es-BO", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {movementTypeLabel(m.movement_type)} · {m.quantity_delta > 0 ? "+" : ""}
                  {m.quantity_delta} · Stock resultante: {m.resulting_quantity} ·{" "}
                  {m.profiles?.full_name ?? "Sistema"}
                  {m.reason ? ` · ${m.reason}` : ""}
                  {m.sale_id ? ` · Venta ${m.sale_id.slice(0, 8)}` : ""}
                </p>
              </li>
            ))}
          </ul>
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
    </div>
  );
}
```

- [ ] **Step 2: Aplicar Task 3 antes de verificar (dependencia de tipos)**

Este archivo usa el literal `"movimientos_producto"` como `FeatureKey`, que
Task 3 agrega a `lib/features.ts`. Aplica Task 3 (Step 1) antes de correr
`npm run typecheck` en este archivo, o el error de tipo esperado en este
paso será por esa causa — no es un bug de este archivo.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck`
Expected: 0 errores (asumiendo Task 3 ya aplicada).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/movimientos-producto/page.tsx"
git commit -m "feat: add Movimientos de Producto page"
```

---

### Task 2: Quitar el historial de `ajuste-inventario/page.tsx`

**Files:**
- Modify: `app/(dashboard)/ajuste-inventario/page.tsx`

**Interfaces:**
- Consumes: nada nuevo — este task solo elimina código.
- Produces: `ajuste-inventario/page.tsx` queda con un único responsabilidad
  (ajustar stock), sin sección de historial.

- [ ] **Step 1: Reemplazar el archivo completo**

El archivo actual (271 líneas) mezcla dos bloques: "Productos" (ajustar
stock) e "Historial de movimientos" (que se mudó a Task 1). Reemplaza todo
el contenido de `app/(dashboard)/ajuste-inventario/page.tsx` por:

```tsx
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { AdjustStockButton } from "@/components/ajuste-inventario/AdjustStockButton";

type SearchParams = {
  code?: string;
  branchId?: string;
};

type StockRow = {
  id: string;
  product_id: string;
  branch_id: string;
  quantity: number;
  products: { code: string } | null;
  branches: { name: string } | null;
};

const STOCK_SELECT =
  "id, product_id, branch_id, quantity, products!inner(code), branches!inner(name)";

export default async function AjusteInventarioPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("ajuste_inventario");
  const sp = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();
  const canAdjust = can(profile?.role, "productos:write");

  const { data: branchesData } = await supabase.from("branches").select("id, name").order("name");
  const branches = branchesData ?? [];

  let stockQuery = supabase.from("product_stock").select(STOCK_SELECT).order("branch_id").limit(100);
  if (sp.code) stockQuery = stockQuery.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.branchId) stockQuery = stockQuery.eq("branch_id", sp.branchId);
  const { data: stockData } = await stockQuery;
  const stockRows = (stockData ?? []) as unknown as StockRow[];

  return (
    <div className="space-y-6">
      <PageHeader title="Ajuste de Inventario" />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Código</span>
            <input type="text" name="code" defaultValue={sp.code ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Sucursal</span>
            <select name="branchId" defaultValue={sp.branchId ?? ""} className={fieldInputClass}>
              <option value="">Todas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Buscar</Button>
        </form>
      </Card>

      <Card>
        {stockRows.length === 0 ? (
          <EmptyState title="Sin resultados" description="Ajusta los filtros de búsqueda." />
        ) : (
          <ul className="divide-y divide-slate-200">
            {stockRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">
                    {row.products?.code ?? "—"}{" "}
                    <span className="font-normal text-slate-400">· {row.branches?.name ?? "—"}</span>
                  </p>
                  <p className="text-xs text-slate-400">Stock: {row.quantity}</p>
                </div>
                {canAdjust && (
                  <div className="flex shrink-0 gap-2">
                    <AdjustStockButton productId={row.product_id} branchId={row.branch_id} direction="add" />
                    <AdjustStockButton productId={row.product_id} branchId={row.branch_id} direction="reduce" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

Nota: `EmptyState` pierde el prop `icon` porque el ícono `History` de
`lucide-react` solo se usaba para el bloque de historial que ya no está
en este archivo — revisa `components/ui/EmptyState.tsx` en el Step 2 para
confirmar que `icon` es opcional antes de asumir que la omisión compila.

- [ ] **Step 2: Confirmar que `icon` es opcional en `EmptyState`**

Run: `grep -n "icon" "components/ui/EmptyState.tsx"`
Expected: la prop `icon` está tipada como opcional (`icon?:`). Si no lo
está, agrega de vuelta `import { History } from "lucide-react";` y
`icon={<History className="h-6 w-6" />}` en el `<EmptyState>` del Step 1
antes de continuar.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 4: Verificación manual**

1. Arrancar `npm run dev`, entrar a `/ajuste-inventario` con un usuario
   admin o manager.
2. Confirmar que la página muestra solo la sección "Productos" (filtro +
   lista con Agregar/Reducir), sin ninguna sección de historial debajo.
3. Confirmar que Agregar/Reducir siguen funcionando (abren el modal,
   confirman el ajuste, el stock se actualiza en pantalla tras
   `router.refresh()`).

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/ajuste-inventario/page.tsx"
git commit -m "refactor: remove movement history from Ajuste de Inventario"
```

---

### Task 3: Feature flag y menú

**Files:**
- Modify: `lib/features.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `FeatureKey` gana el literal `"movimientos_producto"` — Task 1
  y Task 4 dependen de este nombre exacto.

- [ ] **Step 1: Agregar el `FeatureKey` y la entrada en `FEATURES`**

En `lib/features.ts`, reemplaza el tipo `FeatureKey` (líneas 3-12) por:

```typescript
export type FeatureKey =
  | "dashboard"
  | "clientes"
  | "items"
  | "productos"
  | "proveedores"
  | "ventas"
  | "ajuste_inventario"
  | "movimientos_producto"
  | "ajustes"
  | "auditoria";
```

Y reemplaza el array `FEATURES` (líneas 25-35) por:

```typescript
export const FEATURES: FeatureMeta[] = [
  { key: "dashboard", label: "Inicio", href: "/dashboard", core: true },
  { key: "clientes", label: "Clientes", href: "/clientes" },
  { key: "items", label: "Inventario", href: "/items", optIn: true },
  { key: "productos", label: "Productos", href: "/productos", optIn: true },
  { key: "proveedores", label: "Proveedores", href: "/proveedores", optIn: true },
  { key: "ventas", label: "Ventas", href: "/ventas", optIn: true },
  { key: "ajuste_inventario", label: "Ajuste de Inventario", href: "/ajuste-inventario", optIn: true },
  { key: "movimientos_producto", label: "Movimientos de Producto", href: "/movimientos-producto", optIn: true },
  { key: "ajustes", label: "Ajustes", href: "/ajustes", core: true },
  { key: "auditoria", label: "Auditoría", href: "/auditoria", optIn: true },
];
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: 0 errores en `lib/features.ts` mismo (puede seguir habiendo
errores en `lib/rbac.ts` hasta aplicar Task 4 — esperado en este punto).

- [ ] **Step 3: Commit**

```bash
git add lib/features.ts
git commit -m "feat: add movimientos_producto feature flag"
```

---

### Task 4: Acceso por rol en el menú

**Files:**
- Modify: `lib/rbac.ts`

**Interfaces:**
- Consumes: `FeatureKey` con el literal `"movimientos_producto"` (Task 3).
- Produces: nada nuevo consumido por otras tasks — es la última pieza del
  cambio.

- [ ] **Step 1: Agregar `"movimientos_producto"` a `NAV_WHITELIST`**

En `lib/rbac.ts`, reemplaza el bloque `NAV_WHITELIST` (líneas 7-30) por:

```typescript
const NAV_WHITELIST: Record<Role, FeatureKey[]> = {
  admin: [
    "dashboard",
    "clientes",
    "items",
    "productos",
    "proveedores",
    "ventas",
    "ajuste_inventario",
    "movimientos_producto",
    "ajustes",
    "auditoria",
  ],
  manager: [
    "dashboard",
    "clientes",
    "items",
    "productos",
    "proveedores",
    "ventas",
    "ajuste_inventario",
    "movimientos_producto",
  ],
  member: ["dashboard", "clientes", "productos", "proveedores", "ventas"],
  viewer: ["dashboard", "clientes", "productos", "proveedores"],
};
```

No se toca `Permission` ni `MATRIX` — `movimientos_producto` no necesita
un permiso de escritura, solo el `requireNavAccess` que ya usa la página
(Task 1).

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: 0 errores en todo el proyecto (esta es la última pieza; todas
las tasks anteriores deben estar aplicadas).

- [ ] **Step 3: Verificación manual**

1. Con un usuario `admin` o `manager`, confirmar que "Movimientos de
   Producto" aparece en el menú lateral y que al hacer clic carga
   `/movimientos-producto` con el historial completo (mismos datos que
   antes se veían en `/ajuste-inventario`).
2. Probar los 5 filtros (código, sucursal, tipo, desde, hasta) y la
   paginación Anterior/Siguiente.
3. Con un usuario `member` o `viewer`, confirmar que "Movimientos de
   Producto" NO aparece en el menú, y que navegar manualmente a
   `/movimientos-producto` redirige a `/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add lib/rbac.ts
git commit -m "feat: grant admin/manager nav access to movimientos_producto"
```

---
