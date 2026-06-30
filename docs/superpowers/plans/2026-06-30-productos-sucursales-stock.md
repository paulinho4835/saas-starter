# Productos + Sucursales + Stock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Productos + Sucursales + Stock module (Fase 1 of the
ventas-retenes upgrade) on top of the existing `saas-starter` core, replacing
the spreadsheet-driven legacy PHP system's product catalog with a proper
relational model, full CRUD UI, and Excel/CSV bulk import.

**Architecture:** Extends the existing Next.js App Router + Supabase
multi-tenant core. New tables (`branches`, `product_brands`,
`product_families`, `product_origins`, `suppliers`, `products`,
`product_stock`) follow the same `org_id` + RLS pattern as `customers`/`items`
in `0001_init.sql`. Server actions follow the existing `clientes`/`ajustes`
pattern: zod validation, `lib/rbac.ts` permission checks, `org_id` always
sourced from the authenticated profile. Price calculation and bulk-import
parsing are pure functions in `lib/`, unit-tested with Vitest.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (Postgres +
RLS), TypeScript, Zod, Tailwind, Vitest, `xlsx` (SheetJS) for spreadsheet
parsing.

## Global Constraints

- Spanish UI copy, no "voseo" ("crea", not "creá"; "puedes", not "podés").
- Every new table: `org_id uuid not null references organizations(id) on
  delete cascade` + RLS policies comparing against `auth_org_id()` — copy the
  exact pattern from `supabase/migrations/0001_init.sql`.
- Every server action: validate with Zod, check `can(profile.role, ...)`
  from `lib/rbac.ts` before touching the DB, take `org_id` from
  `getProfile()` — never trust a client-supplied `org_id`.
- Reuse existing UI primitives (`Button`, `Field`, `Modal`, `Card`,
  `PageHeader`, `EmptyState`, `fieldInputClass`) — do not introduce new
  styling primitives.
- Price formula (from the design spec): `costo_bs = costo_usd *
  tipo_cambio`; `precio_nivel_bs = round(costo_bs * (1 + %nivel/100), 2)` for
  each of SF/CF/MAY.
- Bulk-import match key: `(org_id, code, brand_id)`. Missing
  marca/familia during import are auto-created. STOCK from the import
  **replaces** (not adds to) the branch's existing quantity.
- Spec: `docs/superpowers/specs/2026-06-30-productos-sucursales-stock-design.md`

---

## Task 1: Database schema — Productos, Sucursales, Stock, catálogos

**Files:**
- Create: `supabase/migrations/0002_productos.sql`

**Interfaces:**
- Consumes: `organizations(id)`, `auth_org_id()` from `0001_init.sql`.
- Produces: tables `branches`, `product_brands`, `product_families`,
  `product_origins`, `suppliers`, `products`, `product_stock` — columns as
  below, all referenced by table/column name in later tasks.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Fase 1: Productos + Sucursales + Stock.
-- Ver docs/superpowers/specs/2026-06-30-productos-sucursales-stock-design.md
-- ============================================================================

