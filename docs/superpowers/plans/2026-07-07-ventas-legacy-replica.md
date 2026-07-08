# Rediseño de Ventas como réplica del sistema legacy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/ventas` para que replique el diseño y flujo del sistema
legacy "Venta Retenes" (tabla paginada, filtros en panel derecho, modal
"Cantidad de producto", carrito "Productos para la Venta" a todo el ancho,
panel de stock por sucursal + notas, acceso rápido a Tasa de Cambio),
manteniendo el sidebar del SaaS intacto y la regla de "un solo tipo de
venta por venta".

**Architecture:** `SalePanel.tsx` se descompone en tres componentes
(`ProductsTable`, `CartPanel`, `BranchStockPanel`) orquestados por
`SalePanel.tsx`, más dos modales nuevos (`AddToCartModal`,
`ExchangeRateModal`). La paginación y el filtrado explícito se resuelven en
`page.tsx`/`VentasFilters.tsx` vía `searchParams` (patrón ya usado en
`movimientos-producto`). La regla de "un tipo por venta" y el cálculo de
página válida se extraen a funciones puras testeables en
`lib/ventasCart.ts`.

**Tech Stack:** Next.js 15 App Router (Server Components + Server Actions),
Supabase (Postgres + RLS), TypeScript, Zod, Tailwind, Vitest.

## Global Constraints

- El sidebar de navegación del SaaS **no se modifica**.
- Se mantiene la regla vigente: **una venta = un solo tipo de precio**
  (CF/SF/MAY) — NO se permite mezclar tiers en el mismo carrito, a pesar de
  que el legacy sugiere grupos mixtos.
- El campo `products.notes` es de **solo lectura en Ventas**; se edita
  únicamente desde el formulario de Productos.
- El botón "$" (Tasa de Cambio) solo es visible si
  `can(profile.role, "settings:write")` es `true`.
- Todo se implementa y verifica **en local primero** (`npm run dev`,
  `npm test`, `npm run typecheck`, `npm run build`). **No se hace `git
  push` ni se aplica la migración contra Supabase Cloud sin autorización
  explícita del usuario** — ver Task 1 y Task 10.
- Toast de confirmación al agregar al carrito debe decir exactamente:
  `"Añadido en productos para la venta"` (texto del legacy).

---

### Task 1: Migración — columna `products.notes`

**Files:**
- Create: `supabase/migrations/0015_product_notes.sql`

**Interfaces:**
- Produces: columna `products.notes` (`text`, nullable, sin default) —
  usada por Task 2 (formulario Productos) y Task 8 (panel de stock en
  Ventas).

- [ ] **Step 1: Crear el archivo de migración**

```sql
-- supabase/migrations/0015_product_notes.sql
-- Nota libre por producto (ej. "En almacén hay 2 docenas"), visible de solo
-- lectura en Ventas y editable desde Productos. Ver
-- docs/superpowers/specs/2026-07-07-ventas-legacy-replica-design.md

alter table products add column notes text;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0015_product_notes.sql
git commit -m "feat(db): agrega columna products.notes"
```

**IMPORTANTE — no ejecutar todavía:** esta migración se aplica contra
Supabase (local o Cloud) recién en Task 10, después de que el usuario
autorice explícitamente esa acción. No corras `supabase db push` ni ningún
comando que toque una base de datos real como parte de este task.

---

### Task 2: Campo "Notas" en Productos

**Files:**
- Modify: `app/(dashboard)/productos/actions.ts:112-148` (`productSchema`,
  `parseProductForm`), `:185-217` (`createProduct` insert), `:307-331`
  (`updateProduct` update)
- Modify: `components/productos/ProductFormModal.tsx:18-35`
  (`ProductDetail`), `:202-210` (agregar textarea después de Aplicación)
- Modify: `app/(dashboard)/productos/page.tsx:36-62` (`ProductRow`,
  `PRODUCT_SELECT`)

**Interfaces:**
- Consumes: columna `products.notes` de Task 1 (el código se escribe ahora;
  no requiere que la migración esté aplicada para compilar/testear, solo
  para funcionar contra una DB real).
- Produces: `ProductDetail.notes: string | null` en
  `ProductFormModal.tsx`, `ProductRow.notes: string | null` en
  `productos/page.tsx` — Task 8 reutiliza este mismo shape de `notes` para
  el panel de solo lectura en Ventas.

- [ ] **Step 1: Agregar `notes` al schema y al parseo del formulario**

En `app/(dashboard)/productos/actions.ts`, dentro de `productSchema`
(después de `application`):

```ts
  application: z.string().trim().max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
```

Dentro de `parseProductForm` (después de `application: formData.get("application"),`):

```ts
    application: formData.get("application"),
    notes: formData.get("notes"),
```

- [ ] **Step 2: Persistir `notes` en `createProduct` y `updateProduct`**

En el `.insert({...})` de `createProduct` (después de
`application: parsed.data.application || null,`):

```ts
      application: parsed.data.application || null,
      notes: parsed.data.notes || null,
```

En el `.update({...})` de `updateProduct` (mismo cambio, después de la
misma línea de `application`):

```ts
      application: parsed.data.application || null,
      notes: parsed.data.notes || null,
```

- [ ] **Step 3: Agregar `notes` al tipo `ProductDetail` y al textarea del formulario**

En `components/productos/ProductFormModal.tsx`, dentro de `ProductDetail`
(después de `application: string | null;`):

```ts
  application: string | null;
  notes: string | null;
```

Después del bloque del textarea de Aplicación (`components/productos/ProductFormModal.tsx:202-210`):

```tsx
          <label className="block text-sm">
            <FieldLabel>Aplicación</FieldLabel>
            <textarea
              name="application"
              rows={2}
              defaultValue={product?.application ?? ""}
              className={fieldInputClass}
            />
          </label>

          <label className="block text-sm">
            <FieldLabel>Notas</FieldLabel>
            <textarea
              name="notes"
              rows={2}
              defaultValue={product?.notes ?? ""}
              placeholder="Ej. En almacén hay 2 docenas"
              className={fieldInputClass}
            />
          </label>
```

- [ ] **Step 4: Agregar `notes` a `ProductRow` y `PRODUCT_SELECT`**

En `app/(dashboard)/productos/page.tsx`, dentro de `ProductRow` (después de
`application: string | null;`):

```ts
  application: string | null;
  notes: string | null;
```

En `PRODUCT_SELECT` (después de `application,`):

