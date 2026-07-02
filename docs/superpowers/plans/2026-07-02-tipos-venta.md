# Tipos de Venta — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar `sale_type` (Sin Factura / Con Factura / Sin Factura QR / Con Factura QR / Mayorista) como una elección única por venta que determina el precio de todas sus líneas, simplificar `/ventas` a una fila de precio por producto, y agregar un filtro Total/Efectivo/QR al Dashboard.

**Architecture:** `sales` gana la columna `sale_type`; `sale_items.price_tier` se sigue llenando igual que hoy pero derivado server-side de `sale_type` (tabla de mapeo fija), no confiado del cliente por línea. `SalePanel.tsx` pasa de 3 filas/producto a 1, con un selector de tipo de venta que recalcula precios del carrito al cambiar. El Dashboard gana un segundo selector (`PaymentFilter`) que filtra las queries de ventas por `sale_type`.

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (Postgres + RLS), Zod, Tailwind, Vitest.

## Global Constraints

- Ver spec completo: `docs/superpowers/specs/2026-07-02-tipos-venta-design.md`.
- Español neutro en toda la UI (sin voseo).
- `sale_type` vive en `sales` (nivel venta), **no** en `sale_items`.
- El mapeo `sale_type → price_tier` es fijo y vive **server-side** en `createSale` — nunca se confía en un `priceTier` por línea mandado por el cliente para decidir el tier (sí se sigue confiando en `unitPriceBs`, igual que antes de este cambio — no se amplía la superficie de confianza existente).
- Grupos de pago para el Dashboard: Efectivo = `sin_factura`+`con_factura`+`mayorista`; QR = `sin_factura_qr`+`con_factura_qr`.
- El filtro de pago del Dashboard solo afecta "Ventas" y "Cantidad de ventas" — no toca "Top productos" ni "Stock bajo".
- Fuera de alcance: página de Reporte de Ventas, variante QR de Mayorista, pagos mixtos, editar tipo de venta post-confirmación.

---

### Task 1: Migración — columna `sale_type` en `sales`

**Files:**
- Create: `supabase/migrations/0008_tipos_venta.sql`

**Interfaces:**
- Produces: `sales.sale_type text` con `check` de 5 valores, default `'sin_factura'`.
- Consumido por: Task 3 (`createSale`), Task 5 (Dashboard).

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- Tipos de Venta: Sin/Con Factura, con variante QR, más Mayorista.
-- Ver docs/superpowers/specs/2026-07-02-tipos-venta-design.md
-- ============================================================================

alter table sales add column sale_type text not null default 'sin_factura'
  check (sale_type in ('sin_factura', 'con_factura', 'sin_factura_qr', 'con_factura_qr', 'mayorista'));
```

- [ ] **Step 2: Aplicar y verificar**

```bash
docker exec -i supabase_db_productos-sucursales-stock psql -U postgres -d postgres < supabase/migrations/0008_tipos_venta.sql
```

Expected: `ALTER TABLE`, sin errores. Verificar: `select sale_type from sales limit 1;` no falla (columna existe, ventas viejas quedan en `'sin_factura'` por el default).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_tipos_venta.sql
git commit -m "feat(db): add sale_type column to sales"
```

---

### Task 2: `lib/saleType.ts` — tipos y mapeo compartido

**Files:**
- Create: `lib/saleType.ts`
- Test: `lib/saleType.test.ts`

**Interfaces:**
- Produces: `export type SaleType = "sin_factura" | "con_factura" | "sin_factura_qr" | "con_factura_qr" | "mayorista"`, `export const SALE_TYPES: SaleType[]`, `export const SALE_TYPE_LABEL: Record<SaleType, string>`, `export function priceTierForSaleType(type: SaleType): "sf" | "cf" | "may"`, `export function paymentMethodForSaleType(type: SaleType): "efectivo" | "qr"`.
- Consumido por: Task 3 (`createSale`), Task 4 (`SalePanel`), Task 6 (`PaymentFilter`/Dashboard).

- [ ] **Step 1: Escribir el test que falla primero**