-- ── Sucursales ───────────────────────────────────────────────────────────
create table branches (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index branches_org_name_idx on branches (org_id, lower(name));

-- ── Marcas ───────────────────────────────────────────────────────────────
create table product_brands (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index product_brands_org_name_idx on product_brands (org_id, lower(name));

-- ── Familias ─────────────────────────────────────────────────────────────
create table product_families (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index product_families_org_name_idx on product_families (org_id, lower(name));

-- ── Procedencias ─────────────────────────────────────────────────────────
create table product_origins (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index product_origins_org_name_idx on product_origins (org_id, lower(name));

-- ── Proveedores ──────────────────────────────────────────────────────────
create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations (id) on delete cascade,
  name         text not null,
  phone        text,
  contact_name text,
  notes        text,
  created_at   timestamptz not null default now()
);
create unique index suppliers_org_name_idx on suppliers (org_id, lower(name));

-- ── Productos ────────────────────────────────────────────────────────────
create table products (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id) on delete cascade,
  code           text not null,
  brand_id       uuid not null references product_brands (id),
  family_id      uuid not null references product_families (id),
  origin_id      uuid references product_origins (id) on delete set null,
  supplier_id    uuid references suppliers (id) on delete set null,
  internal_mm    numeric,
  external_mm    numeric,
  height_mm      numeric,
  flange_mm      numeric,
  stop_mm        numeric,
  application    text,
  cost_usd       numeric,
  exchange_rate  numeric,
  margin_sf_pct  numeric,
  margin_cf_pct  numeric,
  margin_may_pct numeric,
  price_sf_bs    numeric not null default 0,
  price_cf_bs    numeric not null default 0,
  price_may_bs   numeric not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Llave de coincidencia para alta manual y carga masiva (ver spec).
create unique index products_org_code_brand_idx on products (org_id, code, brand_id);
create index products_org_id_idx on products (org_id);

-- ── Stock por sucursal ───────────────────────────────────────────────────
create table product_stock (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  branch_id  uuid not null references branches (id) on delete cascade,
  quantity   integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (product_id, branch_id)
);
create index product_stock_org_id_idx on product_stock (org_id);

-- ============================================================================
-- RLS — mismo patrón que 0001_init.sql: aislamiento por org_id = auth_org_id().
-- ============================================================================
alter table branches         enable row level security;
alter table product_brands   enable row level security;
alter table product_families enable row level security;
alter table product_origins  enable row level security;
alter table suppliers        enable row level security;
alter table products         enable row level security;
alter table product_stock    enable row level security;

create policy branches_select on branches for select using (org_id = auth_org_id());
create policy branches_insert on branches for insert with check (org_id = auth_org_id());
create policy branches_update on branches for update using (org_id = auth_org_id());
create policy branches_delete on branches for delete using (org_id = auth_org_id());

create policy product_brands_select on product_brands for select using (org_id = auth_org_id());
create policy product_brands_insert on product_brands for insert with check (org_id = auth_org_id());
create policy product_brands_update on product_brands for update using (org_id = auth_org_id());
create policy product_brands_delete on product_brands for delete using (org_id = auth_org_id());

create policy product_families_select on product_families for select using (org_id = auth_org_id());
create policy product_families_insert on product_families for insert with check (org_id = auth_org_id());
create policy product_families_update on product_families for update using (org_id = auth_org_id());
create policy product_families_delete on product_families for delete using (org_id = auth_org_id());

create policy product_origins_select on product_origins for select using (org_id = auth_org_id());
create policy product_origins_insert on product_origins for insert with check (org_id = auth_org_id());
create policy product_origins_update on product_origins for update using (org_id = auth_org_id());
create policy product_origins_delete on product_origins for delete using (org_id = auth_org_id());

create policy suppliers_select on suppliers for select using (org_id = auth_org_id());
create policy suppliers_insert on suppliers for insert with check (org_id = auth_org_id());
create policy suppliers_update on suppliers for update using (org_id = auth_org_id());
create policy suppliers_delete on suppliers for delete using (org_id = auth_org_id());

create policy products_select on products for select using (org_id = auth_org_id());
create policy products_insert on products for insert with check (org_id = auth_org_id());
create policy products_update on products for update using (org_id = auth_org_id());
create policy products_delete on products for delete using (org_id = auth_org_id());

create policy product_stock_select on product_stock for select using (org_id = auth_org_id());
create policy product_stock_insert on product_stock for insert with check (org_id = auth_org_id());
create policy product_stock_update on product_stock for update using (org_id = auth_org_id());
create policy product_stock_delete on product_stock for delete using (org_id = auth_org_id());
```

- [ ] **Step 2: Apply the migration locally and verify**

Run: `npm run db:start` (if not already running), then `npm run db:reset`
Expected: output ends with `Finished supabase db reset` and lists
`0001_init.sql` then `0002_productos.sql` as applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_productos.sql
git commit -m "feat(db): add products, sucursales, stock and catalog tables"
```

---

## Task 2: Price calculation + Vitest setup

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/pricing.ts`
- Create: `lib/pricing.test.ts`

**Interfaces:**
- Produces: `calculatePrices(inputs: PriceInputs): CalculatedPrices` — used
  by `app/(dashboard)/productos/actions.ts` (Task 10) and
  `components/productos/ProductFormModal.tsx` (Task 12).

- [ ] **Step 1: Add the Vitest config (first test file in this repo)**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/pricing.test.ts
import { describe, expect, it } from "vitest";
import { calculatePrices } from "./pricing";

describe("calculatePrices", () => {
  it("converts cost to Bs and applies each level's margin", () => {
    const result = calculatePrices({
      costUsd: 10,
      exchangeRate: 8.1,
      marginSfPct: 20,
      marginCfPct: 30,
      marginMayPct: 10,
    });
    // costoBs = 81
    expect(result.priceSfBs).toBeCloseTo(97.2, 2); // 81 * 1.20
    expect(result.priceCfBs).toBeCloseTo(105.3, 2); // 81 * 1.30
    expect(result.priceMayBs).toBeCloseTo(89.1, 2); // 81 * 1.10
  });

  it("rounds to 2 decimals", () => {
    const result = calculatePrices({
      costUsd: 1,
      exchangeRate: 6.96,
      marginSfPct: 33,
      marginCfPct: 0,
      marginMayPct: 0,
    });
    // costoBs = 6.96, sf = 6.96 * 1.33 = 9.2568 -> 9.26
    expect(result.priceSfBs).toBe(9.26);
  });

  it("returns zero prices when cost is zero", () => {
    const result = calculatePrices({
      costUsd: 0,
      exchangeRate: 8.1,
      marginSfPct: 20,
      marginCfPct: 30,
      marginMayPct: 10,
    });
    expect(result.priceSfBs).toBe(0);
    expect(result.priceCfBs).toBe(0);
    expect(result.priceMayBs).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- lib/pricing.test.ts`
Expected: FAIL — `Cannot find module './pricing'` (or similar).

- [ ] **Step 4: Write the implementation**

```typescript
// lib/pricing.ts
// Cálculo de precios de producto a partir de costo en USD + tipo de cambio +
// margen por nivel (SF/CF/MAY). Función pura: sin acceso a DB ni a React.
export interface PriceInputs {
  costUsd: number;
  exchangeRate: number;
  marginSfPct: number;
  marginCfPct: number;
  marginMayPct: number;
}

export interface CalculatedPrices {
  priceSfBs: number;
  priceCfBs: number;
  priceMayBs: number;
}

function priceForMargin(costBs: number, marginPct: number): number {
  return Math.round(costBs * (1 + marginPct / 100) * 100) / 100;
}

export function calculatePrices(inputs: PriceInputs): CalculatedPrices {
  const costBs = inputs.costUsd * inputs.exchangeRate;
  return {
    priceSfBs: priceForMargin(costBs, inputs.marginSfPct),
    priceCfBs: priceForMargin(costBs, inputs.marginCfPct),
    priceMayBs: priceForMargin(costBs, inputs.marginMayPct),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- lib/pricing.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts lib/pricing.ts lib/pricing.test.ts
git commit -m "feat: add price calculation with Vitest test setup"
```

---

## Task 3: Bulk-import row parser (pure function)

**Files:**
- Create: `lib/productImport.ts`
- Create: `lib/productImport.test.ts`

**Interfaces:**
- Produces: `parseImportRows(matrix: unknown[][]): ParseImportResult`,
  types `ParsedImportRow`, `ParseImportResult` — used by
  `app/(dashboard)/productos/import-actions.ts` (Task 13).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/productImport.test.ts
import { describe, expect, it } from "vitest";
import { parseImportRows } from "./productImport";

const SAMPLE_MATRIX: unknown[][] = [
  ["", "CATALOGO", "DE", "PRODUCTOS"],
  ["FECHA Y HORA", "30-06-2026 18:26:35"],
  [
    "FAMILIA",
    "CODIGO_PRODUCTO",
    "MARCA",
    "STOCK",
    "CF Bs.",
    "SF Bs.",
    "MAY Bs.",
    "MI",
    "ME",
    "ALT",
    "PEST",
    "TOPE",
    "APLICACION",
  ],
  ["RETEN", "ORC54.30", "HI-TEC", "", 11.99, 9.96, 9.19, 0, 0, 0, 0, 0, ""],
  [
    "RETEN",
    "0305-10-155",
    "LOCAL",
    1,
    5.36,
    4.45,
    4.08,
    0,
    0,
    0,
    0,
    0,
    "No-54-* R/VALVULA MAZDA S26 C/UNO",
  ],
  ["ORING", "ORC35.00", "HI-TEC", 13, 11.34, 10.13, 4.05, 0, 0, 0, 0, 0, ""],
];

describe("parseImportRows", () => {
  it("finds the header row even with metadata rows above it", () => {
    const result = parseImportRows(SAMPLE_MATRIX);
    expect(result.headerRowIndex).toBe(2);
    expect(result.rows).toHaveLength(3);
  });

  it("maps every column to the right field", () => {
    const result = parseImportRows(SAMPLE_MATRIX);
    const row = result.rows[1];
    expect(row.family).toBe("RETEN");
    expect(row.code).toBe("0305-10-155");
    expect(row.brand).toBe("LOCAL");
    expect(row.stock).toBe(1);
    expect(row.priceCfBs).toBe(5.36);
    expect(row.priceSfBs).toBe(4.45);
    expect(row.priceMayBs).toBe(4.08);
    expect(row.application).toBe("No-54-* R/VALVULA MAZDA S26 C/UNO");
    expect(row.error).toBeNull();
  });

  it("treats a missing stock as zero, not an error", () => {
    const result = parseImportRows(SAMPLE_MATRIX);
    expect(result.rows[0].stock).toBe(0);
    expect(result.rows[0].error).toBeNull();
  });

  it("flags rows missing required fields", () => {
    const matrix = [...SAMPLE_MATRIX, ["", "ORC99.00", "HI-TEC", 1, 1, 1, 1]];
    const result = parseImportRows(matrix);
    const last = result.rows[result.rows.length - 1];
    expect(last.error).toMatch(/obligatorios/);
  });

  it("flags rows with a non-numeric value in a numeric column", () => {
    const matrix = [
      ...SAMPLE_MATRIX,
      ["RETEN", "ORC99.00", "HI-TEC", "no-numero", 1, 1, 1],
    ];
    const result = parseImportRows(matrix);
    const last = result.rows[result.rows.length - 1];
    expect(last.error).toMatch(/STOCK/);
  });

  it("returns no rows when no recognizable header is found", () => {
    const result = parseImportRows([
      ["foo", "bar"],
      ["baz", "qux"],
    ]);
    expect(result.headerRowIndex).toBeNull();
    expect(result.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/productImport.test.ts`
Expected: FAIL — `Cannot find module './productImport'`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/productImport.ts
// Parseo y validación de archivos de carga masiva de productos (Excel/CSV).
// Función pura sobre una matriz de celdas — no toca el sistema de archivos ni
// la base de datos, así se puede testear con datos de muestra reales.

export interface ParsedImportRow {
  rowNumber: number; // número de fila real en el archivo (1-based)
  family: string;
  code: string;
  brand: string;
  stock: number;
  priceCfBs: number | null;
  priceSfBs: number | null;
  priceMayBs: number | null;
  internalMm: number | null;
  externalMm: number | null;
  heightMm: number | null;
  flangeMm: number | null;
  stopMm: number | null;
  application: string | null;
  error: string | null;
}

export interface ParseImportResult {
  rows: ParsedImportRow[];
  headerRowIndex: number | null;
}

type FieldKey =
  | "family"
  | "code"
  | "brand"
  | "stock"
  | "priceCfBs"
  | "priceSfBs"
  | "priceMayBs"
  | "internalMm"
  | "externalMm"
  | "heightMm"
  | "flangeMm"
  | "stopMm"
  | "application";

const HEADER_TO_FIELD: Record<string, FieldKey> = {
  FAMILIA: "family",
  CODIGOPRODUCTO: "code",
  CODIGO: "code",
  MARCA: "brand",
  STOCK: "stock",
  CF: "priceCfBs",
  CFBS: "priceCfBs",
  SF: "priceSfBs",
  SFBS: "priceSfBs",
  MAY: "priceMayBs",
  MAYBS: "priceMayBs",
  MI: "internalMm",
  ME: "externalMm",
  ALT: "heightMm",
  ALTURA: "heightMm",
  PEST: "flangeMm",
  PESTANA: "flangeMm",
  TOPE: "stopMm",
  APLICACION: "application",
};

function normalizeHeader(cell: unknown): string {
  return String(cell ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Z0-9]/g, "");
}

function findHeaderRow(
  matrix: unknown[][],
): { index: number; columns: Partial<Record<FieldKey, number>> } | null {
  const maxScan = Math.min(matrix.length, 10);
  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] ?? [];
    const columns: Partial<Record<FieldKey, number>> = {};
    row.forEach((cell, colIndex) => {
      const field = HEADER_TO_FIELD[normalizeHeader(cell)];
      if (field && columns[field] === undefined) columns[field] = colIndex;
    });
    if (
      columns.family !== undefined &&
      columns.code !== undefined &&
      columns.brand !== undefined
    ) {
      return { index: i, columns };
    }
  }
  return null;
}

function toNumberOrNull(cell: unknown): number | null {
  if (cell === null || cell === undefined || cell === "") return null;
  const n =
    typeof cell === "number" ? cell : Number(String(cell).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function toText(cell: unknown): string {
  return String(cell ?? "").trim();
}

export function parseImportRows(matrix: unknown[][]): ParseImportResult {
  const header = findHeaderRow(matrix);
  if (!header) return { rows: [], headerRowIndex: null };

  const rows: ParsedImportRow[] = [];
  for (let i = header.index + 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    const get = (field: FieldKey) =>
      header.columns[field] !== undefined ? raw[header.columns[field]!] : undefined;

    const family = toText(get("family"));
    const code = toText(get("code"));
    const brand = toText(get("brand"));
    const isBlankRow =
      !family &&
      !code &&
      !brand &&
      raw.every((c) => c === undefined || c === null || c === "");
    if (isBlankRow) continue;

    const stockRaw = toNumberOrNull(get("stock"));
    const priceCfBs = toNumberOrNull(get("priceCfBs"));
    const priceSfBs = toNumberOrNull(get("priceSfBs"));
    const priceMayBs = toNumberOrNull(get("priceMayBs"));
    const internalMm = toNumberOrNull(get("internalMm"));
    const externalMm = toNumberOrNull(get("externalMm"));
    const heightMm = toNumberOrNull(get("heightMm"));
    const flangeMm = toNumberOrNull(get("flangeMm"));
    const stopMm = toNumberOrNull(get("stopMm"));

    const numericFields: Array<[string, number | null]> = [
      ["STOCK", stockRaw],
      ["CF", priceCfBs],
      ["SF", priceSfBs],
      ["MAY", priceMayBs],
      ["MI", internalMm],
      ["ME", externalMm],
      ["ALT", heightMm],
      ["PEST", flangeMm],
      ["TOPE", stopMm],
    ];
    const invalidField = numericFields.find(([, v]) => Number.isNaN(v));

    let error: string | null = null;
    if (!family || !code || !brand) {
      error = "Faltan datos obligatorios (familia, código o marca).";
    } else if (invalidField) {
      error = `Valor numérico inválido en la columna ${invalidField[0]}.`;
    }

    rows.push({
      rowNumber: i + 1,
      family,
      code,
      brand,
      stock: stockRaw ?? 0,
      priceCfBs: Number.isNaN(priceCfBs) ? null : priceCfBs,
      priceSfBs: Number.isNaN(priceSfBs) ? null : priceSfBs,
      priceMayBs: Number.isNaN(priceMayBs) ? null : priceMayBs,
      internalMm: Number.isNaN(internalMm) ? null : internalMm,
      externalMm: Number.isNaN(externalMm) ? null : externalMm,
      heightMm: Number.isNaN(heightMm) ? null : heightMm,
      flangeMm: Number.isNaN(flangeMm) ? null : flangeMm,
      stopMm: Number.isNaN(stopMm) ? null : stopMm,
      application: toText(get("application")) || null,
      error,
    });
  }

  return { rows, headerRowIndex: header.index };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/productImport.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/productImport.ts lib/productImport.test.ts
git commit -m "feat: add bulk-import row parser with header auto-detection"
```

---

## Task 4: Generic simple-catalog helpers

**Files:**
- Create: `lib/catalogs.ts`

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/server.ts`.
- Produces: `catalogNameSchema` (Zod), `SimpleCatalogTable` type,
  `CatalogActionResult` type, `insertCatalogEntry(table, orgId, name)`,
  `deleteCatalogEntry(table, id)` — used by `app/(dashboard)/ajustes/actions.ts`
  (Task 8) and `app/(dashboard)/productos/actions.ts` (Task 10).

- [ ] **Step 1: Write the helpers**

```typescript
// lib/catalogs.ts
// Helpers genéricos para los catálogos "nombre + org_id" (sucursales, marcas,
// familias, procedencias). Reutilizados por varios módulos para no repetir el
// mismo insert/delete cuatro veces.
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const catalogNameSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
});

export type SimpleCatalogTable =
  | "branches"
  | "product_brands"
  | "product_families"
  | "product_origins";

export type CatalogActionResult = { ok: true } | { ok: false; error: string };

export async function insertCatalogEntry(
  table: SimpleCatalogTable,
  orgId: string,
  name: string,
): Promise<CatalogActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert({ org_id: orgId, name });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Ya existe un registro con ese nombre." };
    }
    console.error(`insertCatalogEntry(${table}):`, error.message);
    return { ok: false, error: "No se pudo crear el registro." };
  }
  return { ok: true };
}

export async function deleteCatalogEntry(
  table: SimpleCatalogTable,
  id: string,
): Promise<CatalogActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.error(`deleteCatalogEntry(${table}):`, error.message);
    return {
      ok: false,
      error: "No se pudo eliminar. Verifica que no esté en uso por ningún producto.",
    };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/catalogs.ts
git commit -m "feat: add generic simple-catalog insert/delete helpers"
```

---

## Task 5: Extend RBAC and feature flags

**Files:**
- Modify: `lib/rbac.ts` (full replacement below)
- Modify: `lib/features.ts` (full replacement below)

**Interfaces:**
- Produces: `FeatureKey` now includes `"productos"` and `"proveedores"`.
  `Permission` now includes `"productos:read"`, `"productos:write"`,
  `"productos:delete"`, `"productos:import"`, `"catalogos:write"`,
  `"sucursales:write"`, `"proveedores:read"`, `"proveedores:write"`. Used by
  every server action and page in Tasks 8–16.

- [ ] **Step 1: Replace `lib/rbac.ts`**

```typescript
// lib/rbac.ts
import type { FeatureKey } from "@/lib/features";

// Permisos por rol (espejo de las políticas RLS — la DB es la fuente de verdad).
export type Role = "admin" | "manager" | "member" | "viewer";

// Módulos del menú lateral visibles por rol.
const NAV_WHITELIST: Record<Role, FeatureKey[]> = {
  admin: [
    "dashboard",
    "clientes",
    "items",
    "productos",
    "proveedores",
    "ajustes",
    "auditoria",
  ],
  manager: ["dashboard", "clientes", "items", "productos", "proveedores"],
  member: ["dashboard", "clientes", "productos", "proveedores"],
  viewer: ["dashboard", "clientes", "productos", "proveedores"],
};

export function canSeeNav(role: Role | undefined, key: FeatureKey): boolean {
  if (!role) return false;
  return NAV_WHITELIST[role]?.includes(key) ?? false;
}

type Permission =
  | "clientes:read"
  | "clientes:write"
  | "clientes:delete"
  | "items:write"
  | "settings:write"
  | "productos:read"
  | "productos:write"
  | "productos:delete"
  | "productos:import"
  | "catalogos:write"
  | "sucursales:write"
  | "proveedores:read"
  | "proveedores:write";

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    "clientes:read",
    "clientes:write",
    "clientes:delete",
    "items:write",
    "settings:write",
    "productos:read",
    "productos:write",
    "productos:delete",
    "productos:import",
    "catalogos:write",
    "sucursales:write",
    "proveedores:read",
    "proveedores:write",
  ],
  manager: [
    "clientes:read",
    "clientes:write",
    "items:write",
    "productos:read",
    "productos:write",
    "productos:import",
    "catalogos:write",
    "proveedores:read",
    "proveedores:write",
  ],
  member: ["clientes:read", "clientes:write", "productos:read", "proveedores:read"],
  viewer: ["clientes:read", "productos:read", "proveedores:read"],
};

export function can(role: Role | undefined, perm: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(perm) ?? false;
}
```

- [ ] **Step 2: Replace `lib/features.ts`**

```typescript
// lib/features.ts
// Catálogo de módulos toggleables por organización (feature flags / addons).

export type FeatureKey =
  | "dashboard"
  | "clientes"
  | "items"
  | "productos"
  | "proveedores"
  | "ajustes"
  | "auditoria";

export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  href: string;
  /** Núcleo: no se puede apagar desde el panel (dejaría la cuenta inoperable). */
  core?: boolean;
  /** Opt-in: apagado por defecto salvo que se habilite explícitamente. */
  optIn?: boolean;
}