```ts
const PRODUCT_SELECT =
  "id, code, brand_id, family_id, origin_id, supplier_id, internal_mm, external_mm, height_mm, flange_mm, stop_mm, application, notes, cost_usd, margin_sf_pct, margin_cf_pct, margin_may_pct, price_sf_bs, price_cf_bs, price_may_bs, product_brands(name), product_families(name), product_origins(name)";
```

- [ ] **Step 5: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores (los dos usos de `<ProductFormModal product={p} .../>`
en `productos/page.tsx:195` y `:354` siguen compilando porque `p` ahora
incluye `notes` gracias al Step 4).

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/productos/actions.ts components/productos/ProductFormModal.tsx app/\(dashboard\)/productos/page.tsx
git commit -m "feat: agrega campo Notas a Productos"
```

---

### Task 3: `lib/ventasCart.ts` — reglas puras del carrito

**Files:**
- Create: `lib/ventasCart.ts`
- Test: `lib/ventasCart.test.ts`

**Interfaces:**
- Consumes: `priceTierForSaleType`, `type SaleType` de `lib/saleType.ts`
  (ya existente).
- Produces: `export type PriceTier = "cf" | "sf" | "may"`,
  `export function tierMismatchError(currentSaleType: SaleType, newTier:
  PriceTier): string | null`, `export function clampPage(page: number,
  totalPages: number): number`, `export function isValidCartQuantity(quantity:
  number, stock: number): boolean`, `export function isValidCartPrice(price:
  number): boolean` — Task 6 usa `clampPage`; Task 7 usa `tierMismatchError` y
  `PriceTier`; Task 4 (`AddToCartModal`) usa `isValidCartQuantity` e
  `isValidCartPrice` en vez de repetir la validación inline, para que quede
  cubierta por tests de función pura (el proyecto no usa React Testing
  Library — ver `lib/*.test.ts` existentes, todos son de funciones puras).

- [ ] **Step 1: Escribir los tests (deben fallar primero)**

```ts
// lib/ventasCart.test.ts
import { describe, expect, it } from "vitest";
import { tierMismatchError, clampPage, isValidCartQuantity, isValidCartPrice } from "./ventasCart";

describe("tierMismatchError", () => {
  it("returns null when the new tier matches the current sale type's tier", () => {
    expect(tierMismatchError("con_factura", "cf")).toBeNull();
  });

  it("returns null for the QR variant of the same tier", () => {
    expect(tierMismatchError("con_factura_qr", "cf")).toBeNull();
  });

  it("returns an error message when tiers differ", () => {
    expect(tierMismatchError("con_factura", "sf")).toBe(
      "Esta venta ya tiene productos Con Factura, no se puede mezclar con Sin Factura.",
    );
  });

  it("returns an error message comparing mayorista against sin_factura", () => {
    expect(tierMismatchError("mayorista", "sf")).toBe(
      "Esta venta ya tiene productos Mayorista, no se puede mezclar con Sin Factura.",
    );
  });
});

describe("clampPage", () => {
  it("clamps a page above totalPages down to totalPages", () => {
    expect(clampPage(999, 5)).toBe(5);
  });

  it("clamps a page below 1 up to 1", () => {
    expect(clampPage(0, 5)).toBe(1);
  });

  it("returns 1 when there are no pages", () => {
    expect(clampPage(3, 0)).toBe(1);
  });

  it("passes through a valid page unchanged", () => {
    expect(clampPage(3, 5)).toBe(3);
  });

  it("floors a non-integer page", () => {
    expect(clampPage(2.7, 5)).toBe(2);
  });
});

describe("isValidCartQuantity", () => {
  it("accepts an integer quantity within stock", () => {
    expect(isValidCartQuantity(3, 5)).toBe(true);
  });

  it("rejects a quantity above stock", () => {
    expect(isValidCartQuantity(6, 5)).toBe(false);
  });

  it("rejects zero or negative quantities", () => {
    expect(isValidCartQuantity(0, 5)).toBe(false);
    expect(isValidCartQuantity(-1, 5)).toBe(false);
  });

  it("rejects non-integer quantities", () => {
    expect(isValidCartQuantity(1.5, 5)).toBe(false);
  });
});

describe("isValidCartPrice", () => {
  it("accepts zero and positive prices", () => {
    expect(isValidCartPrice(0)).toBe(true);
    expect(isValidCartPrice(11.05)).toBe(true);
  });

  it("rejects negative prices", () => {
    expect(isValidCartPrice(-1)).toBe(false);
  });

  it("rejects non-finite prices", () => {
    expect(isValidCartPrice(NaN)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/ventasCart.test.ts`
Expected: FAIL — `Cannot find module './ventasCart'`

- [ ] **Step 3: Implementar `lib/ventasCart.ts`**

```ts
// lib/ventasCart.ts
// Reglas puras del carrito de Ventas — sin acceso a DB ni a React, para
// poder testearlas igual que lib/sales.ts. Ver
// docs/superpowers/specs/2026-07-07-ventas-legacy-replica-design.md

import { priceTierForSaleType, type SaleType } from "./saleType";

export type PriceTier = "cf" | "sf" | "may";

const TIER_SALE_LABEL: Record<PriceTier, string> = {
  cf: "Con Factura",
  sf: "Sin Factura",
  may: "Mayorista",
};

// Una venta = un solo tier de precio (CF/SF/MAY), aunque el `saleType`
// pueda variar entre la variante QR y no-QR del mismo tier (mismo precio).
// Devuelve el mensaje de error a mostrar si se intenta agregar un tier
// distinto al del carrito ya iniciado, o null si es compatible.
export function tierMismatchError(
  currentSaleType: SaleType,
  newTier: PriceTier,
): string | null {
  const currentTier = priceTierForSaleType(currentSaleType);
  if (currentTier === newTier) return null;
  return `Esta venta ya tiene productos ${TIER_SALE_LABEL[currentTier]}, no se puede mezclar con ${TIER_SALE_LABEL[newTier]}.`;
}

// Clampa un número de página al rango válido [1, totalPages] (o 1 si no hay
// páginas). Usado para que un `?page=` inválido en la URL no rompa la query.
export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) return 1;
  if (page < 1) return 1;
  if (page > totalPages) return Math.floor(totalPages);
  return Math.floor(page);
}

// Validaciones del modal "Cantidad de producto" (AddToCartModal), extraídas
// como funciones puras para poder testearlas sin React Testing Library.
export function isValidCartQuantity(quantity: number, stock: number): boolean {
  return Number.isInteger(quantity) && quantity > 0 && quantity <= stock;
}

export function isValidCartPrice(price: number): boolean {
  return Number.isFinite(price) && price >= 0;
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/ventasCart.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ventasCart.ts lib/ventasCart.test.ts
git commit -m "feat: agrega reglas puras de carrito y paginación para Ventas"
```

---

### Task 4: `AddToCartModal` — modal "Cantidad de producto"

**Files:**
- Create: `components/ventas/AddToCartModal.tsx`

**Interfaces:**
- Consumes: `Modal` de `components/ui/Modal.tsx`, `fieldInputClass` de
  `components/ui/Field.tsx`, `Button` de `components/ui/Button.tsx`,
  `type PriceTier`, `isValidCartQuantity`, `isValidCartPrice` de
  `lib/ventasCart.ts` (Task 3).
- Produces:
  ```ts
  export type AddToCartModalProduct = {
    id: string;
    code: string;
    tier: PriceTier;
    priceBs: number;
    stock: number;
  };

  export type AddToCartLine = {
    productId: string;
    code: string;
    tier: PriceTier;
    unitPriceBs: number;
    quantity: number;
  };

  export function AddToCartModal(props: {
    product: AddToCartModalProduct | null;
    onClose: () => void;
    onAdd: (line: AddToCartLine) => string | null;
  }): JSX.Element
  ```
  Task 7 (`SalePanel.tsx`) renderiza este modal y le pasa `onAdd`, que
  devuelve un mensaje de error (string) si la línea no se pudo agregar
  (ej. mezcla de tipos), o `null` si se agregó con éxito.

- [ ] **Step 1: Implementar el componente**

```tsx
// components/ventas/AddToCartModal.tsx
"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { isValidCartQuantity, isValidCartPrice, type PriceTier } from "@/lib/ventasCart";

export type AddToCartModalProduct = {
  id: string;
  code: string;
  tier: PriceTier;
  priceBs: number;
  stock: number;
};

export type AddToCartLine = {
  productId: string;
  code: string;
  tier: PriceTier;
  unitPriceBs: number;
  quantity: number;
};

const TIER_PRICE_LABEL: Record<PriceTier, string> = {
  cf: "Precio Con Factura (CF)",
  sf: "Precio Sin Factura (SF)",
  may: "Precio Mayorista (MAY)",
};

export function AddToCartModal({
  product,
  onClose,
  onAdd,
}: {
  product: AddToCartModalProduct | null;
  onClose: () => void;
  onAdd: (line: AddToCartLine) => string | null;
}) {
  const [customPrice, setCustomPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Cada vez que se abre el modal con un producto distinto, limpia los
  // campos y el error de la vez anterior.
  useEffect(() => {
    setCustomPrice("");
    setQuantity("");
    setError(null);
  }, [product?.id, product?.tier]);

  if (!product) return null;

  const qtyNumber = Number(quantity);
  const qtyValid = isValidCartQuantity(qtyNumber, product.stock);
  const priceNumber = customPrice === "" ? product.priceBs : Number(customPrice);
  const priceValid = isValidCartPrice(priceNumber);

  function handleAdd() {
    if (!product || !qtyValid || !priceValid) return;
    const err = onAdd({
      productId: product.id,
      code: product.code,
      tier: product.tier,
      unitPriceBs: priceNumber,
      quantity: qtyNumber,
    });
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <Modal open={Boolean(product)} onClose={onClose} title="Cantidad de producto">
      <div className="space-y-3">
        <label className="block text-sm">
          <FieldLabel>Código de producto</FieldLabel>
          <input type="text" disabled value={product.code} className={fieldInputClass} />
        </label>

        <label className="block text-sm">
          <FieldLabel>{TIER_PRICE_LABEL[product.tier]}</FieldLabel>
          <input type="text" disabled value={product.priceBs} className={fieldInputClass} />
        </label>

        <label className="block text-sm">
          <FieldLabel>Stock de Sucursal Actual</FieldLabel>
          <input type="text" disabled value={product.stock} className={fieldInputClass} />
        </label>

        <label className="block text-sm">
          <FieldLabel>Establecer precio</FieldLabel>
          <input
            type="number"
            step="0.01"
            min={0}
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            placeholder={String(product.priceBs)}
            className={fieldInputClass}
          />
        </label>

        <label className="block text-sm">
          <FieldLabel>Cantidad</FieldLabel>
          <input
            type="number"
            min={1}
            max={product.stock}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={fieldInputClass}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={!qtyValid || !priceValid} onClick={handleAdd}>
            Agregar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add components/ventas/AddToCartModal.tsx
git commit -m "feat: agrega modal Cantidad de producto en Ventas"
```

---

### Task 5: `VentasFilters.tsx` — filtros explícitos en columna derecha

**Files:**
- Modify: `app/(dashboard)/ventas/VentasFilters.tsx` (reescritura completa)

**Interfaces:**
- Consumes: mismo `FilterValues`/`initial`/`brands` que ya recibía de
  `page.tsx` — sin cambios de props.
- Produces: mismo componente `VentasFilters`, ahora sin debounce; Task 6
  lo sigue renderizando igual, solo cambia el layout envolvente en
  `page.tsx`.

- [ ] **Step 1: Reescribir el componente sin debounce, con Filtrar/Limpiar**

```tsx
// app/(dashboard)/ventas/VentasFilters.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";

type Brand = { id: string; name: string };

type FilterValues = {
  code: string;
  application: string;
  brandId: string;
  mi: string;
  me: string;
  alt: string;
  pest: string;
  tope: string;
};

export function VentasFilters({
  brands,
  initial,
}: {
  brands: Brand[];
  initial: FilterValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);

  function update<K extends keyof FilterValues>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function onFiltrar() {
    const params = new URLSearchParams();
    if (values.code) params.set("code", values.code);
    if (values.application) params.set("application", values.application);
    if (values.brandId) params.set("brandId", values.brandId);
    if (values.mi) params.set("mi", values.mi);
    if (values.me) params.set("me", values.me);
    if (values.alt) params.set("alt", values.alt);
    if (values.pest) params.set("pest", values.pest);
    if (values.tope) params.set("tope", values.tope);
    const qs = params.toString();
    router.push(qs ? `/ventas?${qs}` : "/ventas");
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm">
        <FieldLabel>Aplicación</FieldLabel>
        <input
          type="text"
          value={values.application}
          onChange={(e) => update("application", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Código</FieldLabel>
        <input
          type="text"
          value={values.code}
          onChange={(e) => update("code", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="col-span-2 block text-sm">
        <FieldLabel>Marca</FieldLabel>
        <select
          value={values.brandId}
          onChange={(e) => update("brandId", e.target.value)}
          className={fieldInputClass}
        >
          <option value="">Todas</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <FieldLabel>ME</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.me}
          onChange={(e) => update("me", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>MI</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.mi}
          onChange={(e) => update("mi", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Altura</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.alt}
          onChange={(e) => update("alt", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Pestaña</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.pest}
          onChange={(e) => update("pest", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <label className="col-span-2 block text-sm">
        <FieldLabel>Tope</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={values.tope}
          onChange={(e) => update("tope", e.target.value)}
          className={fieldInputClass}
        />
      </label>
      <Button type="button" className="col-span-1" onClick={onFiltrar}>
        Filtrar
      </Button>
      <ButtonLink variant="secondary" className="col-span-1 text-center" href="/ventas">
        Limpiar
      </ButtonLink>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores (Task 6 todavía no cambió `page.tsx`, así que el
`<Card className="p-4">` que hoy envuelve a `<VentasFilters />` en
`page.tsx:159-171` sigue funcionando — el `Card` externo se retira recién
en Task 6 cuando se reubica el panel derecho).

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/ventas/VentasFilters.tsx
git commit -m "feat: filtros de Ventas con búsqueda explícita (Filtrar/Limpiar)"
```

---

### Task 6: `page.tsx` — paginación, panel derecho, tasa de cambio

**Files:**
- Modify: `app/(dashboard)/ventas/page.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `clampPage` de `lib/ventasCart.ts` (Task 3), `VentasFilters`
  (Task 5, sin cambio de props).
- Produces: pasa a `SalePanel` (Task 7) las props `products`,
  `exchangeRate: number`, `canEditExchangeRate: boolean`, y renderiza
  `VentasFilters` dentro de una columna derecha junto con un slot para
  `BranchStockPanel` (Task 8) — la columna derecha completa vive dentro de
  `SalePanel`, así que `page.tsx` solo le pasa los datos, no arma el layout
  de esa columna.

- [ ] **Step 1: Reescribir `page.tsx` con paginación y `exchangeRate`**

```tsx
// app/(dashboard)/ventas/page.tsx
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

  function buildHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (sp.code) params.set("code", sp.code);
    if (sp.application) params.set("application", sp.application);
    if (sp.brandId) params.set("brandId", sp.brandId);
    if (sp.mi) params.set("mi", sp.mi);
    if (sp.me) params.set("me", sp.me);
    if (sp.alt) params.set("alt", sp.alt);
    if (sp.pest) params.set("pest", sp.pest);
    if (sp.tope) params.set("tope", sp.tope);
    params.set("page", String(targetPage));
    return `/ventas?${params.toString()}`;
  }

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
          buildPageHref={buildHref}
          exchangeRate={exchangeRate}
          canEditExchangeRate={can(profile.role, "settings:write")}
        />
      )}
    </div>
  );
}
```

**Nota sobre el rango de la query:** el `.range(0, PAGE_SIZE * 200 - 1)`
es un tope defensivo (hasta 5000 filas) para no traer la tabla completa en
orgs muy grandes; el recorte de página real ocurre en JS con `.slice(...)`
para poder combinarlo con el `count: "exact"` de Supabase de forma simple.
Si en el futuro el catálogo supera las 5000 filas, esto debe migrar a
paginación real vía `.range()` con el offset ya calculado — fuera de
alcance de este plan.

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: fallará hasta que `SalePanel` (Task 7) acepte las nuevas props
`filters`, `page`, `totalPages`, `buildPageHref`, `exchangeRate`,
`canEditExchangeRate` — es esperado en este punto del plan, se resuelve en
Task 7. No hacer commit todavía si `typecheck` falla por esto.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/ventas/page.tsx
git commit -m "feat: paginación real y tasa de cambio en la query de Ventas"
```

---

### Task 7: `SalePanel.tsx` — tabla paginada, selección, carrito con regla de tipo único

**Files:**
- Create: `components/ventas/ProductsTable.tsx`
- Create: `components/ventas/CartPanel.tsx`
- Modify: `components/ventas/SalePanel.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `AddToCartModal`, `AddToCartLine`, `AddToCartModalProduct` de
  Task 4; `tierMismatchError`, `type PriceTier` de Task 3; props nuevas de
  `page.tsx` (Task 6): `filters: React.ReactNode`, `page: number`,
  `totalPages: number`, `buildPageHref: (page: number) => string`,
  `exchangeRate: number`, `canEditExchangeRate: boolean`.
- Produces: `SalePanel` sigue siendo el export usado por `page.tsx`;
  agrega un slot para `BranchStockPanel` (Task 8) vía prop
  `rightPanelExtra?: React.ReactNode` renderizado debajo de los filtros y
  arriba de donde Task 8 inyecta el panel de stock; agrega el botón "$"
  (contenedor listo, Task 9 le conecta `ExchangeRateModal`).

- [ ] **Step 1: Crear `ProductsTable.tsx` (tabla + paginación + selección)**

```tsx
// components/ventas/ProductsTable.tsx
"use client";

import { Pin } from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ScrollHint } from "@/components/ui/ScrollHint";
import type { PriceTier } from "@/lib/ventasCart";

export type ProductResult = {
  id: string;
  code: string;
  application: string | null;
  notes: string | null;
  brandName: string;
  priceSfBs: number;
  priceCfBs: number;
  priceMayBs: number;
  stock: number;
  internalMm: number | null;
  externalMm: number | null;
  heightMm: number | null;
  flangeMm: number | null;
  stopMm: number | null;
};

function formatMm(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

const TIER_LABEL: Record<PriceTier, string> = { cf: "CF", sf: "SF", may: "MAY" };
const TIER_PRICE: Record<PriceTier, "priceCfBs" | "priceSfBs" | "priceMayBs"> = {
  cf: "priceCfBs",
  sf: "priceSfBs",
  may: "priceMayBs",
};
const TIER_ROW_CLASS: Record<PriceTier, string> = {
  cf: "bg-emerald-100",
  sf: "bg-yellow-100",
  may: "bg-rose-100",
};
const TIERS: PriceTier[] = ["cf", "sf", "may"];

export function ProductsTable({
  products,
  selectedProductId,
  onSelectProduct,
  onPriceClick,
  pinnedIds,
  onTogglePin,
  onSearchEquivalents,
  page,
  totalPages,
  buildPageHref,
}: {
  products: ProductResult[];
  selectedProductId: string | null;
  onSelectProduct: (product: ProductResult) => void;
  onPriceClick: (product: ProductResult, tier: PriceTier) => void;
  pinnedIds: Set<string>;
  onTogglePin: (product: ProductResult) => void;
  onSearchEquivalents: (product: ProductResult) => void;
  page: number;
  totalPages: number;
  buildPageHref: (page: number) => string;
}) {
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <Card className="overflow-auto">
      <ScrollHint />
      <table className="w-full min-w-[820px] text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2"></th>
            <th className="px-3 py-2">Código</th>
            <th className="px-3 py-2">Marca</th>
            <th className="px-3 py-2">Stock</th>
            <th className="px-3 py-2">Tipo</th>
            <th className="px-3 py-2">Precios Bs</th>
            <th className="px-3 py-2">MI</th>
            <th className="px-3 py-2">ME</th>
            <th className="px-3 py-2">ALT</th>
            <th className="px-3 py-2">PEST</th>
            <th className="px-3 py-2">TOPE</th>
            <th className="px-3 py-2">Equiv</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const outOfStock = p.stock <= 0;
            const selected = p.id === selectedProductId;
            return TIERS.map((tier, i) => (
              <tr
                key={`${p.id}-${tier}`}
                onClick={() => onSelectProduct(p)}
                className={`cursor-pointer ${selected ? "bg-slate-300" : TIER_ROW_CLASS[tier]} ${outOfStock ? "opacity-50" : ""}`}
              >
                {i === 0 && (
                  <td className="px-3 py-2 align-top" rowSpan={3}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(p);
                      }}
                      className={`rounded p-1 hover:bg-white/50 ${pinnedIds.has(p.id) ? "text-brand-700" : "text-slate-400"}`}
                      title={pinnedIds.has(p.id) ? "Desanclar" : "Anclar"}
                    >
                      {pinnedIds.has(p.id) ? <Pin className="h-4 w-4 fill-current" /> : <Pin className="h-4 w-4" />}
                    </button>
                  </td>
                )}
                {i === 0 && (
                  <td className="px-3 py-2 align-top" rowSpan={3}>
                    <p className="font-medium text-slate-800">{p.code}</p>
                    <p className="text-xs text-slate-500">{p.application || "—"}</p>
                  </td>
                )}
                {i === 0 && (
                  <td className="px-3 py-2 align-top" rowSpan={3}>
                    {p.brandName}
                  </td>
                )}
                {i === 0 && (
                  <td className={`px-3 py-2 align-top font-semibold ${outOfStock ? "text-red-700" : "text-red-600"}`} rowSpan={3}>
                    {p.stock}
                  </td>
                )}
                <td className="px-3 py-2 font-medium text-slate-700">{TIER_LABEL[tier]}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={outOfStock}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPriceClick(p, tier);
                    }}
                    className="rounded bg-white px-2 py-1 font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Agregar al carrito con este tipo de venta"
                  >
                    {p[TIER_PRICE[tier]]}
                  </button>
                </td>
                <td className="px-3 py-2">{formatMm(p.internalMm)}</td>
                <td className="px-3 py-2">{formatMm(p.externalMm)}</td>
                <td className="px-3 py-2">{formatMm(p.heightMm)}</td>
                <td className="px-3 py-2">{formatMm(p.flangeMm)}</td>
                <td className="px-3 py-2">{formatMm(p.stopMm)}</td>
                <td className="px-3 py-2">
                  {tier === "sf" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSearchEquivalents(p);
                      }}
                      className="rounded bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                      title="Buscar repuestos con las mismas medidas (±0.5mm)"
                    >
                      Equiv
                    </button>
                  )}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1 border-t border-slate-100 p-3 text-sm">
          {page > 1 ? (
            <ButtonLink variant="secondary" size="sm" href={buildPageHref(page - 1)}>
              ‹
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              ‹
            </Button>
          )}
          {pageNumbers.map((n) => (
            <ButtonLink
              key={n}
              variant={n === page ? "primary" : "secondary"}
              size="sm"
              href={buildPageHref(n)}
            >
              {n}
            </ButtonLink>
          ))}
          {page < totalPages ? (
            <ButtonLink variant="secondary" size="sm" href={buildPageHref(page + 1)}>
              ›
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              ›
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Crear `CartPanel.tsx` (carrito agrupado, todo el ancho)**

```tsx
// components/ventas/CartPanel.tsx
"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { calculateLineSubtotal, calculateSaleTotal } from "@/lib/sales";
import { SALE_TYPES, SALE_TYPE_LABEL, type SaleType } from "@/lib/saleType";

export type CartLine = {
  productId: string;
  code: string;
  unitPriceBs: string;
  quantity: string;
  maxStock: number;
};

export function CartPanel({
  saleType,
  onChangeSaleType,
  cart,
  onRemoveLine,
  customerName,
  onChangeCustomerName,
  customerNit,
  onChangeCustomerNit,
  loading,
  onConfirm,
}: {
  saleType: SaleType;
  onChangeSaleType: (next: SaleType) => void;
  cart: CartLine[];
  onRemoveLine: (index: number) => void;
  customerName: string;
  onChangeCustomerName: (value: string) => void;
  customerNit: string;
  onChangeCustomerNit: (value: string) => void;
  loading: boolean;
  onConfirm: () => void;
}) {
  if (cart.length === 0) return null;

  const total = calculateSaleTotal(
    cart.map((l) => ({
      unitPriceBs: Number(l.unitPriceBs) || 0,
      quantity: Number(l.quantity) || 0,
    })),
  );

  return (
    <Card className="space-y-4 p-4">
      <h3 className="text-lg text-slate-800">Productos para la Venta</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Tipo de venta</span>
          <select
            value={saleType}
            onChange={(e) => onChangeSaleType(e.target.value as SaleType)}
            className={fieldInputClass}
          >
            {SALE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SALE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Nombre del cliente (opcional)</span>
          <input
            type="text"
            value={customerName}
            onChange={(e) => onChangeCustomerName(e.target.value)}
            placeholder="Venta de mostrador"
            className={fieldInputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">NIT (opcional)</span>
          <input
            type="text"
            value={customerNit}
            onChange={(e) => onChangeCustomerNit(e.target.value)}
            className={fieldInputClass}
          />
        </label>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2">Código</th>
            <th className="px-3 py-2">Cantidad</th>
            <th className="px-3 py-2">Precio Establecido</th>
            <th className="px-3 py-2">Sub Total</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-slate-50">
            <td colSpan={5} className="px-3 py-2 font-medium text-slate-700">
              Productos Venta {SALE_TYPE_LABEL[saleType]}
            </td>
          </tr>
          {cart.map((line, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-800">{line.code}</td>
              <td className="px-3 py-2 text-slate-600">{line.quantity}</td>
              <td className="px-3 py-2 text-slate-600">{line.unitPriceBs}</td>
              <td className="px-3 py-2 text-slate-600">
                {calculateLineSubtotal({
                  unitPriceBs: Number(line.unitPriceBs) || 0,
                  quantity: Number(line.quantity) || 0,
                })}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onRemoveLine(i)}
                  className="rounded bg-rose-200 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-300"
                >
                  Quitar
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="px-3 py-2 font-semibold text-slate-800">
              Total de la Venta
            </td>
            <td className="px-3 py-2 font-semibold text-slate-800">{total}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <div className="flex justify-center">
        <Button disabled={loading} onClick={onConfirm}>
          {loading ? "Confirmando…" : "Venta"}
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Reescribir `SalePanel.tsx` como orquestador**

```tsx
// components/ventas/SalePanel.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PinOff } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import { priceTierForSaleType, type SaleType } from "@/lib/saleType";
import { tierMismatchError, type PriceTier } from "@/lib/ventasCart";
import { createSale } from "@/app/(dashboard)/ventas/actions";
import { ProductsTable, type ProductResult } from "@/components/ventas/ProductsTable";
import { CartPanel, type CartLine } from "@/components/ventas/CartPanel";
import { AddToCartModal, type AddToCartModalProduct, type AddToCartLine } from "@/components/ventas/AddToCartModal";
import { BranchStockPanel } from "@/components/ventas/BranchStockPanel";
import { ExchangeRateModal } from "@/components/ventas/ExchangeRateModal";

// Anclados: personales por navegador (no por org). Ver comentario original
// en el historial de este archivo.
const PINNED_STORAGE_KEY = "ventas:pinnedProducts";

const DEFAULT_SALE_TYPE_FOR_TIER: Record<PriceTier, SaleType> = {
  cf: "con_factura",
  sf: "sin_factura",
  may: "mayorista",
};

const TIER_PRICE: Record<PriceTier, "priceCfBs" | "priceSfBs" | "priceMayBs"> = {
  cf: "priceCfBs",
  sf: "priceSfBs",
  may: "priceMayBs",
};

export function SalePanel({
  products,
  filters,
  page,
  totalPages,
  buildPageHref,
  exchangeRate,
  canEditExchangeRate,
}: {
  products: ProductResult[];
  filters: React.ReactNode;
  page: number;
  totalPages: number;
  buildPageHref: (page: number) => string;
  exchangeRate: number;
  canEditExchangeRate: boolean;
}) {
  const [saleType, setSaleType] = useState<SaleType>("sin_factura");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerNit, setCustomerNit] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState<ProductResult[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [modalProduct, setModalProduct] = useState<AddToCartModalProduct | null>(null);
  const [exchangeRateModalOpen, setExchangeRateModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
      if (raw) setPinned(JSON.parse(raw));
    } catch {
      // localStorage corrupto o bloqueado: seguir sin anclados.
    }
  }, []);

  function togglePin(product: ProductResult) {
    setPinned((prev) => {
      const next = prev.some((p) => p.id === product.id)
        ? prev.filter((p) => p.id !== product.id)
        : [...prev, product];
      try {
        window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Si no se puede guardar, igual se refleja en la sesión actual.
      }
      return next;
    });
  }

  const pinnedIds = new Set(pinned.map((p) => p.id));
  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  function openAddModal(product: ProductResult, tier: PriceTier) {
    setSelectedProductId(product.id);
    setModalProduct({
      id: product.id,
      code: product.code,
      tier,
      priceBs: product[TIER_PRICE[tier]],
      stock: product.stock,
    });
  }

  // Devuelve el mensaje de error a AddToCartModal (que lo muestra sin
  // cerrarse) o null si la línea se agregó con éxito.
  function handleAddLine(line: AddToCartLine): string | null {
    if (cart.length > 0) {
      const err = tierMismatchError(saleType, line.tier);
      if (err) return err;
    } else {
      setSaleType(DEFAULT_SALE_TYPE_FOR_TIER[line.tier]);
    }
    setCart((prev) => [
      ...prev,
      {
        productId: line.productId,
        code: line.code,
        unitPriceBs: String(line.unitPriceBs),
        quantity: String(line.quantity),
        maxStock: modalProduct?.stock ?? 0,
      },
    ]);
    toast("Añadido en productos para la venta");
    return null;
  }

  function changeSaleType(next: SaleType) {
    setSaleType(next);
  }

  function searchEquivalents(product: ProductResult) {
    const params = new URLSearchParams();
    if (product.internalMm !== null) params.set("mi", String(product.internalMm));
    if (product.externalMm !== null) params.set("me", String(product.externalMm));
    if (product.heightMm !== null) params.set("alt", String(product.heightMm));
    if (product.flangeMm !== null) params.set("pest", String(product.flangeMm));
    if (product.stopMm !== null) params.set("tope", String(product.stopMm));
    router.push(`/ventas?${params.toString()}`);
  }

  function removeLine(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  async function onConfirm() {
    if (cart.length === 0) {
      toast("Agrega al menos un producto.", "error");
      return;
    }
    const invalidLine = cart.find(
      (l) =>
        !Number.isFinite(Number(l.unitPriceBs)) ||
        !Number.isInteger(Number(l.quantity)) ||
        Number(l.quantity) <= 0,
    );
    if (invalidLine) {
      toast("Revisa precios y cantidades del carrito.", "error");
      return;
    }

    setLoading(true);
    const formData = new FormData();
    if (customerName) formData.set("customerName", customerName);
    if (customerNit) formData.set("customerNit", customerNit);
    formData.set("saleType", saleType);
    formData.set(
      "items",
      JSON.stringify(
        cart.map((l) => ({
          productId: l.productId,
          unitPriceBs: Number(l.unitPriceBs),
          quantity: Number(l.quantity),
        })),
      ),
    );
    const res = await createSale(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(`Venta registrada: ${res.total} Bs.`);
    setCart([]);
    setCustomerName("");
    setCustomerNit("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {pinned.length > 0 && (
            <Card className="p-3">
              <div className="flex flex-wrap gap-2">
                {pinned.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-brand-200 bg-brand-50 py-1.5 pl-3 pr-1 text-xs"
                  >
                    <span className="font-medium text-slate-800">{p.code}</span>
                    <span className="flex items-center gap-1 text-slate-500">
                      <span className="rounded bg-emerald-100 px-1 text-emerald-800">CF {p.priceCfBs}</span>
                      <span className="rounded bg-amber-100 px-1 text-amber-800">SF {p.priceSfBs}</span>
                      <span className="rounded bg-rose-100 px-1 text-rose-800">MAY {p.priceMayBs}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => openAddModal(p, priceTierForSaleType(saleType))}
                      className="rounded-full bg-brand-600 px-2 py-0.5 font-medium text-white hover:bg-brand-700"
                    >
                      Agregar {p[TIER_PRICE[priceTierForSaleType(saleType)]]} Bs
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePin(p)}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                      title="Desanclar"
                    >
                      <PinOff className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <ProductsTable
            products={products}
            selectedProductId={selectedProductId}
            onSelectProduct={(p) => setSelectedProductId(p.id)}
            onPriceClick={openAddModal}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onSearchEquivalents={searchEquivalents}
            page={page}
            totalPages={totalPages}
            buildPageHref={buildPageHref}
          />
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Filtros</h3>
              {canEditExchangeRate && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setExchangeRateModalOpen(true)}
                  title="Tasa de Cambio"
                >
                  $
                </Button>
              )}
            </div>
            {filters}
          </Card>

          <BranchStockPanel product={selectedProduct} />
        </div>
      </div>

      <CartPanel
        saleType={saleType}
        onChangeSaleType={changeSaleType}
        cart={cart}
        onRemoveLine={removeLine}
        customerName={customerName}
        onChangeCustomerName={setCustomerName}
        customerNit={customerNit}
        onChangeCustomerNit={setCustomerNit}
        loading={loading}
        onConfirm={onConfirm}
      />

      <AddToCartModal product={modalProduct} onClose={() => setModalProduct(null)} onAdd={handleAddLine} />

      {canEditExchangeRate && (
        <ExchangeRateModal
          open={exchangeRateModalOpen}
          onClose={() => setExchangeRateModalOpen(false)}
          exchangeRate={exchangeRate}
        />
      )}
    </div>
  );
}
```

Nota: este Step deja referencias a `BranchStockPanel` y `ExchangeRateModal`
que todavía no existen — se crean en Task 8 y Task 9 respectivamente. Es
esperado que `npm run typecheck` falle hasta completar esos tasks; no
hacer commit de este Step hasta entonces (o, si se ejecuta con
subagent-driven-development, marcar este Step `DONE_WITH_CONCERNS` y
continuar).

- [ ] **Step 4: Commit (solo después de Task 8 y Task 9, cuando typecheck pase limpio)**

```bash
git add components/ventas/ProductsTable.tsx components/ventas/CartPanel.tsx components/ventas/SalePanel.tsx
git commit -m "feat: rediseña Ventas con tabla paginada, selección y carrito agrupado"
```

---

### Task 8: Stock por sucursal — `getProductBranchStock` + `BranchStockPanel`

**Files:**
- Modify: `app/(dashboard)/ventas/actions.ts`
- Create: `components/ventas/BranchStockPanel.tsx`

**Interfaces:**
- Consumes: `getProfile` de `lib/auth.ts`, `createClient` de
  `lib/supabase/server.ts` (mismos que ya usa `createSale`); `ProductResult`
  de `components/ventas/ProductsTable.tsx` (Task 7).
- Produces:
  ```ts
  export type ProductBranchStockResult =
    | { ok: true; rows: { branchName: string; quantity: number }[]; notes: string | null }
    | { ok: false; error: string };

  export async function getProductBranchStock(productId: string): Promise<ProductBranchStockResult>
  ```
  Task 7 (`SalePanel.tsx`) renderiza `<BranchStockPanel product={selectedProduct} />`.

- [ ] **Step 1: Agregar la acción en `app/(dashboard)/ventas/actions.ts`**

Al final del archivo (después de `createSale`):

```ts
// ── Stock por sucursal (panel derecho de Ventas) ────────────────────────────
export type ProductBranchStockResult =
  | { ok: true; rows: { branchName: string; quantity: number }[]; notes: string | null }
  | { ok: false; error: string };

export async function getProductBranchStock(
  productId: string,
): Promise<ProductBranchStockResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient();

  const [{ data: stockData, error: stockError }, { data: productData }] = await Promise.all([
    supabase
      .from("product_stock")
      .select("quantity, branches(name)")
      .eq("product_id", productId),
    supabase.from("products").select("notes").eq("id", productId).maybeSingle(),
  ]);

  if (stockError) {
    console.error("getProductBranchStock:", stockError.message);
    return { ok: false, error: "No se pudo cargar el stock por sucursal." };
  }

  const rows = ((stockData ?? []) as unknown as { quantity: number; branches: { name: string } | null }[]).map(
    (r) => ({ branchName: r.branches?.name ?? "—", quantity: r.quantity }),
  );

  return { ok: true, rows, notes: productData?.notes ?? null };
}
```

- [ ] **Step 2: Crear `BranchStockPanel.tsx`**

```tsx
// components/ventas/BranchStockPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { getProductBranchStock } from "@/app/(dashboard)/ventas/actions";
import type { ProductResult } from "@/components/ventas/ProductsTable";

export function BranchStockPanel({ product }: { product: ProductResult | null }) {
  const [rows, setRows] = useState<{ branchName: string; quantity: number }[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) {
      setRows([]);
      setNotes(null);
      setError(null);
      return;
    }
    let cancelled = false;
    getProductBranchStock(product.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setRows([]);
        setNotes(null);
        return;
      }
      setError(null);
      setRows(res.rows);
      setNotes(res.notes);
    });
    return () => {
      cancelled = true;
    };
  }, [product]);

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Sucursal / Stock
        </h3>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && rows.length === 0 && (
          <p className="text-sm text-slate-400">Selecciona un producto para ver su stock.</p>
        )}
        {!error && rows.length > 0 && (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.branchName} className="border-b border-slate-100">
                  <td className="py-1 text-slate-700">{r.branchName}</td>
                  <td className="py-1 text-right font-medium text-slate-800">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <label className="block text-sm">
        <FieldLabel>Aplicación producto</FieldLabel>
        <textarea
          disabled
          rows={4}
          value={notes ?? ""}
          className={fieldInputClass}
        />
      </label>
    </Card>
  );
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores nuevos relacionados a `BranchStockPanel` o
`getProductBranchStock` (los de `SalePanel.tsx` referentes a
`ExchangeRateModal` de Task 9 siguen pendientes hasta ese task).

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/ventas/actions.ts components/ventas/BranchStockPanel.tsx
git commit -m "feat: panel de stock por sucursal y notas en Ventas"
```

---

### Task 9: `ExchangeRateModal` — acceso rápido a Tasa de Cambio

**Files:**
- Create: `components/ventas/ExchangeRateModal.tsx`

**Interfaces:**
- Consumes: `updateExchangeRate` de `app/(dashboard)/ajustes/actions.ts`
  (ya existente, sin cambios), `Modal` de `components/ui/Modal.tsx`.
- Produces: `export function ExchangeRateModal(props: { open: boolean;
  onClose: () => void; exchangeRate: number }): JSX.Element` — consumido
  por `SalePanel.tsx` (Task 7, ya referenciado en su Step 3).

- [ ] **Step 1: Implementar el componente**

```tsx
// components/ventas/ExchangeRateModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { updateExchangeRate } from "@/app/(dashboard)/ajustes/actions";

export function ExchangeRateModal({
  open,
  onClose,
  exchangeRate,
}: {
  open: boolean;
  onClose: () => void;
  exchangeRate: number;
}) {
  const [nextRate, setNextRate] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onActualizar() {
    if (!nextRate) return;
    setLoading(true);
    const formData = new FormData();
    formData.set("exchangeRate", nextRate);
    const res = await updateExchangeRate(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar el tipo de cambio.", "error");
      return;
    }
    toast("Tipo de cambio actualizado. Los precios de todos los productos se recalcularon.");
    setNextRate("");
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Tasa de Cambio">
      <div className="space-y-3">
        <label className="block text-sm">
          <FieldLabel>Tasa de Cambio actual Bs</FieldLabel>
          <input type="text" disabled value={exchangeRate} className={fieldInputClass} />
        </label>
        <label className="block text-sm">
          <FieldLabel>Nueva Tasa de cambio Bs</FieldLabel>
          <input
            type="number"
            step="0.01"
            min={0.01}
            value={nextRate}
            onChange={(e) => setNextRate(e.target.value)}
            className={fieldInputClass}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={loading || !nextRate} onClick={onActualizar}>
            {loading ? "Actualizando…" : "Actualizar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: sin errores en todo el proyecto (este es el último archivo que
`SalePanel.tsx` necesitaba).

- [ ] **Step 3: Ahora sí, completar el commit pendiente de Task 7**

```bash
git add components/ventas/ProductsTable.tsx components/ventas/CartPanel.tsx components/ventas/SalePanel.tsx components/ventas/ExchangeRateModal.tsx
git commit -m "feat: rediseña Ventas con tabla paginada, selección, carrito agrupado y tasa de cambio"
```

---

### Task 10: Verificación final y aplicación de la migración (requiere autorización)

**Files:** ninguno nuevo — solo comandos de verificación.

- [ ] **Step 1: Suite completa**

Run: `npm run typecheck && npm test && npm run build`
Expected: los tres comandos terminan sin errores. `npm test` debe incluir
los 9 tests nuevos de `lib/ventasCart.test.ts` además de la suite
existente (ver `lib/sales.test.ts`, `lib/saleType.test.ts`, etc.).

- [ ] **Step 2: Smoke test manual en local**

Con `npm run dev` corriendo:
1. Entrar a `/ventas`, confirmar que la tabla pagina (números de página
   abajo) y que los filtros están en la columna derecha con botones
   Filtrar/Limpiar.
2. Clic en un precio → se abre el modal "Cantidad de producto" con los
   campos correctos; agregar una cantidad válida → aparece el toast
   "Añadido en productos para la venta" y la línea en "Productos para la
   Venta" abajo.
3. Intentar agregar un producto de un tier distinto al ya presente en el
   carrito → el modal muestra el error de mezcla y no agrega la línea.
4. Clic en una fila de producto (sin tocar precio) → el panel derecho
   "Sucursal / Stock" y "Aplicación producto" se actualizan para ese
   producto.
5. Si el rol tiene `settings:write`, el botón "$" abre el modal Tasa de
   Cambio y actualizar recalcula precios (mismo comportamiento que en
   Ajustes).
6. Confirmar una venta de prueba con "Venta" y verificar que el stock se
   descuenta (comportamiento ya cubierto por `createSale`, sin cambios).

**Nota:** este smoke test requiere que la migración de Task 1 (columna
`products.notes`) esté aplicada contra alguna base de datos (local o
Cloud) — si no lo está, el Step 2.4 (panel de Aplicación producto) fallará
al leer `notes` porque la columna no existe. Este es el punto en el que se
debe **pedir autorización explícita al usuario** antes de aplicar la
migración (según memoria del proyecto, `master` no tiene
`supabase/config.toml`, así que probablemente haya que aplicarla contra
Supabase Cloud, igual que se hizo con `set_org_exchange_rate` en la feature
de tasa de cambio global).

- [ ] **Step 3: Pedir autorización y aplicar la migración**

No ejecutar sin luz verde explícita del usuario para esta sesión
específica. Una vez autorizado:

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --linked
```

o el comando equivalente que ya se usó en la feature de tasa de cambio
global (ver `docs/superpowers/specs/2026-06-30-productos-sucursales-stock-design.md`
y la sesión donde se aplicó `0014_org_exchange_rate.sql` para el patrón
exacto).

- [ ] **Step 4: Confirmar con el usuario antes de cualquier `git push`**

Este plan no incluye push ni deploy. Una vez que el usuario revisó el
resultado en local (Step 2) y autorizó la migración (Step 3), pedir
autorización explícita y separada para `git push` / deploy, siguiendo la
regla del proyecto.
