# Réplica funcional de Productos (legacy) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir el módulo Productos (`/productos`) como réplica funcional del legacy PHP "Registro de Productos" — formulario inline de alta, filtros por columna, fórmula de precio CF derivada de SF×1.13, auto-creación de catálogos, soft-delete, exportación a Excel — corrigiendo los bugs que tenía el legacy (filtros rotos, fórmula inconsistente).

**Architecture:** Next.js App Router (server component `page.tsx` + server actions) sobre Supabase/Postgres. Un formulario inline (`ProductRegistrationForm`, nuevo) reemplaza el modal de creación; el modal existente (`ProductFormModal`) se reduce a edición. Toda la lógica de cálculo de precio vive en `lib/pricing.ts` (función pura, reutilizada en cliente para el preview y en servidor para persistir). El soft-delete es una columna `active` filtrada en cada query de listado/selección de producto.

**Tech Stack:** Next.js (Server Components + Server Actions), Supabase (Postgres + PostgREST + RLS), Zod, Vitest, Tailwind.

## Global Constraints

- Fórmula de precio única (sin las inconsistencias del legacy):
  `costo_bs = costo_usd * tasa`; `sf_bs = costo_bs * (1 + sf%/100)`;
  `may_bs = costo_bs * (1 + may%/100)`; `cf_bs = sf_bs * 1.13`; `%CF` es
  siempre de solo lectura (derivado).
- `products.active boolean not null default true` — "Borrar" es soft-delete
  (`active = false`), no `DELETE`. Los listados/selecciones de producto en
  `/productos`, `/ventas` y Traspasos (Solicitud/Envío) filtran
  `active = true`. Los reportes históricos (Reporte Producto, Reporte
  Ventas, Movimientos de Producto, Ajuste de Inventario, Devoluciones,
  Dashboard, Almacén, ficha de Cliente) NO filtran por `active` — muestran
  datos históricos aunque el producto ya no esté activo, para no romper
  referencias ni ocultar historial (motivo explícito del soft-delete en el
  spec).
- Marca/Familia/Procedencia se auto-crean (uppercase) si el texto ingresado
  no existe todavía en la org — igual que el legacy
  (`validar_foranea_producto`). Proveedor sigue siendo un select estricto de
  proveedores ya existentes.
- Filtros por columna en la tabla de Productos: Código, Familia, MI, ME,
  Altura, Pestaña, Tope (con tolerancia ±3mm, mismo valor que usa Ventas vía
  `lib/measurementSearch.ts`), Aplicación, Marca, Procedencia, Proveedor —
  todos funcionan de verdad (a diferencia del legacy, donde
  Familia/Procedencia/Proveedor estaban rotos).
- Acciones de fila (Editar/Borrar) ocultas por defecto, visibles en hover
  sobre la fila (`group`/`group-hover` de Tailwind).
- Paginación con ventana + elipsis (la que ya existe), NO la lista completa
  de números del legacy.
- Stock de la tabla sigue siendo el total de todas las sucursales (no se
  replica la limitación del legacy de "una sola sucursal por sesión").
- Nada de esto se pushea sin aprobación explícita del usuario — todo local
  primero.

---

### Task 1: Migración — soft-delete + fórmula CF corregida en el RPC de tipo de cambio

**Files:**
- Create: `supabase/migrations/0018_products_active_and_cf_formula.sql`

**Interfaces:**
- Produces: columna `products.active boolean not null default true`;
  función `set_org_exchange_rate(p_org_id uuid, p_exchange_rate numeric)`
  actualizada para derivar `price_cf_bs`/`margin_cf_pct` de
  `price_sf_bs * 1.13` (antes usaba `margin_cf_pct` como input
  independiente — ver `supabase/migrations/0014_org_exchange_rate.sql`).

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- Soft-delete de productos (active) + fórmula de CF corregida y consistente:
-- CF Bs siempre se deriva de SF Bs × 1.13 (antes usaba margin_cf_pct como
-- input independiente, con fórmulas inconsistentes entre el formulario y el
-- reporte legacy). Ver
-- docs/superpowers/specs/2026-07-08-productos-legacy-replica-design.md
-- ============================================================================

alter table products
  add column active boolean not null default true;

-- Recalcula margin_cf_pct/price_cf_bs de los productos existentes con la
-- fórmula derivada, para que queden consistentes con la nueva regla antes de
-- que código nuevo dependa de ella.
update products
set price_cf_bs = round(price_sf_bs * 1.13, 2),
    margin_cf_pct = case
      when cost_usd is not null and exchange_rate is not null
           and cost_usd * exchange_rate > 0
        then round((round(price_sf_bs * 1.13, 2) / (cost_usd * exchange_rate) - 1) * 100, 2)
      else margin_cf_pct
    end
where price_sf_bs is not null;

-- set_org_exchange_rate (0014_org_exchange_rate.sql) recalculaba CF a partir
-- de margin_cf_pct almacenado, con una fórmula independiente. Se reemplaza
-- para que derive CF de SF×1.13, igual que
-- app/(dashboard)/productos/actions.ts (Task 3).
create or replace function set_org_exchange_rate(p_org_id uuid, p_exchange_rate numeric)
returns void
language sql
security invoker
as $$
  update organizations
  set exchange_rate = p_exchange_rate
  where id = p_org_id;

  update products
  set exchange_rate = p_exchange_rate,
      price_sf_bs = round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_sf_pct, 0) / 100), 2),
      price_may_bs = round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_may_pct, 0) / 100), 2),
      price_cf_bs = round(
        round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_sf_pct, 0) / 100), 2) * 1.13,
        2
      ),
      margin_cf_pct = case
        when coalesce(cost_usd, 0) * p_exchange_rate > 0
          then round((
            round(
              round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_sf_pct, 0) / 100), 2) * 1.13,
              2
            ) / (coalesce(cost_usd, 0) * p_exchange_rate) - 1
          ) * 100, 2)
        else 0
      end,
      updated_at = now()
  where org_id = p_org_id
    and cost_usd is not null
    and margin_sf_pct is not null
    and margin_may_pct is not null;