// Orden = orden en el menú lateral.
export const FEATURES: FeatureMeta[] = [
  { key: "dashboard", label: "Inicio", href: "/dashboard", core: true },
  { key: "clientes", label: "Clientes", href: "/clientes" },
  { key: "items", label: "Inventario", href: "/items", optIn: true },
  { key: "productos", label: "Productos", href: "/productos", optIn: true },
  { key: "proveedores", label: "Proveedores", href: "/proveedores", optIn: true },
  { key: "ajustes", label: "Ajustes", href: "/ajustes", core: true },
  { key: "auditoria", label: "Auditoría", href: "/auditoria", optIn: true },
];

export type Features = Record<FeatureKey, boolean>;

export function normalizeFeatures(raw: unknown): Features {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Features;
  for (const f of FEATURES) {
    if (f.core) {
      out[f.key] = true;
    } else if (f.optIn) {
      out[f.key] = obj[f.key] === true;
    } else {
      out[f.key] = obj[f.key] !== false;
    }
  }
  return out;
}

export function isEnabled(features: Features, key: FeatureKey): boolean {
  return features[key];
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/rbac.ts lib/features.ts
git commit -m "feat: add productos/proveedores permissions and feature flags"
```

---

## Task 6: Sidebar icons for the new modules

**Files:**
- Modify: `components/Sidebar.tsx`

**Interfaces:**
- Consumes: `FeatureKey` "productos"/"proveedores" (Task 5).

- [ ] **Step 1: Add icon imports and map entries**

In `components/Sidebar.tsx`, replace the icon import block:

```typescript
import {
  Home,
  Users,
  Package,
  Settings,
  ShieldCheck,
  Shield,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
```

with:

```typescript
import {
  Home,
  Users,
  Package,
  Settings,
  ShieldCheck,
  Shield,
  Wrench,
  Truck,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
```

and replace the `ICONS` map:

```typescript
const ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/clientes": Users,
  "/items": Package,
  "/ajustes": Settings,
  "/auditoria": ShieldCheck,
};
```

with:

```typescript
const ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/clientes": Users,
  "/items": Package,
  "/productos": Wrench,
  "/proveedores": Truck,
  "/ajustes": Settings,
  "/auditoria": ShieldCheck,
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/Sidebar.tsx
git commit -m "feat: add sidebar icons for productos and proveedores"
```

---

## Task 7: Reusable `SimpleCatalogManager` component

**Files:**
- Create: `components/ui/SimpleCatalogManager.tsx`

**Interfaces:**
- Consumes: `Button`, `Field`, `Card`, `EmptyState` from `components/ui/*`,
  `toast` from `lib/toast`, `confirm` from `lib/confirm`,
  `CatalogActionResult` shape from `lib/catalogs.ts` (Task 4) — structurally
  `{ ok: boolean; error?: string }`.
- Produces: `<SimpleCatalogManager itemLabel canWrite items onCreate
  onDelete emptyLabel />` — used by `app/(dashboard)/ajustes/page.tsx`
  (Task 8) and `app/(dashboard)/productos/page.tsx` (Task 15) for
  sucursales/marcas/familias/procedencias.

- [ ] **Step 1: Write the component**

```tsx
// components/ui/SimpleCatalogManager.tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/lib/toast";
import { confirm } from "@/lib/confirm";

export type CatalogItem = { id: string; name: string };
type CatalogResult = { ok: boolean; error?: string };

// Lista + alta + borrado para catálogos simples de "nombre" (sucursales,
// marcas, familias, procedencias). Las server actions se reciben por props
// para que este componente no conozca la tabla concreta.
export function SimpleCatalogManager({
  itemLabel,
  emptyLabel,
  items,
  canWrite,
  onCreate,
  onDelete,
}: {
  /** Nombre singular del tipo de registro, ej. "sucursal", "marca". */
  itemLabel: string;
  emptyLabel: string;
  items: CatalogItem[];
  canWrite: boolean;
  onCreate: (formData: FormData) => Promise<CatalogResult>;
  onDelete: (id: string) => Promise<CatalogResult>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const res = await onCreate(new FormData(form));
    if (!res.ok) {
      toast(res.error ?? "No se pudo crear.", "error");
      return;
    }
    form.reset();
    toast(`${itemLabel[0].toUpperCase()}${itemLabel.slice(1)} creada.`);
    router.refresh();
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Eliminar ${name}`,
      message: `¿Eliminar "${name}"? Esta acción no se puede deshacer.`,
      tone: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await onDelete(id);
      if (!res.ok) {
        toast(res.error ?? "No se pudo eliminar.", "error");
        return;
      }
      toast("Eliminado.");
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4 p-4">
      {canWrite && (
        <form onSubmit={handleCreate} className="flex items-end gap-2">
          <Field
            label={`Nueva ${itemLabel}`}
            name="name"
            required
            className="flex-1"
          />
          <Button type="submit">Agregar</Button>
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <ul className="divide-y divide-slate-200">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="text-sm text-slate-800">{item.name}</span>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => handleDelete(item.id, item.name)}
                  disabled={pending}
                  aria-label={`Eliminar ${item.name}`}
                  className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/SimpleCatalogManager.tsx
git commit -m "feat: add reusable SimpleCatalogManager component"
```

---

## Task 8: Sucursales panel in Ajustes

**Files:**
- Modify: `app/(dashboard)/ajustes/actions.ts`
- Modify: `app/(dashboard)/ajustes/page.tsx`

**Interfaces:**
- Consumes: `insertCatalogEntry`, `deleteCatalogEntry`, `catalogNameSchema`
  from `lib/catalogs.ts` (Task 4); `SimpleCatalogManager` (Task 7); `can`
  from `lib/rbac.ts` (Task 5).
- Produces: `createBranch(formData): Promise<ActionResult>`,
  `deleteBranch(id): Promise<ActionResult>` — used only within this page for
  now (Ventas/Traspasos in later phases will read from `branches` directly).

- [ ] **Step 1: Add branch actions to `app/(dashboard)/ajustes/actions.ts`**

Add these imports at the top (alongside the existing ones):

```typescript
import { insertCatalogEntry, deleteCatalogEntry, catalogNameSchema } from "@/lib/catalogs";
import { can } from "@/lib/rbac";
```

Append at the end of the file:

```typescript
// Crea una sucursal de la organización.
export async function createBranch(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "sucursales:write")) {
    return { ok: false, error: "No tienes permiso para crear sucursales." };
  }
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("branches", profile.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/ajustes");
  return { ok: true };
}

// Elimina una sucursal de la organización.
export async function deleteBranch(id: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "sucursales:write")) {
    return { ok: false, error: "No tienes permiso para eliminar sucursales." };
  }
  const res = await deleteCatalogEntry("branches", id);
  if (!res.ok) return res;
  revalidatePath("/ajustes");
  return { ok: true };
}
```

- [ ] **Step 2: Replace `app/(dashboard)/ajustes/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/PageHeader";
import { TeamPanel, type TeamMember } from "@/components/ajustes/TeamPanel";
import { SimpleCatalogManager } from "@/components/ui/SimpleCatalogManager";
import { createBranch, deleteBranch } from "@/app/(dashboard)/ajustes/actions";

// Ajustes de la organización: equipo + sucursales (solo admin).
export default async function AjustesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: membersData }, { data: branchesData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, active")
      .eq("org_id", profile.orgId)
      .order("full_name"),
    supabase.from("branches").select("id, name").order("name"),
  ]);
  const members = (membersData ?? []) as TeamMember[];
  const branches = (branchesData ?? []) as { id: string; name: string }[];

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" subtitle="Equipo de la organización" />
      <TeamPanel members={members} currentUserId={profile.userId} />

      <div>
        <h2 className="mb-3 font-semibold text-slate-800">Sucursales</h2>
        <SimpleCatalogManager
          itemLabel="sucursal"
          emptyLabel="Aún no hay sucursales"
          items={branches}
          canWrite={can(profile.role, "sucursales:write")}
          onCreate={createBranch}
          onDelete={deleteBranch}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual check**

Run: `npm run dev`, log in as admin, go to `/ajustes`, add a sucursal (e.g.
"Central Taquina"), confirm it appears in the list, delete it, confirm it
disappears.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/ajustes/actions.ts app/\(dashboard\)/ajustes/page.tsx
git commit -m "feat: manage sucursales from Ajustes"
```

---

## Task 9: Proveedores module

**Files:**
- Create: `app/(dashboard)/proveedores/actions.ts`
- Create: `app/(dashboard)/proveedores/page.tsx`
- Create: `components/proveedores/NewSupplierForm.tsx`
- Create: `components/proveedores/DeleteSupplierButton.tsx`

**Interfaces:**
- Consumes: `can` from `lib/rbac.ts` (Task 5), `requireNavAccess` from
  `lib/guard.ts`, `suppliers` table (Task 1).
- Produces: `createSupplier`, `deleteSupplier` server actions — `suppliers`
  rows (`id, name`) consumed by `app/(dashboard)/productos/page.tsx`
  (Task 15) for the product form's "Proveedor" dropdown.

- [ ] **Step 1: Write `app/(dashboard)/proveedores/actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";

const supplierSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  contact_name: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type ActionResult = { ok: boolean; error?: string };

export async function createSupplier(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "proveedores:write")) {
    return { ok: false, error: "No tienes permiso para crear proveedores." };
  }

  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    contact_name: formData.get("contact_name"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({
    org_id: profile.orgId,
    name: parsed.data.name,
    phone: parsed.data.phone || null,
    contact_name: parsed.data.contact_name || null,
    notes: parsed.data.notes || null,
  });
  if (error) {
    console.error("createSupplier:", error.message);
    if (error.code === "23505") {
      return { ok: false, error: "Ya existe un proveedor con ese nombre." };
    }
    return { ok: false, error: "No se pudo crear el proveedor." };
  }

  revalidatePath("/proveedores");
  return { ok: true };
}

export async function deleteSupplier(id: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "proveedores:write")) {
    return { ok: false, error: "No tienes permiso para eliminar proveedores." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) {
    console.error("deleteSupplier:", error.message);
    return { ok: false, error: "No se pudo eliminar el proveedor." };
  }

  revalidatePath("/proveedores");
  return { ok: true };
}
```

- [ ] **Step 2: Write `components/proveedores/NewSupplierForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { createSupplier } from "@/app/(dashboard)/proveedores/actions";

export function NewSupplierForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const res = await createSupplier(new FormData(e.currentTarget));
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo crear el proveedor.", "error");
      return;
    }
    toast("Proveedor creado.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Nuevo proveedor</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo proveedor">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Nombre" name="name" required />
          <Field label="Teléfono" name="phone" />
          <Field label="Persona de contacto" name="contact_name" />
          <Field label="Notas" name="notes" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 3: Write `components/proveedores/DeleteSupplierButton.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { confirm } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { deleteSupplier } from "@/app/(dashboard)/proveedores/actions";

export function DeleteSupplierButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function onClick() {
    const ok = await confirm({
      title: "Eliminar proveedor",
      message: `¿Eliminar a ${name}? Esta acción no se puede deshacer.`,
      tone: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteSupplier(id);
      if (!res.ok) {
        toast(res.error ?? "No se pudo eliminar.", "error");
        return;
      }
      toast("Proveedor eliminado.");
      router.refresh();
    });
  }

  return (
    <button
      onClick={onClick}
      disabled={pending}
      aria-label={`Eliminar ${name}`}
      className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
```

- [ ] **Step 4: Write `app/(dashboard)/proveedores/page.tsx`**

```tsx
import { Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewSupplierForm } from "@/components/proveedores/NewSupplierForm";
import { DeleteSupplierButton } from "@/components/proveedores/DeleteSupplierButton";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  contact_name: string | null;
  notes: string | null;
};

export default async function ProveedoresPage() {
  await requireNavAccess("proveedores");

  const supabase = await createClient();
  const profile = await getProfile();

  const { data } = await supabase
    .from("suppliers")
    .select("id, name, phone, contact_name, notes")
    .order("name");
  const suppliers = (data ?? []) as Supplier[];

  const canWrite = can(profile?.role, "proveedores:write");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores"
        subtitle={`${suppliers.length} registrados`}
        action={canWrite ? <NewSupplierForm /> : null}
      />

      <Card>
        {suppliers.length === 0 ? (
          <EmptyState
            icon={<Truck className="h-6 w-6" />}
            title="Aún no hay proveedores"
            description="Crea el primer proveedor para empezar."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {suppliers.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{s.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[s.contact_name, s.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {canWrite && <DeleteSupplierButton id={s.id} name={s.name} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual check**

Enable the `proveedores` feature for your dev org (it's `optIn`):

Run: `npm run dev` is not required for this — instead, in the Supabase SQL
editor (or `supabase db reset` via seed) run:
```sql
update organizations set features = features || '{"productos": true, "proveedores": true}'::jsonb;
```
Then with `npm run dev`, log in, confirm "Proveedores" appears in the
sidebar, create one, confirm it lists, delete it.

- [ ] **Step 7: Commit**

```bash
git add app/\(dashboard\)/proveedores components/proveedores
git commit -m "feat: add proveedores CRUD module"
```

---

## Task 10: Product + catalog server actions

**Files:**
- Create: `app/(dashboard)/productos/actions.ts`

**Interfaces:**
- Consumes: `calculatePrices` (Task 2), `insertCatalogEntry`/
  `deleteCatalogEntry`/`catalogNameSchema` (Task 4), `can` (Task 5).
- Produces: `createBrand`, `deleteBrand`, `createFamily`, `deleteFamily`,
  `createOrigin`, `deleteOrigin`, `createProduct(formData):
  Promise<ActionResult>`, `updateProduct(id, formData):
  Promise<ActionResult>`, `deleteProduct(id): Promise<ActionResult>`,
  `updateProductStock(productId, branchId, quantity):
  Promise<ActionResult>` — used by `components/productos/ProductFormModal.tsx`
  (Task 12), `DeleteProductButton.tsx` (Task 11), and
  `app/(dashboard)/productos/page.tsx` (Task 15).

- [ ] **Step 1: Write the file**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { calculatePrices } from "@/lib/pricing";
import {
  insertCatalogEntry,
  deleteCatalogEntry,
  catalogNameSchema,
} from "@/lib/catalogs";

export type ActionResult = { ok: boolean; error?: string };

// ── Catálogos (marcas, familias, procedencias) ──────────────────────────────
async function requireCatalogWrite(): Promise<
  { ok: true; orgId: string } | { ok: false; error: string }
> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "catalogos:write")) {
    return { ok: false, error: "No tienes permiso para editar catálogos." };
  }
  return { ok: true, orgId: profile.orgId };
}

export async function createBrand(formData: FormData): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("product_brands", guard.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function deleteBrand(id: string): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const res = await deleteCatalogEntry("product_brands", id);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function createFamily(formData: FormData): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("product_families", guard.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function deleteFamily(id: string): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const res = await deleteCatalogEntry("product_families", id);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function createOrigin(formData: FormData): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("product_origins", guard.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function deleteOrigin(id: string): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const res = await deleteCatalogEntry("product_origins", id);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

// ── Productos ────────────────────────────────────────────────────────────
const productSchema = z.object({
  code: z.string().trim().min(1, "El código es obligatorio.").max(80),
  brand_id: z.string().uuid("Selecciona una marca."),
  family_id: z.string().uuid("Selecciona una familia."),
  origin_id: z.string().uuid().optional().or(z.literal("")),
  supplier_id: z.string().uuid().optional().or(z.literal("")),
  internal_mm: z.coerce.number().optional(),
  external_mm: z.coerce.number().optional(),
  height_mm: z.coerce.number().optional(),
  flange_mm: z.coerce.number().optional(),
  stop_mm: z.coerce.number().optional(),
  application: z.string().trim().max(500).optional().or(z.literal("")),
  cost_usd: z.coerce.number().min(0, "El costo no puede ser negativo."),
  exchange_rate: z.coerce.number().positive("El tipo de cambio debe ser mayor a 0."),
  margin_sf_pct: z.coerce.number(),
  margin_cf_pct: z.coerce.number(),
  margin_may_pct: z.coerce.number(),
});

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    code: formData.get("code"),
    brand_id: formData.get("brand_id"),
    family_id: formData.get("family_id"),
    origin_id: formData.get("origin_id"),
    supplier_id: formData.get("supplier_id"),
    internal_mm: formData.get("internal_mm") || undefined,
    external_mm: formData.get("external_mm") || undefined,
    height_mm: formData.get("height_mm") || undefined,
    flange_mm: formData.get("flange_mm") || undefined,
    stop_mm: formData.get("stop_mm") || undefined,
    application: formData.get("application"),
    cost_usd: formData.get("cost_usd"),
    exchange_rate: formData.get("exchange_rate"),
    margin_sf_pct: formData.get("margin_sf_pct"),
    margin_cf_pct: formData.get("margin_cf_pct"),
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

  const prices = calculatePrices({
    costUsd: parsed.data.cost_usd,
    exchangeRate: parsed.data.exchange_rate,
    marginSfPct: parsed.data.margin_sf_pct,
    marginCfPct: parsed.data.margin_cf_pct,
    marginMayPct: parsed.data.margin_may_pct,
  });

  const supabase = await createClient();
  const { data: product, error } = await supabase
    .from("products")
    .insert({
      org_id: profile.orgId,
      code: parsed.data.code,
      brand_id: parsed.data.brand_id,
      family_id: parsed.data.family_id,
      origin_id: parsed.data.origin_id || null,
      supplier_id: parsed.data.supplier_id || null,
      internal_mm: parsed.data.internal_mm ?? null,
      external_mm: parsed.data.external_mm ?? null,
      height_mm: parsed.data.height_mm ?? null,
      flange_mm: parsed.data.flange_mm ?? null,
      stop_mm: parsed.data.stop_mm ?? null,
      application: parsed.data.application || null,
      cost_usd: parsed.data.cost_usd,
      exchange_rate: parsed.data.exchange_rate,
      margin_sf_pct: parsed.data.margin_sf_pct,
      margin_cf_pct: parsed.data.margin_cf_pct,
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
    return { ok: false, error: "El producto se creó, pero no se pudo registrar el stock." };
  }

  revalidatePath("/productos");
  return { ok: true };
}

export async function updateProduct(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para editar productos." };
  }

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const prices = calculatePrices({
    costUsd: parsed.data.cost_usd,
    exchangeRate: parsed.data.exchange_rate,
    marginSfPct: parsed.data.margin_sf_pct,
    marginCfPct: parsed.data.margin_cf_pct,
    marginMayPct: parsed.data.margin_may_pct,
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      code: parsed.data.code,
      brand_id: parsed.data.brand_id,
      family_id: parsed.data.family_id,
      origin_id: parsed.data.origin_id || null,
      supplier_id: parsed.data.supplier_id || null,
      internal_mm: parsed.data.internal_mm ?? null,
      external_mm: parsed.data.external_mm ?? null,
      height_mm: parsed.data.height_mm ?? null,
      flange_mm: parsed.data.flange_mm ?? null,
      stop_mm: parsed.data.stop_mm ?? null,
      application: parsed.data.application || null,
      cost_usd: parsed.data.cost_usd,
      exchange_rate: parsed.data.exchange_rate,
      margin_sf_pct: parsed.data.margin_sf_pct,
      margin_cf_pct: parsed.data.margin_cf_pct,
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
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    console.error("deleteProduct:", error.message);
    return { ok: false, error: "No se pudo eliminar el producto." };
  }

  revalidatePath("/productos");
  return { ok: true };
}

// ── Stock por sucursal ───────────────────────────────────────────────────
export async function updateProductStock(
  productId: string,
  branchId: string,
  quantity: number,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para editar el stock." };
  }
  if (!Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, error: "La cantidad debe ser un número mayor o igual a 0." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("product_stock").upsert(
    {
      org_id: profile.orgId,
      product_id: productId,
      branch_id: branchId,
      quantity,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "product_id,branch_id" },
  );
  if (error) {
    console.error("updateProductStock:", error.message);
    return { ok: false, error: "No se pudo actualizar el stock." };
  }

  revalidatePath("/productos");
  return { ok: true };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/productos/actions.ts
git commit -m "feat: add product, catalog and stock server actions"
```

---

## Task 11: Delete product button

**Files:**
- Create: `components/productos/DeleteProductButton.tsx`

**Interfaces:**
- Consumes: `deleteProduct` from `app/(dashboard)/productos/actions.ts`
  (Task 10).
- Produces: `<DeleteProductButton id code />` — used by
  `app/(dashboard)/productos/page.tsx` (Task 15).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { confirm } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { deleteProduct } from "@/app/(dashboard)/productos/actions";

export function DeleteProductButton({ id, code }: { id: string; code: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function onClick() {
    const ok = await confirm({
      title: "Eliminar producto",
      message: `¿Eliminar el producto "${code}"? Esta acción no se puede deshacer.`,
      tone: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteProduct(id);
      if (!res.ok) {
        toast(res.error ?? "No se pudo eliminar.", "error");
        return;
      }
      toast("Producto eliminado.");
      router.refresh();
    });
  }

  return (
    <button
      onClick={onClick}
      disabled={pending}
      aria-label={`Eliminar ${code}`}
      className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/productos/DeleteProductButton.tsx
git commit -m "feat: add DeleteProductButton"
```

---

## Task 12: Product create/edit form with live price preview and stock

**Files:**
- Create: `components/productos/ProductFormModal.tsx`

**Interfaces:**
- Consumes: `createProduct`, `updateProduct`, `updateProductStock` (Task 10),
  `calculatePrices` (Task 2).
- Produces: `<ProductFormModal mode="create" brands families origins
  suppliers branches />` and `<ProductFormModal mode="edit" product stock
  brands families origins suppliers branches />` — used by
  `app/(dashboard)/productos/page.tsx` (Task 15). `product` shape:
  `{ id, code, brand_id, family_id, origin_id, supplier_id, internal_mm,
  external_mm, height_mm, flange_mm, stop_mm, application, cost_usd,
  exchange_rate, margin_sf_pct, margin_cf_pct, margin_may_pct }`. `stock`
  shape: `{ branch_id, branch_name, quantity }[]`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { calculatePrices } from "@/lib/pricing";
import {
  createProduct,
  updateProduct,
  updateProductStock,
} from "@/app/(dashboard)/productos/actions";

type CatalogOption = { id: string; name: string };

type ProductDetail = {
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
  exchange_rate: number | null;
  margin_sf_pct: number | null;
  margin_cf_pct: number | null;
  margin_may_pct: number | null;
};

type StockRow = { branch_id: string; branch_name: string; quantity: number };

export function ProductFormModal({
  mode,
  product,
  stock,
  brands,
  families,
  origins,
  suppliers,
  branches,
}: {
  mode: "create" | "edit";
  product?: ProductDetail;
  stock?: StockRow[];
  brands: CatalogOption[];
  families: CatalogOption[];
  origins: CatalogOption[];
  suppliers: CatalogOption[];
  branches: CatalogOption[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const [costUsd, setCostUsd] = useState(product?.cost_usd?.toString() ?? "");
  const [exchangeRate, setExchangeRate] = useState(
    product?.exchange_rate?.toString() ?? "",
  );
  const [marginSf, setMarginSf] = useState(product?.margin_sf_pct?.toString() ?? "");
  const [marginCf, setMarginCf] = useState(product?.margin_cf_pct?.toString() ?? "");
  const [marginMay, setMarginMay] = useState(product?.margin_may_pct?.toString() ?? "");

  const preview = useMemo(() => {
    if (
      costUsd === "" ||
      exchangeRate === "" ||
      marginSf === "" ||
      marginCf === "" ||
      marginMay === ""
    ) {
      return null;
    }
    const cost = Number(costUsd);
    const rate = Number(exchangeRate);
    const sf = Number(marginSf);
    const cf = Number(marginCf);
    const may = Number(marginMay);
    if (![cost, rate, sf, cf, may].every((n) => Number.isFinite(n))) return null;
    return calculatePrices({
      costUsd: cost,
      exchangeRate: rate,
      marginSfPct: sf,
      marginCfPct: cf,
      marginMayPct: may,
    });
  }, [costUsd, exchangeRate, marginSf, marginCf, marginMay]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const res =
      mode === "create"
        ? await createProduct(formData)
        : await updateProduct(product!.id, formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo guardar el producto.", "error");
      return;
    }
    toast(mode === "create" ? "Producto creado." : "Producto actualizado.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant={mode === "create" ? "primary" : "secondary"}
        size={mode === "create" ? "md" : "sm"}
        onClick={() => setOpen(true)}
      >
        {mode === "create" ? "Nuevo producto" : "Editar"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={mode === "create" ? "Nuevo producto" : `Editar ${product?.code}`}
        size="xl"
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Código" name="code" required defaultValue={product?.code} />
            <label className="block text-sm">
              <FieldLabel>Marca</FieldLabel>
              <select
                name="brand_id"
                required
                defaultValue={product?.brand_id ?? ""}
                className={fieldInputClass}
              >
                <option value="" disabled>
                  Selecciona…
                </option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <FieldLabel>Familia</FieldLabel>
              <select
                name="family_id"
                required
                defaultValue={product?.family_id ?? ""}
                className={fieldInputClass}
              >
                <option value="" disabled>
                  Selecciona…
                </option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Interno (mm)" name="internal_mm" type="number" step="0.01" defaultValue={product?.internal_mm ?? ""} />
            <Field label="Externo (mm)" name="external_mm" type="number" step="0.01" defaultValue={product?.external_mm ?? ""} />
            <Field label="Altura (mm)" name="height_mm" type="number" step="0.01" defaultValue={product?.height_mm ?? ""} />
            <Field label="Pestaña (mm)" name="flange_mm" type="number" step="0.01" defaultValue={product?.flange_mm ?? ""} />
            <Field label="Tope (mm)" name="stop_mm" type="number" step="0.01" defaultValue={product?.stop_mm ?? ""} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <FieldLabel>Procedencia</FieldLabel>
              <select
                name="origin_id"
                defaultValue={product?.origin_id ?? ""}
                className={fieldInputClass}
              >
                <option value="">—</option>
                {origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <FieldLabel>Proveedor</FieldLabel>
              <select
                name="supplier_id"
                defaultValue={product?.supplier_id ?? ""}
                className={fieldInputClass}
              >
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
              defaultValue={product?.application ?? ""}
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
            <Field
              label="T. Cambio"
              name="exchange_rate"
              type="number"
              step="0.01"
              required
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
            />
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
              label="CF %"
              name="margin_cf_pct"
              type="number"
              step="0.01"
              required
              value={marginCf}
              onChange={(e) => setMarginCf(e.target.value)}
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
              Precios calculados — SF: {preview.priceSfBs} Bs · CF: {preview.priceCfBs} Bs
              · MAY: {preview.priceMayBs} Bs
            </p>
          )}

          {mode === "create" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <FieldLabel>Sucursal (stock inicial)</FieldLabel>
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

        {mode === "edit" && product && stock && (
          <StockSection productId={product.id} stock={stock} />
        )}
      </Modal>
    </>
  );
}

function StockSection({
  productId,
  stock,
}: {
  productId: string;
  stock: StockRow[];
}) {
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
              onChange={(e) =>
                setValues((v) => ({ ...v, [s.branch_id]: e.target.value }))
              }
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

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/productos/ProductFormModal.tsx
git commit -m "feat: add ProductFormModal with live price preview and stock editor"
```

---

## Task 13: Bulk-import server actions

**Files:**
- Create: `app/(dashboard)/productos/import-actions.ts`
- Modify: `package.json` (add `xlsx` dependency)

**Interfaces:**
- Consumes: `parseImportRows`, `ParsedImportRow` from `lib/productImport.ts`
  (Task 3), `can` (Task 5).
- Produces: `ImportRowPreview` type (`ParsedImportRow & { status: "create" |
  "update" | "error" }`), `previewProductImport(formData):
  Promise<ImportPreviewResult>`, `confirmProductImport(branchId, rows):
  Promise<ConfirmImportResult>` — used by
  `components/productos/ImportProductsDialog.tsx` (Task 14).

- [ ] **Step 1: Install the spreadsheet parser**

Run: `npm install xlsx@^0.18.5`
Expected: `package.json` and `package-lock.json` updated, no install errors.

- [ ] **Step 2: Write the file**

```typescript
"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { parseImportRows, type ParsedImportRow } from "@/lib/productImport";

export type ImportRowPreview = ParsedImportRow & {
  status: "create" | "update" | "error";
};

export type ImportPreviewResult =
  | {
      ok: true;
      rows: ImportRowPreview[];
      toCreate: number;
      toUpdate: number;
      withErrors: number;
    }
  | { ok: false; error: string };

async function fileToMatrix(file: File): Promise<unknown[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
}

export async function previewProductImport(
  formData: FormData,
): Promise<ImportPreviewResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:import")) {
    return { ok: false, error: "No tienes permiso para importar productos." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Selecciona un archivo." };
  }

  let matrix: unknown[][];
  try {
    matrix = await fileToMatrix(file);
  } catch {
    return { ok: false, error: "No se pudo leer el archivo. Verifica el formato." };
  }

  const { rows, headerRowIndex } = parseImportRows(matrix);
  if (headerRowIndex === null) {
    return {
      ok: false,
      error:
        "No se encontraron las columnas esperadas (FAMILIA, CODIGO_PRODUCTO, MARCA).",
    };
  }
  if (rows.length === 0) {
    return { ok: false, error: "El archivo no tiene filas de datos." };
  }

  const supabase = await createClient();
  const codes = [...new Set(rows.filter((r) => !r.error).map((r) => r.code))];

  const { data: existingProducts } =
    codes.length > 0
      ? await supabase
          .from("products")
          .select("code, product_brands(name)")
          .in("code", codes)
      : { data: [] as { code: string; product_brands: { name: string } | null }[] };

  const existingKeys = new Set(
    (existingProducts ?? []).map(
      (p) => `${p.code}::${p.product_brands?.name?.toLowerCase() ?? ""}`,
    ),
  );

  const preview: ImportRowPreview[] = rows.map((row) => {
    if (row.error) return { ...row, status: "error" };
    const key = `${row.code}::${row.brand.toLowerCase()}`;
    return { ...row, status: existingKeys.has(key) ? "update" : "create" };
  });

  return {
    ok: true,
    rows: preview,
    toCreate: preview.filter((r) => r.status === "create").length,
    toUpdate: preview.filter((r) => r.status === "update").length,
    withErrors: preview.filter((r) => r.status === "error").length,
  };
}

export type ConfirmImportResult =
  | { ok: true; imported: number }
  | { ok: false; error: string };

export async function confirmProductImport(
  branchId: string,
  rows: ImportRowPreview[],
): Promise<ConfirmImportResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:import")) {
    return { ok: false, error: "No tienes permiso para importar productos." };
  }
  if (!branchId) return { ok: false, error: "Selecciona una sucursal." };

  const validRows = rows.filter((r) => r.status !== "error");
  if (validRows.length === 0) {
    return { ok: false, error: "No hay filas válidas para importar." };
  }

  const supabase = await createClient();
  const orgId = profile.orgId;

  // 1) Autocrear marcas y familias que falten.
  const familyNames = [...new Set(validRows.map((r) => r.family))];
  const brandNames = [...new Set(validRows.map((r) => r.brand))];

  const [{ data: existingFamilies }, { data: existingBrands }] = await Promise.all([
    supabase.from("product_families").select("id, name").eq("org_id", orgId),
    supabase.from("product_brands").select("id, name").eq("org_id", orgId),
  ]);

  const familyIdByName = new Map(
    (existingFamilies ?? []).map((f) => [f.name.toLowerCase(), f.id]),
  );
  const brandIdByName = new Map(
    (existingBrands ?? []).map((b) => [b.name.toLowerCase(), b.id]),
  );

  const missingFamilies = familyNames.filter((n) => !familyIdByName.has(n.toLowerCase()));
  if (missingFamilies.length > 0) {
    const { data: inserted, error } = await supabase
      .from("product_families")
      .insert(missingFamilies.map((name) => ({ org_id: orgId, name })))
      .select("id, name");
    if (error) {
      console.error("confirmProductImport familias:", error.message);
      return { ok: false, error: "No se pudieron crear las familias nuevas." };
    }
    for (const f of inserted ?? []) familyIdByName.set(f.name.toLowerCase(), f.id);
  }

  const missingBrands = brandNames.filter((n) => !brandIdByName.has(n.toLowerCase()));
  if (missingBrands.length > 0) {
    const { data: inserted, error } = await supabase
      .from("product_brands")
      .insert(missingBrands.map((name) => ({ org_id: orgId, name })))
      .select("id, name");
    if (error) {
      console.error("confirmProductImport marcas:", error.message);
      return { ok: false, error: "No se pudieron crear las marcas nuevas." };
    }
    for (const b of inserted ?? []) brandIdByName.set(b.name.toLowerCase(), b.id);
  }

  // 2) Upsert de productos por (org_id, code, brand_id).
  const productsPayload = validRows.map((r) => ({
    org_id: orgId,
    code: r.code,
    brand_id: brandIdByName.get(r.brand.toLowerCase())!,
    family_id: familyIdByName.get(r.family.toLowerCase())!,
    internal_mm: r.internalMm,
    external_mm: r.externalMm,
    height_mm: r.heightMm,
    flange_mm: r.flangeMm,
    stop_mm: r.stopMm,
    application: r.application,
    price_cf_bs: r.priceCfBs ?? 0,
    price_sf_bs: r.priceSfBs ?? 0,
    price_may_bs: r.priceMayBs ?? 0,
    updated_at: new Date().toISOString(),
  }));

  const { data: upsertedProducts, error: productsError } = await supabase
    .from("products")
    .upsert(productsPayload, { onConflict: "org_id,code,brand_id" })
    .select("id, code, brand_id");
  if (productsError) {
    console.error("confirmProductImport productos:", productsError.message);
    return { ok: false, error: "No se pudieron guardar los productos." };
  }

  // 3) Upsert de stock para la sucursal elegida (reemplaza la cantidad existente).
  const stockPayload = (upsertedProducts ?? []).map((p) => {
    const row = validRows.find(
      (r) =>
        r.code === p.code && brandIdByName.get(r.brand.toLowerCase()) === p.brand_id,
    )!;
    return {
      org_id: orgId,
      product_id: p.id,
      branch_id: branchId,
      quantity: row.stock,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: stockError } = await supabase
    .from("product_stock")
    .upsert(stockPayload, { onConflict: "product_id,branch_id" });
  if (stockError) {
    console.error("confirmProductImport stock:", stockError.message);
    return {
      ok: false,
      error: "Los productos se guardaron, pero no se pudo actualizar el stock.",
    };
  }

  revalidatePath("/productos");
  return { ok: true, imported: stockPayload.length };
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app/\(dashboard\)/productos/import-actions.ts
git commit -m "feat: add bulk product import preview/confirm actions"
```

---

## Task 14: Import dialog UI

**Files:**
- Create: `components/productos/ImportProductsDialog.tsx`

**Interfaces:**
- Consumes: `previewProductImport`, `confirmProductImport`,
  `ImportRowPreview` from `app/(dashboard)/productos/import-actions.ts`
  (Task 13).
- Produces: `<ImportProductsDialog branches />` — used by
  `app/(dashboard)/productos/page.tsx` (Task 15).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import {
  previewProductImport,
  confirmProductImport,
  type ImportRowPreview,
} from "@/app/(dashboard)/productos/import-actions";

type CatalogOption = { id: string; name: string };

export function ImportProductsDialog({ branches }: { branches: CatalogOption[] }) {
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{
    rows: ImportRowPreview[];
    toCreate: number;
    toUpdate: number;
    withErrors: number;
  } | null>(null);
  const router = useRouter();

  function reset() {
    setPreview(null);
    setFile(null);
    setBranchId("");
  }

  async function onPreview() {
    if (!branchId) {
      toast("Selecciona una sucursal.", "error");
      return;
    }
    if (!file) {
      toast("Selecciona un archivo.", "error");
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.set("file", file);
    const res = await previewProductImport(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    setPreview(res);
  }

  async function onConfirm() {
    if (!preview) return;
    setLoading(true);
    const res = await confirmProductImport(branchId, preview.rows);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(`${res.imported} productos importados.`);
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Importar Excel
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title="Importar productos desde Excel"
        size="xl"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <FieldLabel>Sucursal</FieldLabel>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className={fieldInputClass}
              >
                <option value="">Selecciona…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <FieldLabel>Archivo (.xlsx, .csv)</FieldLabel>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className={fieldInputClass}
              />
            </label>
          </div>

          {!preview && (
            <Button onClick={onPreview} disabled={loading}>
              {loading ? "Leyendo…" : "Previsualizar"}
            </Button>
          )}

          {preview && (
            <>
              <p className="text-sm text-slate-600">
                {preview.toCreate} nuevos · {preview.toUpdate} a actualizar ·{" "}
                {preview.withErrors} con error
              </p>
              {preview.withErrors > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {preview.rows
                    .filter((r) => r.status === "error")
                    .map((r) => (
                      <p key={r.rowNumber}>
                        Fila {r.rowNumber}: {r.error}
                      </p>
                    ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={reset} disabled={loading}>
                  Volver a elegir archivo
                </Button>
                <Button
                  onClick={onConfirm}
                  disabled={loading || preview.toCreate + preview.toUpdate === 0}
                >
                  {loading
                    ? "Importando…"
                    : `Confirmar (${preview.toCreate + preview.toUpdate})`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/productos/ImportProductsDialog.tsx
git commit -m "feat: add ImportProductsDialog with preview/confirm flow"
```

---

## Task 15: Productos page — list, search, pagination, catalog tabs

**Files:**
- Create: `app/(dashboard)/productos/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 5, 7, 9 (suppliers), 10, 11, 12, 14.
- Produces: the `/productos` route.

- [ ] **Step 1: Write the page**

```tsx
import Link from "next/link";
import { Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
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
  exchange_rate: number | null;
  margin_sf_pct: number | null;
  margin_cf_pct: number | null;
  margin_may_pct: number | null;
  price_sf_bs: number;
  price_cf_bs: number;
  price_may_bs: number;
  product_brands: { name: string } | null;
  product_families: { name: string } | null;
};

const PRODUCT_SELECT =
  "id, code, brand_id, family_id, origin_id, supplier_id, internal_mm, external_mm, height_mm, flange_mm, stop_mm, application, cost_usd, exchange_rate, margin_sf_pct, margin_cf_pct, margin_may_pct, price_sf_bs, price_cf_bs, price_may_bs, product_brands(name), product_families(name)";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    tab?: string;
    page?: string;
    brandId?: string;
    familyId?: string;
  }>;
}) {
  await requireNavAccess("productos");
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "productos";

  const profile = await getProfile();
  const supabase = await createClient();

  const [{ data: brandsData }, { data: familiesData }, { data: originsData }, { data: branchesData }, { data: suppliersData }] =
    await Promise.all([
      supabase.from("product_brands").select("id, name").order("name"),
      supabase.from("product_families").select("id, name").order("name"),
      supabase.from("product_origins").select("id, name").order("name"),
      supabase.from("branches").select("id, name").order("name"),
      supabase.from("suppliers").select("id, name").order("name"),
    ]);
  const brands = brandsData ?? [];
  const families = familiesData ?? [];
  const origins = originsData ?? [];
  const branches = branchesData ?? [];
  const suppliers = suppliersData ?? [];

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

    if (q) query = query.or(`code.ilike.%${q}%,application.ilike.%${q}%`);
    if (sp.brandId) query = query.eq("brand_id", sp.brandId);
    if (sp.familyId) query = query.eq("family_id", sp.familyId);

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
              <Button type="submit">Buscar</Button>
            </form>
          </Card>

          <Card>
            {products.length === 0 ? (
              <EmptyState
                icon={<Wrench className="h-6 w-6" />}
                title="Sin productos"
                description="Crea el primer producto o importa un Excel."
              />
            ) : (
              <ul className="divide-y divide-slate-200">
                {products.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">
                        {p.code}{" "}
                        <span className="font-normal text-slate-400">
                          · {p.product_brands?.name ?? "—"} · {p.product_families?.name ?? "—"}
                        </span>
                      </p>
                      <p className="truncate text-xs text-slate-500">{p.application || "—"}</p>
                      <p className="text-xs text-slate-400">
                        CF {p.price_cf_bs} Bs · SF {p.price_sf_bs} Bs · MAY {p.price_may_bs} Bs
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
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
                        />
                      )}
                      {canDeleteProductos && <DeleteProductButton id={p.id} code={p.code} />}
                    </div>
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

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/productos/page.tsx
git commit -m "feat: add Productos page with search, pagination and catalog tabs"
```

---

## Task 16: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Enable the feature flags for your dev org**

In the Supabase SQL editor (local), run:
```sql
update organizations set features = features || '{"productos": true, "proveedores": true}'::jsonb;
```

- [ ] **Step 2: Run the full automated check**

Run: `npm run typecheck && npm test`
Expected: typecheck passes, all Vitest tests pass (pricing + productImport).

- [ ] **Step 3: Manual walkthrough**

Run: `npm run dev`, log in as `admin`:
1. `/ajustes` → create 2 sucursales (e.g. "Central Taquina", "Casa del Retén").
2. `/productos` → tab "Marcas": create "HI-TEC" and "LOCAL". Tab "Familias":
   create "RETEN" and "ORING". Tab "Procedencias": create "BOLIVIA".
3. `/proveedores` → create one supplier.
4. `/productos` tab "Productos" → "Nuevo producto": fill code `ORC54.30`,
   marca HI-TEC, familia RETEN, costo 10, tipo de cambio 8.1, SF/CF/MAY
   20/30/10, sucursal Central Taquina, cantidad 5. Confirm the live price
   preview shows before submitting, and the product appears in the list with
   the right SF/CF/MAY prices.
5. Click "Editar" on that product, open the "Stock por sucursal" section,
   change the quantity for Central Taquina, save, confirm it persists after
   refresh.
6. Build a small `.xlsx` test file matching the real export shape (2 junk
   rows + header row `FAMILIA, CODIGO_PRODUCTO, MARCA, STOCK, CF Bs., SF
   Bs., MAY Bs., MI, ME, ALT, PEST, TOPE, APLICACION` + a few data rows,
   including one row with a brand/family that doesn't exist yet). Use
   "Importar Excel", pick "Casa del Retén", preview it, confirm the
   create/update/error counts look right, confirm the import, and verify
   the new brand/family got auto-created and the product/stock appear.
7. As a `member`-role user, confirm Productos/Proveedores are visible but
   read-only (no "Nuevo producto" button, no delete icons, no catálogo tabs
   write form).

- [ ] **Step 4: Fix any issues found, then final commit**

If manual testing reveals bugs, fix them in the relevant task's files and
commit:
```bash
git add -A
git commit -m "fix: address issues found in end-to-end verification"
```