```typescript
// lib/saleType.test.ts
import { describe, expect, it } from "vitest";
import { SALE_TYPES, priceTierForSaleType, paymentMethodForSaleType } from "./saleType";

describe("priceTierForSaleType", () => {
  it("maps sin_factura variants to sf", () => {
    expect(priceTierForSaleType("sin_factura")).toBe("sf");
    expect(priceTierForSaleType("sin_factura_qr")).toBe("sf");
  });

  it("maps con_factura variants to cf", () => {
    expect(priceTierForSaleType("con_factura")).toBe("cf");
    expect(priceTierForSaleType("con_factura_qr")).toBe("cf");
  });

  it("maps mayorista to may", () => {
    expect(priceTierForSaleType("mayorista")).toBe("may");
  });

  it("has a mapping for every declared sale type", () => {
    for (const type of SALE_TYPES) {
      expect(["sf", "cf", "may"]).toContain(priceTierForSaleType(type));
    }
  });
});

describe("paymentMethodForSaleType", () => {
  it("classifies efectivo types", () => {
    expect(paymentMethodForSaleType("sin_factura")).toBe("efectivo");
    expect(paymentMethodForSaleType("con_factura")).toBe("efectivo");
    expect(paymentMethodForSaleType("mayorista")).toBe("efectivo");
  });

  it("classifies qr types", () => {
    expect(paymentMethodForSaleType("sin_factura_qr")).toBe("qr");
    expect(paymentMethodForSaleType("con_factura_qr")).toBe("qr");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/saleType.test.ts`
Expected: FAIL — el módulo `./saleType` no existe.

- [ ] **Step 3: Implementar**

```typescript
// lib/saleType.ts
// Tipo de venta: elegido una vez por venta completa (no por línea), define
// qué columna de precio se usa en TODAS sus líneas y cómo se clasifica para
// el filtro de pago del Dashboard. Ver
// docs/superpowers/specs/2026-07-02-tipos-venta-design.md

export type SaleType =
  | "sin_factura"
  | "con_factura"
  | "sin_factura_qr"
  | "con_factura_qr"
  | "mayorista";

export const SALE_TYPES: SaleType[] = [
  "sin_factura",
  "con_factura",
  "sin_factura_qr",
  "con_factura_qr",
  "mayorista",
];

export const SALE_TYPE_LABEL: Record<SaleType, string> = {
  sin_factura: "Sin Factura",
  con_factura: "Con Factura",
  sin_factura_qr: "Sin Factura QR",
  con_factura_qr: "Con Factura QR",
  mayorista: "Mayorista",
};

const PRICE_TIER_BY_SALE_TYPE: Record<SaleType, "sf" | "cf" | "may"> = {
  sin_factura: "sf",
  sin_factura_qr: "sf",
  con_factura: "cf",
  con_factura_qr: "cf",
  mayorista: "may",
};

export function priceTierForSaleType(type: SaleType): "sf" | "cf" | "may" {
  return PRICE_TIER_BY_SALE_TYPE[type];
}

const QR_TYPES: SaleType[] = ["sin_factura_qr", "con_factura_qr"];

export function paymentMethodForSaleType(type: SaleType): "efectivo" | "qr" {
  return QR_TYPES.includes(type) ? "qr" : "efectivo";
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/saleType.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/saleType.ts lib/saleType.test.ts
git commit -m "feat: add saleType mapping helpers"
```

---

### Task 3: `createSale` — recibir `saleType`, derivar `price_tier` server-side

**Files:**
- Modify: `app/(dashboard)/ventas/actions.ts`

**Interfaces:**
- Consumes: `SaleType`/`priceTierForSaleType` (Task 2).
- Produces: `createSale` ahora espera `saleType` en el `FormData` en vez de `priceTier` por ítem.
- Consumido por: Task 4 (`SalePanel`).

- [ ] **Step 1: Cambiar el schema de validación**

Reemplazar:

```typescript
const saleItemSchema = z.object({
  productId: z.string().uuid(),
  priceTier: z.enum(["sf", "cf", "may"]),
  unitPriceBs: z.number().nonnegative(),
  quantity: z.number().int().positive(),
});

const createSaleSchema = z.object({
  customerId: z.string().uuid().nullable(),
  items: z.array(saleItemSchema).min(1, "Agrega al menos un producto."),
});
```