$$;

grant execute on function set_org_exchange_rate(uuid, numeric) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar la migración local**

Run: `npm run db:reset`
Expected (tail del output): `Applying migration 0018_products_active_and_cf_formula.sql...` sin
errores, seguido de `Seeding data from supabase/seed.sql...` y `Finished
supabase db reset on branch master.`

- [ ] **Step 3: Verificar la columna y la función**

Run (ajustar el nombre del contenedor si difiere —
`docker ps --format "{{.Names}}"` para confirmarlo):
```bash
docker exec supabase_db_productos-sucursales-stock psql -U postgres -d postgres -c "\d products" | grep active
```
Expected: una línea mostrando `active | boolean | not null | default true` (formato exacto puede variar, pero debe listar la columna `active`).

Run:
```bash
docker exec supabase_db_productos-sucursales-stock psql -U postgres -d postgres -c "select prosrc from pg_proc where proname='set_org_exchange_rate';" | grep "1.13"
```
Expected: al menos una línea con `1.13` (confirma que la función nueva quedó instalada).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0018_products_active_and_cf_formula.sql
git commit -m "feat: soft-delete de productos y fórmula CF derivada de SF×1.13"
```

---

### Task 2: `lib/pricing.ts` — fórmula CF derivada

**Files:**
- Modify: `lib/pricing.ts`
- Test: `lib/pricing.test.ts`

**Interfaces:**
- Consumes: nada (función pura).
- Produces: `calculatePrices(inputs: PriceInputs): CalculatedPrices` con
  `PriceInputs = { costUsd, exchangeRate, marginSfPct, marginMayPct }` (ya
  NO recibe `marginCfPct`) y `CalculatedPrices = { priceSfBs, priceCfBs,
  priceMayBs, marginCfPct }` (agrega `marginCfPct` calculado). Usado por
  Task 3 (`actions.ts`), Task 4 (`ProductRegistrationForm.tsx`) y Task 5
  (`ProductFormModal.tsx`).

- [ ] **Step 1: Escribir el test (falla porque la firma todavía no cambió)**

Reemplaza el contenido completo de `lib/pricing.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { calculatePrices } from "./pricing";

