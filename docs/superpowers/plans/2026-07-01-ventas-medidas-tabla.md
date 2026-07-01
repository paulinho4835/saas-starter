# Ventas: medidas de producto en tabla — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar las medidas físicas del producto (MI/ME/ALT/PEST/TOPE) al
vender, en una tabla con 3 sub-filas por producto (SF/CF/MAY), reemplazando
la lista actual de 1 fila + 3 botones.

**Architecture:** Cambio de solo lectura sobre dos archivos existentes:
`page.tsx` (Server Component) agrega las 5 columnas de medida al `select` de
Supabase y al objeto que pasa a `SalePanel`; `SalePanel.tsx` (Client
Component) reemplaza su `<ul>` de productos por una `<table>` con 3 filas
por producto. No hay cambios de esquema, RLS, ni server actions — la lógica
de carrito y confirmación de venta (`addToCart`, `onConfirm`, `createSale`)
queda intacta.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, Supabase (solo
lectura en este cambio).

## Global Constraints

- Español neutro en toda la UI (sin voseo).
- No se modifica el esquema de base de datos ni `app/(dashboard)/ventas/actions.ts`.
- No se agrega una columna "Equiv" — no existe concepto de producto
  equivalente en el esquema actual (decisión ya tomada en el spec original
  de Ventas y reafirmada en este spec).
- Sin tests automatizados nuevos — este módulo no tiene suite para páginas o
  componentes que dependen de Supabase (mismo patrón que el resto de
  Ventas). La verificación es manual + `npm run typecheck`.
- Medidas nulas se muestran como `—`; medidas con valor se formatean sin
  ceros decimales sobrantes (`12` en vez de `12.00`).

---

### Task 1: Traer las columnas de medida en `page.tsx`

**Files:**
- Modify: `app/(dashboard)/ventas/page.tsx`

**Interfaces:**
- Consumes: columnas ya existentes en `products` (`internal_mm`,
  `external_mm`, `height_mm`, `flange_mm`, `stop_mm`), tipo `number | null`
  cada una (mismo tipo que usa la migración `0002_productos.sql`, columnas
  `numeric` nullable).
- Produces: `ProductResultRow` y el objeto mapeado a `products` (pasado a
  `SalePanel`) ganan 5 campos nuevos: `internalMm`, `externalMm`,
  `heightMm`, `flangeMm`, `stopMm` (todos `number | null`). Task 2 depende
  de estos nombres exactos.

- [ ] **Step 1: Actualizar `RESULT_SELECT` y el tipo `ProductResultRow`**

En `app/(dashboard)/ventas/page.tsx`, reemplaza el bloque de las líneas
25-37 (`type ProductResultRow` y `const RESULT_SELECT`) por:

```typescript
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
```

- [ ] **Step 2: Agregar los campos al mapeo `products`**

Reemplaza el bloque `const products = rows.map(...)` (líneas 105-114
actuales) por:

```typescript
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
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck`
Expected: errores de tipo en `SalePanel.tsx` (Task 2 todavía no actualizó
`ProductResult` para aceptar los campos nuevos) — esto es esperado en este
punto; confirma que no hay errores en `page.tsx` mismo (los únicos errores
deben venir de la firma de `SalePanel`, no del archivo que acabas de
tocar).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/ventas/page.tsx"
git commit -m "feat: fetch product measurement columns in ventas search"
```

---

### Task 2: Tabla de productos con medidas y 3 sub-filas por tier en `SalePanel`

**Files:**
- Modify: `components/ventas/SalePanel.tsx`

**Interfaces:**
- Consumes: los 5 campos nuevos producidos por Task 1
  (`internalMm`/`externalMm`/`heightMm`/`flangeMm`/`stopMm`, todos
  `number | null`); `addToCart(product: ProductResult, tier: PriceTier)`
  (ya existe, sin cambios de firma); `TIER_LABEL` (ya existe).
- Produces: ningún consumidor nuevo — este es el último archivo del
  cambio.

- [ ] **Step 1: Agregar el import de `Fragment` y actualizar el tipo `ProductResult` + `formatMm` + `PRICE_TIERS`**

En `components/ventas/SalePanel.tsx`, reemplaza la línea 3 (`import {
useState } from "react";`) por:

```typescript
import { Fragment, useState } from "react";
```

Luego reemplaza el bloque de las líneas 12-34 originales (`type
ProductResult`, `type PriceTier`, `type CartLine`, `TIER_LABEL`) por:

```typescript
type ProductResult = {
  id: string;
  code: string;
  application: string | null;
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

type PriceTier = "sf" | "cf" | "may";

type CartLine = {
  productId: string;
  code: string;
  priceTier: PriceTier;
  unitPriceBs: string;
  quantity: string;
  maxStock: number;
};

const TIER_LABEL: Record<PriceTier, string> = { sf: "SF", cf: "CF", may: "MAY" };
const PRICE_TIERS: PriceTier[] = ["sf", "cf", "may"];
const TIER_ROW_BG: Record<PriceTier, string> = {
  sf: "bg-white",
  cf: "bg-slate-50",
  may: "bg-slate-100",
};

function formatMm(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}
```

- [ ] **Step 2: Reemplazar el bloque de la lista de productos por una tabla**

Reemplaza el `<Card className="lg:col-span-2">...</Card>` completo (líneas
127-157 actuales del archivo original) por:

```tsx
      <Card className="overflow-x-auto lg:col-span-2">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Marca</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Precio (Bs)</th>
              <th className="px-3 py-2">MI</th>
              <th className="px-3 py-2">ME</th>
              <th className="px-3 py-2">ALT</th>
              <th className="px-3 py-2">PEST</th>
              <th className="px-3 py-2">TOPE</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const outOfStock = p.stock <= 0;
              return (
                <Fragment key={p.id}>
                  {PRICE_TIERS.map((tier, tierIndex) => (
                    <tr
                      key={`${p.id}-${tier}`}
                      className={`${TIER_ROW_BG[tier]} border-b border-slate-100 ${
                        outOfStock ? "opacity-50" : ""
                      }`}
                    >
                      {tierIndex === 0 && (
                        <td className="px-3 py-2 align-top" rowSpan={3}>
                          <p className="font-medium text-slate-800">{p.code}</p>
                          <p className="text-xs text-slate-500">{p.application || "—"}</p>
                        </td>
                      )}
                      {tierIndex === 0 && (
                        <td className="px-3 py-2 align-top" rowSpan={3}>
                          {p.brandName}
                        </td>
                      )}
                      {tierIndex === 0 && (
                        <td
                          className={`px-3 py-2 align-top ${outOfStock ? "text-red-500" : ""}`}
                          rowSpan={3}
                        >
                          {p.stock}
                        </td>
                      )}
                      <td className="px-3 py-2">{TIER_LABEL[tier]}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          disabled={outOfStock}
                          onClick={() => addToCart(p, tier)}
                          className="rounded px-2 py-1 font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                        >
                          {priceForTier(p, tier)}
                        </button>
                      </td>
                      {tierIndex === 0 && (
                        <>
                          <td className="px-3 py-2 align-top" rowSpan={3}>
                            {formatMm(p.internalMm)}
                          </td>
                          <td className="px-3 py-2 align-top" rowSpan={3}>
                            {formatMm(p.externalMm)}
                          </td>
                          <td className="px-3 py-2 align-top" rowSpan={3}>
                            {formatMm(p.heightMm)}
                          </td>
                          <td className="px-3 py-2 align-top" rowSpan={3}>
                            {formatMm(p.flangeMm)}
                          </td>
                          <td className="px-3 py-2 align-top" rowSpan={3}>
                            {formatMm(p.stopMm)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
```

Nota: este bloque usa `priceForTier`, que ya existe en el archivo (función
de nivel de módulo definida antes del componente, líneas 36-40 del
original) — no se toca.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 4: Verificación manual**

1. Arrancar `npm run dev`, entrar a `/ventas` con un usuario que tenga
   `branch_id` asignado y productos con stock en esa sucursal.
2. Confirmar que la tabla muestra las columnas MI/ME/ALT/PEST/TOPE con
   valores reales (no `—` si el producto tiene medidas cargadas).
3. Confirmar que cada producto ocupa 3 filas (SF/CF/MAY) y que Código,
   Marca, Stock y las 5 medidas aparecen una sola vez por producto (sin
   repetirse en las 3 filas).
4. Clic en el precio de una fila agrega esa línea al carrito con el tier
   correcto (verificar en el panel "Carrito" a la derecha).
5. Un producto con stock 0 muestra sus 3 filas atenuadas (`opacity-50`) y
   los precios no son clickeables.
6. Confirmar una venta de prueba y verificar que sigue funcionando igual
   que antes (el carrito y `createSale` no cambiaron).

- [ ] **Step 5: Commit**

```bash
git add components/ventas/SalePanel.tsx
git commit -m "feat: show product measurements in a 3-row-per-tier table in ventas"
```

---