por:

```typescript
const saleItemSchema = z.object({
  productId: z.string().uuid(),
  unitPriceBs: z.number().nonnegative(),
  quantity: z.number().int().positive(),
});

const createSaleSchema = z.object({
  customerId: z.string().uuid().nullable(),
  saleType: z.enum(SALE_TYPES as [SaleType, ...SaleType[]]),
  items: z.array(saleItemSchema).min(1, "Agrega al menos un producto."),
});
```

Agregar el import al inicio del archivo:

```typescript
import { SALE_TYPES, priceTierForSaleType, type SaleType } from "@/lib/saleType";
```

- [ ] **Step 2: Leer `saleType` del `FormData` en `createSale`**

En el bloque de parseo (donde hoy se lee `itemsRaw`/`customerIdRaw`), agregar:

```typescript
  const parsed = createSaleSchema.safeParse({
    customerId: customerIdRaw ? String(customerIdRaw) : null,
    saleType: formData.get("saleType"),
    items: itemsRaw,
  });
```

- [ ] **Step 3: Insertar `sale_type` en el insert de `sales`**

En el bloque "3) Crear la venta y sus líneas", el `.insert({...})` de `sales`
agrega `sale_type: parsed.data.saleType,`.

- [ ] **Step 4: Derivar `price_tier` server-side en `itemsPayload`**