describe("calculatePrices", () => {
  it("converts cost to Bs and applies SF/MAY margin, deriving CF from SF×1.13", () => {
    const result = calculatePrices({
      costUsd: 10,
      exchangeRate: 8.1,
      marginSfPct: 20,
      marginMayPct: 10,
    });
    // costoBs = 81
    expect(result.priceSfBs).toBeCloseTo(97.2, 2); // 81 * 1.20
    expect(result.priceMayBs).toBeCloseTo(89.1, 2); // 81 * 1.10
    expect(result.priceCfBs).toBeCloseTo(109.84, 2); // round(97.2 * 1.13, 2)
    expect(result.marginCfPct).toBeCloseTo(35.58, 2); // (109.84/81 - 1) * 100
  });

  it("rounds to 2 decimals", () => {
    const result = calculatePrices({
      costUsd: 1,
      exchangeRate: 6.96,
      marginSfPct: 33,
      marginMayPct: 0,
    });
    // costoBs = 6.96, sf = 6.96 * 1.33 = 9.2568 -> 9.26
    expect(result.priceSfBs).toBe(9.26);
    expect(result.priceCfBs).toBe(10.46); // round(9.26 * 1.13, 2)
  });

  it("returns zero prices and zero CF margin when cost is zero", () => {
    const result = calculatePrices({
      costUsd: 0,
      exchangeRate: 8.1,
      marginSfPct: 20,
      marginMayPct: 10,
    });
    expect(result.priceSfBs).toBe(0);
    expect(result.priceCfBs).toBe(0);
    expect(result.priceMayBs).toBe(0);
    expect(result.marginCfPct).toBe(0);
  });

  it("CF is always exactly SF × 1.13, regardless of MAY", () => {
    const result = calculatePrices({
      costUsd: 100,
      exchangeRate: 1,
      marginSfPct: 0,
      marginMayPct: 999,
    });
    expect(result.priceSfBs).toBe(100);
    expect(result.priceCfBs).toBe(113); // 100 * 1.13
    expect(result.marginCfPct).toBe(13);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run lib/pricing.test.ts`
Expected: FAIL — `calculatePrices` todavía espera `marginCfPct` como input y
no devuelve `marginCfPct` en el resultado (los `expect` de arriba no
matchean el comportamiento actual).

- [ ] **Step 3: Reescribir la implementación**

Reemplaza el contenido completo de `lib/pricing.ts`:

```typescript
// Cálculo de precios de producto a partir de costo en USD + tipo de cambio +
// margen SF/MAY. CF ya no es un input independiente: siempre se deriva de
// SF Bs × 1.13 (regla fijada para reemplazar la fórmula inconsistente del
// legacy — ver docs/superpowers/specs/2026-07-08-productos-legacy-replica-design.md).
// Función pura: sin acceso a DB ni a React.
export interface PriceInputs {
  costUsd: number;
  exchangeRate: number;
  marginSfPct: number;
  marginMayPct: number;
}

export interface CalculatedPrices {
  priceSfBs: number;
  priceCfBs: number;
  priceMayBs: number;
  marginCfPct: number;
}

const CF_MULTIPLIER = 1.13;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculatePrices(inputs: PriceInputs): CalculatedPrices {
  const costBs = inputs.costUsd * inputs.exchangeRate;
  const priceSfBs = round2(costBs * (1 + inputs.marginSfPct / 100));
  const priceMayBs = round2(costBs * (1 + inputs.marginMayPct / 100));
  const priceCfBs = round2(priceSfBs * CF_MULTIPLIER);
  const marginCfPct = costBs > 0 ? round2((priceCfBs / costBs - 1) * 100) : 0;
  return { priceSfBs, priceCfBs, priceMayBs, marginCfPct };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run lib/pricing.test.ts`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing.ts lib/pricing.test.ts
git commit -m "feat: fórmula de precio CF derivada de SF×1.13"
```

---

### Task 3: `lib/catalogs.ts` + `app/(dashboard)/productos/actions.ts` — auto-creación de catálogos, fórmula derivada, soft-delete

**Files:**
- Modify: `lib/catalogs.ts`
- Modify: `app/(dashboard)/productos/actions.ts`

**Interfaces:**
- Consumes: `calculatePrices` de Task 2 (nueva firma sin `marginCfPct`).
- Produces: `resolveOrCreateCatalogEntry(supabase, table, orgId, name):
  Promise<string>` (nuevo, en `lib/catalogs.ts`) — usado por Task 4/5 solo
  indirectamente (lo llaman `createProduct`/`updateProduct`, no los
  componentes). `createProduct(formData)` y `updateProduct(id, formData)`
  ahora esperan campos de formulario `brand`, `family`, `origin` (texto
  libre) en vez de `brand_id`/`family_id`/`origin_id` (uuid) — Task 4 y 5
  dependen de este contrato exacto. `deleteProduct(id)` pasa a hacer
  soft-delete.

- [ ] **Step 1: Agregar `resolveOrCreateCatalogEntry` a `lib/catalogs.ts`**

Agrega esta función al final de `lib/catalogs.ts` (después de
`verifyBranchInOrg`, sin tocar el resto del archivo):

```typescript
// Get-or-create para Marca/Familia/Procedencia al guardar un producto: si el
// nombre escrito no existe todavía en la org (comparación case-insensitive,
// trim), se crea en MAYÚSCULAS — igual que validar_foranea_producto() del
// legacy. Reintenta la búsqueda si el insert falla por una carrera (otro
// request creó el mismo nombre entre el select y el insert).
export async function resolveOrCreateCatalogEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: SimpleCatalogTable,
  orgId: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  const { data: existing } = await supabase.from(table).select("id, name").eq("org_id", orgId);
  const match = (existing ?? []).find((row) => row.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match.id;

  const upper = trimmed.toUpperCase();
  const { data: inserted, error } = await supabase
    .from(table)
    .insert({ org_id: orgId, name: upper })
    .select("id")
    .single();
  if (error) {
    const { data: retry } = await supabase.from(table).select("id, name").eq("org_id", orgId);
    const retryMatch = (retry ?? []).find((row) => row.name.toLowerCase() === upper.toLowerCase());
    if (retryMatch) return retryMatch.id;
    throw new Error(`No se pudo resolver/crear "${trimmed}" en ${table}: ${error.message}`);
  }
  return inserted!.id;
}
```

- [ ] **Step 2: Reescribir `productSchema`, `parseProductForm`, `createProduct`, `updateProduct` y `deleteProduct` en `actions.ts`**

Primero, en el bloque de imports al inicio del archivo (líneas 9-14),
agrega `resolveOrCreateCatalogEntry` a la lista que ya se importa de
`@/lib/catalogs`:

```typescript
import {
  insertCatalogEntry,
  deleteCatalogEntry,
  catalogNameSchema,
  verifyBranchInOrg,
  resolveOrCreateCatalogEntry,
} from "@/lib/catalogs";
```

Después, reemplaza desde la línea `// ── Productos` (línea 111 del archivo
actual) hasta el final de `deleteProduct` (línea 364) con:

```typescript
// ── Productos ────────────────────────────────────────────────────────────
const productSchema = z.object({
  code: z.string().trim().min(1, "El código es obligatorio.").max(80),
  brand: z.string().trim().min(1, "La marca es obligatoria.").max(120),
  family: z.string().trim().min(1, "La familia es obligatoria.").max(120),
  origin: z.string().trim().max(120).optional().or(z.literal("")),
  supplier_id: z.string().uuid().optional().or(z.literal("")),
  internal_mm: z.coerce.number().optional(),
  external_mm: z.coerce.number().optional(),
  height_mm: z.coerce.number().optional(),
  flange_mm: z.coerce.number().optional(),
  stop_mm: z.coerce.number().optional(),
  application: z.string().trim().max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  cost_usd: z.coerce.number().min(0, "El costo no puede ser negativo."),
  margin_sf_pct: z.coerce.number(),
  margin_may_pct: z.coerce.number(),
});

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    code: formData.get("code"),
    brand: formData.get("brand"),
    family: formData.get("family"),
    origin: formData.get("origin"),
    supplier_id: formData.get("supplier_id"),
    internal_mm: formData.get("internal_mm") || undefined,
    external_mm: formData.get("external_mm") || undefined,
    height_mm: formData.get("height_mm") || undefined,
    flange_mm: formData.get("flange_mm") || undefined,
    stop_mm: formData.get("stop_mm") || undefined,
    application: formData.get("application"),
    notes: formData.get("notes"),
    cost_usd: formData.get("cost_usd"),
    margin_sf_pct: formData.get("margin_sf_pct"),
    margin_may_pct: formData.get("margin_may_pct"),
  });
}

export async function createProduct(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para crear productos." };
  }

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const branchId = formData.get("branch_id");
  if (typeof branchId !== "string" || !branchId) {
    return { ok: false, error: "Selecciona una sucursal para el stock inicial." };
  }
  const quantity = Number(formData.get("quantity") ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, error: "La cantidad debe ser un número mayor o igual a 0." };
  }

  const supabase = await createClient();
  const branchValid = await verifyBranchInOrg(supabase, branchId, profile.orgId);
  if (!branchValid) {
    return { ok: false, error: "La sucursal seleccionada no es válida." };
  }
  const exchangeRate = await getOrgExchangeRate(supabase, profile.orgId);

  let brandId: string;
  let familyId: string;
  let originId: string | null;
  try {
    brandId = await resolveOrCreateCatalogEntry(supabase, "product_brands", profile.orgId, parsed.data.brand);
    familyId = await resolveOrCreateCatalogEntry(
      supabase,
      "product_families",
      profile.orgId,
      parsed.data.family,
    );
    originId = parsed.data.origin
      ? await resolveOrCreateCatalogEntry(supabase, "product_origins", profile.orgId, parsed.data.origin)
      : null;
  } catch (err) {
    console.error("createProduct catálogos:", err);
    return { ok: false, error: "No se pudo resolver marca/familia/procedencia." };
  }

  const prices = calculatePrices({
    costUsd: parsed.data.cost_usd,
    exchangeRate,
    marginSfPct: parsed.data.margin_sf_pct,
    marginMayPct: parsed.data.margin_may_pct,
  });

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      org_id: profile.orgId,
      code: parsed.data.code,
      brand_id: brandId,
      family_id: familyId,
      origin_id: originId,
      supplier_id: parsed.data.supplier_id || null,
      internal_mm: parsed.data.internal_mm ?? null,
      external_mm: parsed.data.external_mm ?? null,
      height_mm: parsed.data.height_mm ?? null,
      flange_mm: parsed.data.flange_mm ?? null,
      stop_mm: parsed.data.stop_mm ?? null,
      application: parsed.data.application || null,
      notes: parsed.data.notes || null,
      cost_usd: parsed.data.cost_usd,
      exchange_rate: exchangeRate,
      margin_sf_pct: parsed.data.margin_sf_pct,
      margin_cf_pct: prices.marginCfPct,
      margin_may_pct: parsed.data.margin_may_pct,
      price_sf_bs: prices.priceSfBs,
      price_cf_bs: prices.priceCfBs,
      price_may_bs: prices.priceMayBs,
    })
    .select("id")
    .single();
  if (error || !product) {
    console.error("createProduct:", error?.message);
    if (error?.code === "23505") {
      return { ok: false, error: "Ya existe un producto con ese código y marca." };
    }
    return { ok: false, error: "No se pudo crear el producto." };
  }

  const { error: stockError } = await supabase.from("product_stock").insert({
    org_id: profile.orgId,
    product_id: product.id,
    branch_id: branchId,
    quantity,
  });
  if (stockError) {
    console.error("createProduct stock:", stockError.message);
    const { error: rollbackError } = await supabase.from("products").delete().eq("id", product.id);
    if (rollbackError) {
      console.error(
        "createProduct rollback failed, orphaned product row:",
        product.id,
        rollbackError.message,
      );
    }
    return { ok: false, error: "El producto se creó, pero no se pudo registrar el stock." };
  }

  const { error: movementError } = await supabase.from("stock_movements").insert({
    org_id: profile.orgId,
    product_id: product.id,
    branch_id: branchId,
    movement_type: "alta_inicial",
    quantity_delta: quantity,
    resulting_quantity: quantity,
    reason: null,
    actor_id: profile.userId,
    sale_id: null,
  });
  if (movementError) {
    console.error("createProduct movement:", movementError.message);
    const { error: stockRollbackError } = await supabase
      .from("product_stock")
      .delete()
      .eq("product_id", product.id)
      .eq("branch_id", branchId);
    const { error: productRollbackError } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id);
    if (stockRollbackError || productRollbackError) {
      console.error(
        "createProduct rollback failed after movement insert error, orphaned product row:",
        product.id,
        stockRollbackError?.message,
        productRollbackError?.message,
      );
    }
    return {
      ok: false,
      error: "El producto se creó, pero no se pudo registrar el historial de stock.",
    };
  }

  revalidatePath("/productos");
  return { ok: true };
}

export async function updateProduct(id: string, formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para editar productos." };
  }

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const exchangeRate = await getOrgExchangeRate(supabase, profile.orgId);

  let brandId: string;
  let familyId: string;
  let originId: string | null;
  try {
    brandId = await resolveOrCreateCatalogEntry(supabase, "product_brands", profile.orgId, parsed.data.brand);
    familyId = await resolveOrCreateCatalogEntry(
      supabase,
      "product_families",
      profile.orgId,
      parsed.data.family,
    );
    originId = parsed.data.origin
      ? await resolveOrCreateCatalogEntry(supabase, "product_origins", profile.orgId, parsed.data.origin)
      : null;
  } catch (err) {
    console.error("updateProduct catálogos:", err);
    return { ok: false, error: "No se pudo resolver marca/familia/procedencia." };
  }

  const prices = calculatePrices({
    costUsd: parsed.data.cost_usd,
    exchangeRate,
    marginSfPct: parsed.data.margin_sf_pct,
    marginMayPct: parsed.data.margin_may_pct,
  });

  const { error } = await supabase
    .from("products")
    .update({
      code: parsed.data.code,
      brand_id: brandId,
      family_id: familyId,
      origin_id: originId,
      supplier_id: parsed.data.supplier_id || null,
      internal_mm: parsed.data.internal_mm ?? null,
      external_mm: parsed.data.external_mm ?? null,
      height_mm: parsed.data.height_mm ?? null,
      flange_mm: parsed.data.flange_mm ?? null,
      stop_mm: parsed.data.stop_mm ?? null,
      application: parsed.data.application || null,
      notes: parsed.data.notes || null,
      cost_usd: parsed.data.cost_usd,
      exchange_rate: exchangeRate,
      margin_sf_pct: parsed.data.margin_sf_pct,
      margin_cf_pct: prices.marginCfPct,
      margin_may_pct: parsed.data.margin_may_pct,
      price_sf_bs: prices.priceSfBs,
      price_cf_bs: prices.priceCfBs,
      price_may_bs: prices.priceMayBs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("updateProduct:", error.message);
    if (error.code === "23505") {
      return { ok: false, error: "Ya existe un producto con ese código y marca." };
    }
    return { ok: false, error: "No se pudo actualizar el producto." };
  }

  revalidatePath("/productos");
  return { ok: true };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:delete")) {
    return { ok: false, error: "No tienes permiso para eliminar productos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ active: false }).eq("id", id);
  if (error) {
    console.error("deleteProduct:", error.message);
    return { ok: false, error: "No se pudo eliminar el producto." };
  }

  revalidatePath("/productos");
  return { ok: true };
}
```

No toques `updateProductStock` (queda igual, después de `deleteProduct`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `lib/catalogs.ts` ni `app/(dashboard)/productos/actions.ts` (habrá errores esperados en `components/productos/ProductFormModal.tsx` y `.../ProductRegistrationForm.tsx` hasta Tasks 4 y 5 — anótalos pero no los arregles en este task).

- [ ] **Step 4: Commit**

```bash
git add lib/catalogs.ts "app/(dashboard)/productos/actions.ts"
git commit -m "feat: auto-creación de marca/familia/procedencia y soft-delete en productos"
```

---

### Task 4: `components/productos/ProductRegistrationForm.tsx` — formulario inline de alta

**Files:**
- Create: `components/productos/ProductRegistrationForm.tsx`

**Interfaces:**
- Consumes: `createProduct` de Task 3 (campos `code, brand, family, origin,
  supplier_id, branch_id, quantity, internal_mm, external_mm, height_mm,
  flange_mm, stop_mm, application, notes, cost_usd, margin_sf_pct,
  margin_may_pct`); `calculatePrices` de Task 2.
- Produces: `ProductRegistrationForm({ brands, families, origins,
  suppliers, branches, exchangeRate })` — montado por Task 6 en
  `productos/page.tsx`, arriba de la tabla, solo si `canWriteProductos`.

- [ ] **Step 1: Crear el componente**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { calculatePrices } from "@/lib/pricing";
import { createProduct } from "@/app/(dashboard)/productos/actions";

type CatalogOption = { id: string; name: string };

export function ProductRegistrationForm({
  brands,
  families,
  origins,
  suppliers,
  branches,
  exchangeRate,
}: {
  brands: CatalogOption[];
  families: CatalogOption[];
  origins: CatalogOption[];
  suppliers: CatalogOption[];
  branches: CatalogOption[];
  exchangeRate: number;
}) {
  const [formKey, setFormKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [costUsd, setCostUsd] = useState("");
  const [marginSf, setMarginSf] = useState("");
  const [marginMay, setMarginMay] = useState("");
  const router = useRouter();

  const preview = useMemo(() => {
    if (costUsd === "" || marginSf === "" || marginMay === "") return null;
    const cost = Number(costUsd);
    const sf = Number(marginSf);
    const may = Number(marginMay);
    if (![cost, sf, may].every((n) => Number.isFinite(n))) return null;
    return calculatePrices({ costUsd: cost, exchangeRate, marginSfPct: sf, marginMayPct: may });
  }, [costUsd, exchangeRate, marginMay, marginSf]);

  const costBs = preview ? (Number(costUsd) * exchangeRate).toFixed(2) : "";

  function reset() {
    setCostUsd("");
    setMarginSf("");
    setMarginMay("");
    setFormKey((k) => k + 1);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const res = await createProduct(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo registrar el producto.", "error");
      return;
    }
    toast("Producto registrado.");
    reset();
    router.refresh();
  }

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Registro de Productos</h3>
      <form key={formKey} onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-6">
          <Field label="Código" name="code" required />
          <Field label="Interno (mm)" name="internal_mm" type="number" step="0.01" />
          <Field label="Externo (mm)" name="external_mm" type="number" step="0.01" />
          <Field label="Altura (mm)" name="height_mm" type="number" step="0.01" />
          <Field label="Pestaña (mm)" name="flange_mm" type="number" step="0.01" />
          <Field label="Tope (mm)" name="stop_mm" type="number" step="0.01" />
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Marca" name="brand" required list="brands-datalist" placeholder="Escribe o elige…" />
          <Field
            label="Familia"
            name="family"
            required
            list="families-datalist"
            placeholder="Escribe o elige…"
          />
          <Field label="Procedencia" name="origin" list="origins-datalist" placeholder="Escribe o elige…" />
          <label className="block text-sm">
            <FieldLabel>Proveedor</FieldLabel>
            <select name="supplier_id" defaultValue="" className={fieldInputClass}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <datalist id="brands-datalist">
          {brands.map((b) => (
            <option key={b.id} value={b.name} />
          ))}
        </datalist>
        <datalist id="families-datalist">
          {families.map((f) => (
            <option key={f.id} value={f.name} />
          ))}
        </datalist>
        <datalist id="origins-datalist">
          {origins.map((o) => (
            <option key={o.id} value={o.name} />
          ))}
        </datalist>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <FieldLabel>Sucursal</FieldLabel>
            <select name="branch_id" required defaultValue="" className={fieldInputClass}>
              <option value="" disabled>
                Selecciona…
              </option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Cantidad" name="quantity" type="number" min={0} defaultValue={0} required />
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          <Field
            label="Costo $"
            name="cost_usd"
            type="number"
            step="0.01"
            required
            value={costUsd}
            onChange={(e) => setCostUsd(e.target.value)}
          />
          <label className="block text-sm">
            <FieldLabel>T. Cambio</FieldLabel>
            <input type="text" disabled value={exchangeRate} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <FieldLabel>Costo Bs</FieldLabel>
            <input type="text" disabled value={costBs} className={fieldInputClass} />
          </label>
          <Field
            label="SF %"
            name="margin_sf_pct"
            type="number"
            step="0.01"
            required
            value={marginSf}
            onChange={(e) => setMarginSf(e.target.value)}
          />
          <Field
            label="MAY %"
            name="margin_may_pct"
            type="number"
            step="0.01"
            required
            value={marginMay}
            onChange={(e) => setMarginMay(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <FieldLabel>SF Bs</FieldLabel>
            <input type="text" disabled value={preview?.priceSfBs ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <FieldLabel>CF Bs (% {preview ? preview.marginCfPct : "—"})</FieldLabel>
            <input type="text" disabled value={preview?.priceCfBs ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <FieldLabel>MAY Bs</FieldLabel>
            <input type="text" disabled value={preview?.priceMayBs ?? ""} className={fieldInputClass} />
          </label>
        </div>

        <label className="block text-sm">
          <FieldLabel>Aplicación</FieldLabel>
          <textarea name="application" rows={2} className={fieldInputClass} />
        </label>

        <label className="block text-sm">
          <FieldLabel>Notas</FieldLabel>
          <textarea name="notes" rows={2} className={fieldInputClass} />
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={reset}>
            Limpiar Campos
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Guardando…" : "Registrar Producto"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en `ProductRegistrationForm.tsx` (puede seguir habiendo
errores en `ProductFormModal.tsx` y `page.tsx`, pendientes de Tasks 5 y 6).

- [ ] **Step 3: Commit**

```bash
git add components/productos/ProductRegistrationForm.tsx
git commit -m "feat: formulario inline de alta de productos (réplica legacy)"
```

---

### Task 5: `components/productos/ProductFormModal.tsx` — simplificar a solo edición

**Files:**
- Modify: `components/productos/ProductFormModal.tsx`

**Interfaces:**
- Consumes: `updateProduct`/`updateProductStock` de Task 3;
  `calculatePrices` de Task 2.
- Produces: `ProductFormModal({ product, stock, brands, families, origins,
  suppliers, exchangeRate })` sin prop `mode` — siempre edición. `product`
  ahora requiere `brandName`, `familyName`, `originName` (nombres, no ids)
  en vez de `brand_id`/`family_id`/`origin_id`. Consumido por Task 6.

- [ ] **Step 1: Reemplazar el archivo completo**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { calculatePrices } from "@/lib/pricing";
import { updateProduct, updateProductStock } from "@/app/(dashboard)/productos/actions";

type CatalogOption = { id: string; name: string };

type ProductDetail = {
  id: string;
  code: string;
  brandName: string;
  familyName: string;
  originName: string | null;
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
};

type StockRow = { branch_id: string; branch_name: string; quantity: number };

export function ProductFormModal({
  product,
  stock,
  brands,
  families,
  origins,
  suppliers,
  exchangeRate,
}: {
  product: ProductDetail;
  stock: StockRow[];
  brands: CatalogOption[];
  families: CatalogOption[];
  origins: CatalogOption[];
  suppliers: CatalogOption[];
  exchangeRate: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const [costUsd, setCostUsd] = useState(product.cost_usd?.toString() ?? "");
  const [marginSf, setMarginSf] = useState(product.margin_sf_pct?.toString() ?? "");
  const [marginMay, setMarginMay] = useState(product.margin_may_pct?.toString() ?? "");

  const preview = useMemo(() => {
    if (costUsd === "" || marginSf === "" || marginMay === "") return null;
    const cost = Number(costUsd);
    const sf = Number(marginSf);
    const may = Number(marginMay);
    if (![cost, sf, may].every((n) => Number.isFinite(n))) return null;
    return calculatePrices({ costUsd: cost, exchangeRate, marginSfPct: sf, marginMayPct: may });
  }, [costUsd, exchangeRate, marginMay, marginSf]);

  const costBs = preview ? (Number(costUsd) * exchangeRate).toFixed(2) : "";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const res = await updateProduct(product.id, formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo guardar el producto.", "error");
      return;
    }
    toast("Producto actualizado.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Editar
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Editar ${product.code}`} size="xl">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Código" name="code" required defaultValue={product.code} />
            <Field
              label="Marca"
              name="brand"
              required
              defaultValue={product.brandName}
              list="edit-brands-datalist"
            />
            <Field
              label="Familia"
              name="family"
              required
              defaultValue={product.familyName}
              list="edit-families-datalist"
            />
          </div>
          <datalist id="edit-brands-datalist">
            {brands.map((b) => (
              <option key={b.id} value={b.name} />
            ))}
          </datalist>
          <datalist id="edit-families-datalist">
            {families.map((f) => (
              <option key={f.id} value={f.name} />
            ))}
          </datalist>
          <datalist id="edit-origins-datalist">
            {origins.map((o) => (
              <option key={o.id} value={o.name} />
            ))}
          </datalist>

          <div className="grid gap-3 sm:grid-cols-5">
            <Field
              label="Interno (mm)"
              name="internal_mm"
              type="number"
              step="0.01"
              defaultValue={product.internal_mm ?? ""}
            />
            <Field
              label="Externo (mm)"
              name="external_mm"
              type="number"
              step="0.01"
              defaultValue={product.external_mm ?? ""}
            />
            <Field
              label="Altura (mm)"
              name="height_mm"
              type="number"
              step="0.01"
              defaultValue={product.height_mm ?? ""}
            />
            <Field
              label="Pestaña (mm)"
              name="flange_mm"
              type="number"
              step="0.01"
              defaultValue={product.flange_mm ?? ""}
            />
            <Field
              label="Tope (mm)"
              name="stop_mm"
              type="number"
              step="0.01"
              defaultValue={product.stop_mm ?? ""}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Procedencia"
              name="origin"
              defaultValue={product.originName ?? ""}
              list="edit-origins-datalist"
            />
            <label className="block text-sm">
              <FieldLabel>Proveedor</FieldLabel>
              <select name="supplier_id" defaultValue={product.supplier_id ?? ""} className={fieldInputClass}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-sm">
            <FieldLabel>Aplicación</FieldLabel>
            <textarea
              name="application"
              rows={2}
              defaultValue={product.application ?? ""}
              className={fieldInputClass}
            />
          </label>

          <label className="block text-sm">
            <FieldLabel>Notas</FieldLabel>
            <textarea
              name="notes"
              rows={2}
              defaultValue={product.notes ?? ""}
              className={fieldInputClass}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-5">
            <Field
              label="Costo $"
              name="cost_usd"
              type="number"
              step="0.01"
              required
              value={costUsd}
              onChange={(e) => setCostUsd(e.target.value)}
            />
            <label className="block text-sm">
              <FieldLabel>T. Cambio</FieldLabel>
              <input type="text" disabled value={exchangeRate} className={fieldInputClass} />
            </label>
            <label className="block text-sm">
              <FieldLabel>Costo Bs</FieldLabel>
              <input type="text" disabled value={costBs} className={fieldInputClass} />
            </label>
            <Field
              label="SF %"
              name="margin_sf_pct"
              type="number"
              step="0.01"
              required
              value={marginSf}
              onChange={(e) => setMarginSf(e.target.value)}
            />
            <Field
              label="MAY %"
              name="margin_may_pct"
              type="number"
              step="0.01"
              required
              value={marginMay}
              onChange={(e) => setMarginMay(e.target.value)}
            />
          </div>

          {preview && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              SF: {preview.priceSfBs} Bs · CF: {preview.priceCfBs} Bs (%{preview.marginCfPct}) · MAY:{" "}
              {preview.priceMayBs} Bs
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>

        <StockSection productId={product.id} stock={stock} />
      </Modal>
    </>
  );
}

function StockSection({ productId, stock }: { productId: string; stock: StockRow[] }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(stock.map((s) => [s.branch_id, String(s.quantity)])),
  );
  const [savingBranchId, setSavingBranchId] = useState<string | null>(null);
  const router = useRouter();

  async function save(branchId: string) {
    const quantity = Number(values[branchId]);
    if (!Number.isFinite(quantity) || quantity < 0) {
      toast("La cantidad debe ser un número mayor o igual a 0.", "error");
      return;
    }
    setSavingBranchId(branchId);
    const res = await updateProductStock(productId, branchId, quantity);
    setSavingBranchId(null);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar el stock.", "error");
      return;
    }
    toast("Stock actualizado.");
    router.refresh();
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-4">
      <h4 className="mb-2 text-sm font-semibold text-slate-700">Stock por sucursal</h4>
      <ul className="space-y-2">
        {stock.map((s) => (
          <li key={s.branch_id} className="flex items-center gap-2">
            <span className="w-40 truncate text-sm text-slate-600">{s.branch_name}</span>
            <input
              type="number"
              min={0}
              value={values[s.branch_id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [s.branch_id]: e.target.value }))}
              className={fieldInputClass}
            />
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={savingBranchId === s.branch_id}
              onClick={() => save(s.branch_id)}
            >
              Guardar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en `ProductFormModal.tsx` (`productos/page.tsx` sigue
con errores hasta Task 6, es esperado).

- [ ] **Step 3: Commit**

```bash
git add components/productos/ProductFormModal.tsx
git commit -m "feat: modal de edición de producto con auto-completar y fórmula derivada"
```

---

### Task 6: `app/(dashboard)/productos/page.tsx` — filtros por columna, acciones en hover, formulario inline, active=true

**Files:**
- Modify: `app/(dashboard)/productos/page.tsx`

**Interfaces:**
- Consumes: `ProductRegistrationForm` (Task 4), `ProductFormModal` (Task
  5), `toleranceRange` de `lib/measurementSearch.ts` (ya existe, usado por
  `ventas/page.tsx`).
- Produces: nada consumido por otro task de este plan.

- [ ] **Step 1: Reemplazar el archivo completo**

```tsx
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

const PRODUCT_SELECT =
  "id, code, supplier_id, internal_mm, external_mm, height_mm, flange_mm, stop_mm, application, notes, cost_usd, margin_sf_pct, margin_may_pct, price_sf_bs, price_cf_bs, price_may_bs, product_brands(name), product_families(name), product_origins(name), suppliers(name)";

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
      .select(PRODUCT_SELECT, { count: "exact" })
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en todo `app/(dashboard)/productos/` (Tasks 3-6 ya
deben quedar consistentes entre sí).

- [ ] **Step 3: Verificación manual**

Run: `npm run dev` (o confirmar que el servidor ya está corriendo) y en el
navegador:
1. Ir a `/productos` — debe mostrar el formulario "Registro de Productos"
   arriba (si el usuario tiene permiso de escritura), la fila de filtros por
   columna, y la tabla con los productos existentes.
2. Escribir una marca NUEVA (que no exista) en el formulario de alta,
   completar el resto de campos, y Registrar — debe crear el producto Y la
   marca nueva (verificable en la pestaña "Marcas").
3. Pasar el mouse sobre una fila de la tabla — deben aparecer los botones
   Editar/Borrar (invisibles fuera de hover).
4. Filtrar por Familia con un texto — debe filtrar de verdad (a diferencia
   del legacy).
5. Borrar un producto — debe desaparecer de la tabla; confirmar en la DB
   (`select active from products where id = '<id>'`) que quedó en `false`,
   no borrado.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/productos/page.tsx"
git commit -m "feat: filtros por columna, acciones en hover y formulario inline en Productos"
```

---

### Task 7: Exportar catálogo a Excel

**Files:**
- Create: `app/(dashboard)/productos/exportar/route.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores directamente (usa `active` de Task 1).
- Produces: `GET /productos/exportar` — ya referenciado por el botón
  "Exportar Excel" agregado en Task 6.

- [ ] **Step 1: Crear el Route Handler**

```typescript
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

// Exporta el catálogo completo de productos activos a Excel — equivalente a
// los botones "Catálogo Pt1/Pt2" del legacy, sin partir en bloques de 7500
// filas (esa limitación era de Laravel-Excel/memoria del legacy y no aplica
// aquí). Un Route Handler porque el navegador necesita descargar un archivo
// binario directamente, no un valor de React (mismo patrón que
// app/(dashboard)/ajustes/exportar/route.ts).
const PAGE_SIZE = 1000;
const EXPORT_SELECT =
  "id, code, internal_mm, external_mm, height_mm, flange_mm, stop_mm, application, cost_usd, price_cf_bs, price_sf_bs, price_may_bs, product_brands(name), product_families(name), product_origins(name)";

type ExportRow = {
  id: string;
  code: string;
  internal_mm: number | null;
  external_mm: number | null;
  height_mm: number | null;
  flange_mm: number | null;
  stop_mm: number | null;
  application: string | null;
  cost_usd: number | null;
  price_cf_bs: number;
  price_sf_bs: number;
  price_may_bs: number;
  product_brands: { name: string } | null;
  product_families: { name: string } | null;
  product_origins: { name: string } | null;
};

export async function GET() {
  const profile = await getProfile();
  if (!profile || !can(profile.role, "productos:read")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: stockData } = await supabase.from("product_stock").select("product_id, quantity");
  const stockByProduct = new Map<string, number>();
  for (const row of stockData ?? []) {
    const productId = row.product_id as string;
    stockByProduct.set(productId, (stockByProduct.get(productId) ?? 0) + (row.quantity as number));
  }

  const rows: ExportRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("products")
      .select(EXPORT_SELECT)
      .eq("active", true)
      .order("code")
      .range(from, from + PAGE_SIZE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as unknown as ExportRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const sheetRows = rows.map((r) => ({
    FAMILIA: r.product_families?.name ?? "",
    CODIGO_PRODUCTO: r.code,
    MARCA: r.product_brands?.name ?? "",
    STOCK: stockByProduct.get(r.id) ?? 0,
    "COSTO $": r.cost_usd ?? 0,
    "CF Bs": r.price_cf_bs,
    "SF Bs": r.price_sf_bs,
    "MAY Bs": r.price_may_bs,
    MI: r.internal_mm ?? "",
    ME: r.external_mm ?? "",
    ALT: r.height_mm ?? "",
    PEST: r.flange_mm ?? "",
    TOPE: r.stop_mm ?? "",
    APLICACION: r.application ?? "",
    PROCEDENCIA: r.product_origins?.name ?? "",
  }));

  const worksheet =
    sheetRows.length > 0
      ? XLSX.utils.json_to_sheet(sheetRows)
      : XLSX.utils.aoa_to_sheet([["(sin productos)"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Productos");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="catalogo-productos-${today}.xlsx"`,
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Verificación manual**

Con el dev server corriendo, ir a `/productos` y hacer click en "Exportar
Excel" — debe descargar un `.xlsx` con una hoja "Productos" y las columnas
listadas arriba, solo con productos `active=true`.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/productos/exportar/route.ts"
git commit -m "feat: exportar catálogo de productos a Excel"
```

---

### Task 8: Filtrar `active = true` en la selección de producto de Ventas y Traspasos

**Files:**
- Modify: `app/(dashboard)/ventas/page.tsx:88-97`
- Modify: `app/(dashboard)/traspasos/page.tsx:180-184`

**Interfaces:**
- Consumes: columna `products.active` de Task 1.
- Produces: nada consumido por otro task.

- [ ] **Step 1: Ventas — agregar el filtro**

En `app/(dashboard)/ventas/page.tsx`, la query empieza así (líneas 88-97):

```typescript
  let query = supabase
    .from("products")
    .select(RESULT_SELECT, { count: hasMeasurementFilter ? undefined : "exact" })
    .eq("product_stock.branch_id", branchId)
    .order("external_mm", { nullsFirst: false })
```

Agrega `.eq("active", true)` justo después del `.select(...)`:

```typescript
  let query = supabase
    .from("products")
    .select(RESULT_SELECT, { count: hasMeasurementFilter ? undefined : "exact" })
    .eq("active", true)
    .eq("product_stock.branch_id", branchId)
    .order("external_mm", { nullsFirst: false })
```

(el resto de la función queda igual — no toques nada más).

- [ ] **Step 2: Traspasos — agregar el filtro**

En `app/(dashboard)/traspasos/page.tsx`, la query del tab `sol_env`
(líneas 180-184):

```typescript
  let query = supabase
    .from("products")
    .select("id, code, application, product_stock!inner(quantity)", { count: "exact" })
    .eq("product_stock.branch_id", branchId)
    .order("created_at", { ascending: false });
```

Cámbiala a:

```typescript
  let query = supabase
    .from("products")
    .select("id, code, application, product_stock!inner(quantity)", { count: "exact" })
    .eq("active", true)
    .eq("product_stock.branch_id", branchId)
    .order("created_at", { ascending: false });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Verificación manual**

Con el dev server corriendo: borrar (soft-delete) un producto desde
`/productos`, luego confirmar que ya NO aparece en la búsqueda de productos
de `/ventas` ni en la pestaña "Solicitud/Envío" de `/traspasos`, pero SIGUE
apareciendo en reportes históricos si ya tenía ventas/traspasos previos
(ej. `/reporte-ventas`, `/movimientos-producto`) — confirma que esos NO se
tocaron.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/ventas/page.tsx" "app/(dashboard)/traspasos/page.tsx"
git commit -m "fix: excluir productos inactivos de la búsqueda en Ventas y Traspasos"
```

---

## Verificación final del plan

Después de completar las 8 tareas:

1. `npx vitest run` — todos los tests deben pasar (incluye `lib/pricing.test.ts`).
2. `npx tsc --noEmit` — sin errores en todo el repo.
3. Walkthrough manual completo en `/productos`: crear producto (con marca
   nueva), editar producto (cambiar familia a una existente vía
   autocompletar), borrar producto (soft-delete), filtrar por cada columna,
   exportar Excel, paginar.
4. Confirmar que `/ventas` y `/traspasos` no muestran productos
   soft-deleted, y que `/reporte-productos`, `/reporte-ventas`,
   `/movimientos-producto`, `/devoluciones`, `/dashboard`, `/almacen`,
   `/ajuste-inventario`, `/clientes/[id]` siguen funcionando sin cambios
   (no se tocaron en este plan).