Reemplazar `price_tier: item.priceTier,` por
`price_tier: priceTierForSaleType(parsed.data.saleType),` en el `.map()` que
arma `itemsPayload`.

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: error esperado en `components/ventas/SalePanel.tsx` (todavía manda
`priceTier` por ítem, sin `saleType`) — se corrige en Task 4. Confirmar que
el único error nuevo está en ese archivo, no en `actions.ts`.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/ventas/actions.ts"
git commit -m "feat: derive price_tier server-side from sale_type in createSale"
```

---

### Task 4: `SalePanel.tsx` — un tipo de venta por carrito, tabla a 1 fila/producto

**Files:**
- Modify: `components/ventas/SalePanel.tsx`

**Interfaces:**
- Consumes: `SaleType`/`SALE_TYPES`/`SALE_TYPE_LABEL`/`priceTierForSaleType` (Task 2), `createSale` actualizado (Task 3).
- Produces: UI de `/ventas` con selector de tipo de venta y 1 fila por producto.

- [ ] **Step 1: Reescribir el componente**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { calculateLineSubtotal, calculateSaleTotal } from "@/lib/sales";
import { SALE_TYPES, SALE_TYPE_LABEL, priceTierForSaleType, type SaleType } from "@/lib/saleType";
import { createSale } from "@/app/(dashboard)/ventas/actions";

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

type CartLine = {
  productId: string;
  code: string;
  unitPriceBs: string;
  quantity: string;
  maxStock: number;
};

function formatMm(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

function priceForSaleType(product: ProductResult, saleType: SaleType): number {
  const tier = priceTierForSaleType(saleType);
  if (tier === "sf") return product.priceSfBs;
  if (tier === "cf") return product.priceCfBs;
  return product.priceMayBs;
}

export function SalePanel({
  products,
  customers,
}: {
  products: ProductResult[];
  customers: { id: string; full_name: string }[];
}) {
  const [saleType, setSaleType] = useState<SaleType>("sin_factura");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function addToCart(product: ProductResult) {
    setCart((prev) => [
      ...prev,
      {
        productId: product.id,
        code: product.code,
        unitPriceBs: String(priceForSaleType(product, saleType)),
        quantity: "1",
        maxStock: product.stock,
      },
    ]);
  }

  // Una venta = un solo tipo: si cambia el tipo con productos ya en el
  // carrito, recalcula el precio de todas las líneas al nuevo tipo.
  function changeSaleType(next: SaleType) {
    setSaleType(next);
    setCart((prev) =>
      prev.map((line) => {
        const product = products.find((p) => p.id === line.productId);
        if (!product) return line;
        return { ...line, unitPriceBs: String(priceForSaleType(product, next)) };
      }),
    );
  }

  function updateLine(index: number, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  const total = calculateSaleTotal(
    cart.map((l) => ({
      unitPriceBs: Number(l.unitPriceBs) || 0,
      quantity: Number(l.quantity) || 0,
    })),
  );

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
    if (customerId) formData.set("customerId", customerId);
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
    setCustomerId("");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="overflow-x-auto lg:col-span-2">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Marca</th>
              <th className="px-3 py-2">Stock</th>
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
                <tr
                  key={p.id}
                  className={`border-b border-slate-100 ${outOfStock ? "opacity-50" : ""}`}
                >
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{p.code}</p>
                    <p className="text-xs text-slate-500">{p.application || "—"}</p>
                  </td>
                  <td className="px-3 py-2">{p.brandName}</td>
                  <td className={`px-3 py-2 ${outOfStock ? "text-red-500" : ""}`}>{p.stock}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={outOfStock}
                      onClick={() => addToCart(p)}
                      className="rounded px-2 py-1 font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                    >
                      {priceForSaleType(p, saleType)}
                    </button>
                  </td>
                  <td className="px-3 py-2">{formatMm(p.internalMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.externalMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.heightMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.flangeMm)}</td>
                  <td className="px-3 py-2">{formatMm(p.stopMm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="h-fit space-y-4 p-4">
        <h3 className="font-semibold text-slate-800">Carrito</h3>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Tipo de venta</span>
          <select
            value={saleType}
            onChange={(e) => changeSaleType(e.target.value as SaleType)}
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
          <span className="mb-1 block text-slate-600">Cliente (opcional)</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={fieldInputClass}
          >
            <option value="">Venta de mostrador</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>

        {cart.length === 0 ? (
          <p className="text-sm text-slate-500">Agrega productos de la lista.</p>
        ) : (
          <ul className="space-y-3">
            {cart.map((line, i) => (
              <li key={i} className="space-y-1 border-b border-slate-100 pb-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700">{line.code}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={line.unitPriceBs}
                    onChange={(e) => updateLine(i, { unitPriceBs: e.target.value })}
                    className={`${fieldInputClass} w-24`}
                  />
                  <input
                    type="number"
                    min={1}
                    max={line.maxStock}
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className={`${fieldInputClass} w-20`}
                  />
                  <span className="flex items-center text-slate-500">
                    ={" "}
                    {calculateLineSubtotal({
                      unitPriceBs: Number(line.unitPriceBs) || 0,
                      quantity: Number(line.quantity) || 0,
                    })}{" "}
                    Bs
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-right text-lg font-semibold text-slate-800">Total: {total} Bs</p>

        <Button className="w-full" disabled={loading || cart.length === 0} onClick={onConfirm}>
          {loading ? "Confirmando…" : "Confirmar venta"}
        </Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores (el error esperado de Task 3 Step 5 ya no aparece).

- [ ] **Step 3: Commit**

```bash
git add components/ventas/SalePanel.tsx
git commit -m "feat: single sale_type selector replaces per-line price tier in SalePanel"
```

---

### Task 5: `app/(dashboard)/dashboard/PaymentFilter.tsx` — selector Total/Efectivo/QR

**Files:**
- Create: `app/(dashboard)/dashboard/PaymentFilter.tsx`

**Interfaces:**
- Produces: `export type PaymentFilterValue = "total" | "efectivo" | "qr"`, `export const PAYMENT_FILTER_LABEL: Record<PaymentFilterValue, string>`, `export function PaymentFilter({ value, period }: { value: PaymentFilterValue; period: string })`.
- Consumido por: Task 6 (`page.tsx`).

- [ ] **Step 1: Escribir el componente**

```typescript
"use client";

import { useRouter } from "next/navigation";
import { fieldInputClass } from "@/components/ui/Field";

export type PaymentFilterValue = "total" | "efectivo" | "qr";

export const PAYMENT_FILTER_LABEL: Record<PaymentFilterValue, string> = {
  total: "Ventas Totales",
  efectivo: "Ventas Efectivo",
  qr: "Ventas QR",
};

export function PaymentFilter({ value, period }: { value: PaymentFilterValue; period: string }) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) =>
        router.replace(`/dashboard?period=${period}&payment=${e.target.value}`, { scroll: false })
      }
      className={`${fieldInputClass} w-auto`}
    >
      {(Object.keys(PAYMENT_FILTER_LABEL) as PaymentFilterValue[]).map((v) => (
        <option key={v} value={v}>
          {PAYMENT_FILTER_LABEL[v]}
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
git add "app/(dashboard)/dashboard/PaymentFilter.tsx"
git commit -m "feat: add dashboard payment method filter"
```

---

### Task 6: `page.tsx` del Dashboard — aplicar el filtro de pago

**Files:**
- Modify: `app/(dashboard)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `PaymentFilter`/`PaymentFilterValue`/`PAYMENT_FILTER_LABEL` (Task 5), `paymentMethodForSaleType`... en realidad se filtra por `sale_type in (...)`, no hace falta esa función acá — usar listas literales de `sale_type` por grupo.
- Produces: página `/dashboard` con el filtro de pago aplicado a "Ventas" y "Cantidad de ventas".

- [ ] **Step 1: Agregar el parseo del query param y las listas de tipos por grupo**

En `SearchParams`, agregar `payment?: string`. Agregar debajo de
`isPeriod`:

```typescript
import { PaymentFilter, PAYMENT_FILTER_LABEL, type PaymentFilterValue } from "./PaymentFilter";

const EFECTIVO_TYPES = ["sin_factura", "con_factura", "mayorista"];
const QR_TYPES = ["sin_factura_qr", "con_factura_qr"];

function isPaymentFilter(value: string | undefined): value is PaymentFilterValue {
  return value === "total" || value === "efectivo" || value === "qr";
}
```

- [ ] **Step 2: Resolver el filtro y aplicarlo a la query de `sales`**

```typescript
  const payment: PaymentFilterValue = isPaymentFilter(sp.payment) ? sp.payment : "total";
```

Reemplazar el bloque que arma la query de `sales`:

```typescript
      (async () => {
        let query = supabase.from("sales").select("total_bs");
        if (since) query = query.gte("created_at", since.toISOString());
        if (payment === "efectivo") query = query.in("sale_type", EFECTIVO_TYPES);
        if (payment === "qr") query = query.in("sale_type", QR_TYPES);
        return query;
      })(),
```

- [ ] **Step 3: Agregar el selector al header y a las etiquetas de las tarjetas**

En `PageHeader`, el `action` pasa a incluir ambos selectores:

```typescript
        action={
          <div className="flex gap-2">
            <PeriodSelect value={period} />
            <PaymentFilter value={payment} period={period} />
          </div>
        }
```

Y las etiquetas de las 2 tarjetas de ventas pasan a incluir el filtro de
pago:

```typescript
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
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/dashboard/page.tsx"
git commit -m "feat: apply payment method filter to dashboard sales stats"
```

---

### Task 7: Verificación manual end-to-end

**Files:** ninguno (solo verificación interactiva, no se escribe código).

- [ ] **Step 1: Probar `/ventas` con cada tipo**

Entrar a `/ventas`, agregar un producto al carrito con "Sin Factura"
seleccionado (verificar que el precio mostrado es el SF), cambiar a "Con
Factura" (el precio del carrito debe recalcularse al CF), agregar otro
producto, confirmar la venta. Repetir con "Sin Factura QR"/"Con Factura
QR"/"Mayorista" para confirmar que cada uno usa el precio correcto.

- [ ] **Step 2: Verificar en la DB**

```sql
select id, sale_type, total_bs from sales order by created_at desc limit 5;
select price_tier, quantity, subtotal_bs from sale_items where sale_id = '<id de la última venta>';
```

Confirmar que `price_tier` de cada línea coincide con la tabla de mapeo de
la Sección 1 del spec para el `sale_type` de esa venta.

- [ ] **Step 3: Probar el filtro del Dashboard**

Con al menos una venta "Sin Factura" (efectivo) y una "Sin Factura QR" (qr)
ya confirmadas, ir a `/dashboard`. Cambiar el selector de pago entre Total/
Efectivo/QR y verificar que "Ventas" y "Cantidad de ventas" cambian según
corresponda, y que "Top productos"/"Stock bajo" no cambian.
