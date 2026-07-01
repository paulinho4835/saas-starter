# Ajuste de Inventario — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo `/ajuste-inventario` con ajuste manual rápido de stock por producto/sucursal (Agregar/Reducir) y un historial global filtrable de todos los movimientos de stock (alta de producto, importación, ajuste manual, venta), retrofiteando los 4 puntos existentes que ya escriben stock para que también dejen rastro en el nuevo ledger `stock_movements`.

**Architecture:** Tabla `stock_movements` inmutable (solo `select`/`insert` vía RLS), alimentada desde 4 server actions ya existentes (`createProduct`, `updateProductStock`, `confirmProductImport`, `createSale`) más una nueva (`adjustStock`). Todas las escrituras siguen el patrón ya establecido en Fase 1/Fase 2: sin RPC/triggers de Postgres, locking optimista donde hay concurrencia real, y reversión compensatoria si un paso posterior falla. Página nueva con dos bloques Server-Component (listado de stock con filtros GET, historial con filtros GET) más un componente cliente para el modal de ajuste.

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (Postgres + RLS), Zod, Tailwind, Vitest.

## Global Constraints

- Toda tabla nueva: `org_id` + RLS contra `auth_org_id()`, igual que `0001_init.sql`/`0002_productos.sql`/`0004_ventas.sql`. Los grants de `0003_grants.sql` (`alter default privileges`) ya cubren tablas futuras — no hace falta un grant explícito para `stock_movements`.
- `stock_movements` es un **ledger inmutable**: únicamente políticas RLS `select`/`insert`, sin `update`/`delete` — mismo patrón que `sales`/`sale_items`.
- Español neutro en toda la UI (sin voseo).
- RBAC de 4 roles fijos (`admin`/`manager`/`member`/`viewer`) vía `lib/rbac.ts` — no se agregan roles nuevos. El módulo completo (ver + ajustar) usa el permiso existente **`productos:write`** (admin + manager).
- Nuevo feature flag **`ajuste_inventario`**, opt-in (apagado por defecto) — cada página del sidebar tiene su propio `FeatureKey` 1:1 en este código (confirmado en `lib/guard.ts::requireNavAccess`); no existe mecanismo para que una página "herede" el flag de otra.
- **`org_id` siempre sale del perfil verificado en el servidor (`getProfile()`), nunca de un campo del cliente.** `branchId` recibido del cliente se valida con `verifyBranchInOrg` (mismo helper que ya usan `createProduct`/`updateProductStock`) antes de usarse.
- El stock nunca puede quedar negativo — mismo criterio que ya aplica en `createSale`.
- Todas las escrituras de stock que ahora también escriben en `stock_movements` deben revertir el cambio de stock si la escritura del movimiento falla (patrón de compensación, no de transacción de DB).
- Fuera de alcance (no implementar en esta fase): Traspasos, Devoluciones, Reporte Producto, Reporte Ventas; link clickeable desde un movimiento tipo `venta` hacia el detalle de la venta; columna `created_by` en `products`.

---

### Task 1: Migración — tabla `stock_movements`

**Files:**
- Create: `supabase/migrations/0005_ajuste_inventario.sql`

**Interfaces:**
- Produces: tabla `stock_movements` (`id, org_id, product_id, branch_id, movement_type, quantity_delta, resulting_quantity, reason, actor_id, sale_id, created_at`).
- Consumido por: Tasks 4, 5, 6, 7, 8, 10.

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- Ajuste de Inventario: historial de movimientos de stock.
-- Ver docs/superpowers/specs/2026-07-01-ajuste-inventario-design.md
-- ============================================================================

create table stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations (id) on delete cascade,
  product_id         uuid not null references products (id) on delete cascade,
  branch_id          uuid not null references branches (id),
  movement_type      text not null check (movement_type in ('alta_inicial', 'importacion', 'ajuste_manual', 'venta')),
  quantity_delta     integer not null,
  resulting_quantity integer not null,
  reason             text,
  actor_id           uuid references profiles (id) on delete set null,
  sale_id            uuid references sales (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index stock_movements_org_product_idx on stock_movements (org_id, product_id, created_at desc);
create index stock_movements_org_branch_idx on stock_movements (org_id, branch_id, created_at desc);

-- ============================================================================
-- RLS — ledger inmutable: solo select/insert, mismo patrón que sales/sale_items
-- (0004_ventas.sql). Sin update/delete: un movimiento ya registrado no se edita.
-- ============================================================================
alter table stock_movements enable row level security;

create policy stock_movements_select on stock_movements for select using (org_id = auth_org_id());
create policy stock_movements_insert on stock_movements for insert with check (org_id = auth_org_id());
```

- [ ] **Step 2: Aplicar y verificar**

Run: `npm run db:reset`
Expected: termina sin errores; el log muestra `Applying migration 0005_ajuste_inventario.sql...` sin warnings de tipo error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_ajuste_inventario.sql
git commit -m "feat(db): add stock_movements immutable ledger table"
```

---

### Task 2: `lib/stockMovements.ts` — tipos y helpers compartidos

**Files:**
- Create: `lib/stockMovements.ts`
- Test: `lib/stockMovements.test.ts`

**Interfaces:**
- Produces: `type MovementType`, `MOVEMENT_TYPES: MovementType[]`, `movementTypeLabel(type: MovementType): string`.
- Consumido por: Task 10 (`MOVEMENT_TYPES` para el selector de filtro, `movementTypeLabel` para mostrar cada fila). Tasks 4-8 escriben en `stock_movements` con el literal string del `movement_type` directamente (validado por el `check` constraint de la migración, Task 1), sin importar este archivo.

- [ ] **Step 1: Escribir el archivo**

```typescript
// lib/stockMovements.ts
// Tipos compartidos del ledger stock_movements. La escritura real vive en cada
// server action que toca stock (createProduct, updateProductStock,
// confirmProductImport, createSale, adjustStock) — este archivo solo evita
// repetir el union type y la etiqueta en español en cada uno de esos sitios.

export type MovementType = "alta_inicial" | "importacion" | "ajuste_manual" | "venta";

export const MOVEMENT_TYPES: MovementType[] = [
  "alta_inicial",
  "importacion",
  "ajuste_manual",
  "venta",
];

const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  alta_inicial: "Alta inicial",
  importacion: "Importación",
  ajuste_manual: "Ajuste manual",
  venta: "Venta",
};

export function movementTypeLabel(type: MovementType): string {
  return MOVEMENT_TYPE_LABEL[type];
}
```

- [ ] **Step 2: Escribir el test**

```typescript
// lib/stockMovements.test.ts
import { describe, expect, it } from "vitest";
import { movementTypeLabel, MOVEMENT_TYPES } from "./stockMovements";

describe("movementTypeLabel", () => {
  it("returns the Spanish label for each movement type", () => {
    expect(movementTypeLabel("alta_inicial")).toBe("Alta inicial");
    expect(movementTypeLabel("importacion")).toBe("Importación");
    expect(movementTypeLabel("ajuste_manual")).toBe("Ajuste manual");
    expect(movementTypeLabel("venta")).toBe("Venta");
  });

  it("has one label for every declared movement type", () => {
    for (const type of MOVEMENT_TYPES) {
      expect(movementTypeLabel(type).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Correr los tests**

Run: `npx vitest run lib/stockMovements.test.ts`
Expected: 2 tests pasan.

- [ ] **Step 4: Commit**

```bash
git add lib/stockMovements.ts lib/stockMovements.test.ts
git commit -m "feat: add stock_movements shared types and labels"
```

---

### Task 3: Feature flag + nav + permiso

**Files:**
- Modify: `lib/features.ts`
- Modify: `lib/rbac.ts`
- Modify: `components/Sidebar.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `FeatureKey` incluye `"ajuste_inventario"`; `canSeeNav("admin"|"manager", "ajuste_inventario")` → `true`; `canSeeNav("member"|"viewer", "ajuste_inventario")` → `false`.
- Consumido por: Task 10 (`requireNavAccess("ajuste_inventario")`).

- [ ] **Step 1: Agregar el `FeatureKey` y la entrada en `FEATURES`**

En `lib/features.ts`, modifica el union type:

```typescript
export type FeatureKey =
  | "dashboard"
  | "clientes"
  | "items"
  | "productos"
  | "proveedores"
  | "ventas"
  | "ajuste_inventario"
  | "ajustes"
  | "auditoria";
```

Y agrega la entrada en `FEATURES`, entre `ventas` y `ajustes` (mismo orden del sidebar legado: Ventas → Ajuste de Inventario):

```typescript
export const FEATURES: FeatureMeta[] = [
  { key: "dashboard", label: "Inicio", href: "/dashboard", core: true },
  { key: "clientes", label: "Clientes", href: "/clientes" },
  { key: "items", label: "Inventario", href: "/items", optIn: true },
  { key: "productos", label: "Productos", href: "/productos", optIn: true },
  { key: "proveedores", label: "Proveedores", href: "/proveedores", optIn: true },
  { key: "ventas", label: "Ventas", href: "/ventas", optIn: true },
  { key: "ajuste_inventario", label: "Ajuste de Inventario", href: "/ajuste-inventario", optIn: true },
  { key: "ajustes", label: "Ajustes", href: "/ajustes", core: true },
  { key: "auditoria", label: "Auditoría", href: "/auditoria", optIn: true },
];
```

- [ ] **Step 2: Agregar el nav item a `NAV_WHITELIST` en `lib/rbac.ts`**

Modifica `admin` y `manager` (deja `member`/`viewer` sin el módulo, mismos roles que tienen `productos:write`):

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
  ],
  member: ["dashboard", "clientes", "productos", "proveedores", "ventas"],
  viewer: ["dashboard", "clientes", "productos", "proveedores"],
};
```

- [ ] **Step 3: Agregar el ícono en `components/Sidebar.tsx`**

Agrega `History` a los imports de `lucide-react` y una entrada en `ICONS`:

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
  History,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
```

```typescript
const ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/clientes": Users,
  "/items": Package,
  "/productos": Wrench,
  "/proveedores": Truck,
  "/ajuste-inventario": History,
  "/ajustes": Settings,
  "/auditoria": ShieldCheck,
};
```

- [ ] **Step 4: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 5: Commit**

```bash
git add lib/features.ts lib/rbac.ts components/Sidebar.tsx
git commit -m "feat: add ajuste_inventario feature flag, nav entry and permission scope"
```

---

### Task 4: Retrofit `createProduct` — movimiento `alta_inicial`

**Files:**
- Modify: `app/(dashboard)/productos/actions.ts:205-229` (función `createProduct`)

**Interfaces:**
- Consumes: tabla `stock_movements` (Task 1).
- Produces: cada `createProduct` exitoso deja exactamente 1 fila en `stock_movements` con `movement_type = 'alta_inicial'`.

- [ ] **Step 1: Reemplazar el bloque final de `createProduct`**

Reemplaza desde `const { error: stockError } = await supabase.from("product_stock").insert({` hasta el final de la función (justo antes del cierre `}` de `createProduct`, líneas 205-229 actuales) por:

```typescript
  const { error: stockError } = await supabase.from("product_stock").insert({
    org_id: profile.orgId,
    product_id: product.id,
    branch_id: branchId,
    quantity,
  });
  if (stockError) {
    console.error("createProduct stock:", stockError.message);
    const { error: rollbackError } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id);
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
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/productos/actions.ts
git commit -m "feat: record alta_inicial stock movement when creating a product"
```

---

### Task 5: Retrofit `updateProductStock` — movimiento `ajuste_manual`

**Files:**
- Modify: `app/(dashboard)/productos/actions.ts:311-348` (función `updateProductStock`)

**Interfaces:**
- Consumes: tabla `stock_movements` (Task 1).
- Produces: cada `updateProductStock` que cambia la cantidad deja 1 fila en `stock_movements` con `movement_type = 'ajuste_manual'` y `reason = 'Editado desde ficha de producto'`. Si la cantidad no cambia, no se inserta movimiento.

- [ ] **Step 1: Reemplazar la función completa**

Reemplaza toda la función `updateProductStock` (líneas 311-348 actuales) por:

```typescript
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
  const branchValid = await verifyBranchInOrg(supabase, branchId, profile.orgId);
  if (!branchValid) {
    return { ok: false, error: "La sucursal seleccionada no es válida." };
  }

  const { data: existingStock } = await supabase
    .from("product_stock")
    .select("quantity")
    .eq("product_id", productId)
    .eq("branch_id", branchId)
    .maybeSingle();
  const previousQuantity = existingStock?.quantity ?? 0;

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

  if (quantity !== previousQuantity) {
    const { error: movementError } = await supabase.from("stock_movements").insert({
      org_id: profile.orgId,
      product_id: productId,
      branch_id: branchId,
      movement_type: "ajuste_manual",
      quantity_delta: quantity - previousQuantity,
      resulting_quantity: quantity,
      reason: "Editado desde ficha de producto",
      actor_id: profile.userId,
      sale_id: null,
    });
    if (movementError) {
      console.error("updateProductStock movement:", movementError.message);
      if (existingStock) {
        await supabase
          .from("product_stock")
          .update({ quantity: previousQuantity })
          .eq("product_id", productId)
          .eq("branch_id", branchId);
      } else {
        await supabase
          .from("product_stock")
          .delete()
          .eq("product_id", productId)
          .eq("branch_id", branchId);
      }
      return {
        ok: false,
        error: "No se pudo registrar el historial de stock. El cambio fue revertido.",
      };
    }
  }

  revalidatePath("/productos");
  return { ok: true };
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/productos/actions.ts
git commit -m "feat: record ajuste_manual stock movement when editing stock from product form"
```

---

### Task 6: Retrofit `confirmProductImport` — movimiento `importacion`

**Files:**
- Modify: `app/(dashboard)/productos/import-actions.ts:270-299` (función `confirmProductImport`, paso 3)

**Interfaces:**
- Consumes: tabla `stock_movements` (Task 1); `chunk()` y `IMPORT_BATCH_SIZE` ya definidos en el mismo archivo.
- Produces: cada producto importado con cambio de cantidad deja 1 fila en `stock_movements` con `movement_type = 'importacion'`.

- [ ] **Step 1: Reemplazar el paso 3 (upsert de stock) y el return final**

Reemplaza desde el comentario `// 3) Upsert de stock para la sucursal elegida...` (línea 270 actual) hasta el final de la función por:

```typescript
  // 3) Upsert de stock para la sucursal elegida (reemplaza la cantidad existente).
  // Usa el mismo mapa deduplicado del paso 2 para que el stock salga de la
  // misma fila (la más reciente) que definió los precios del producto.
  const stockPayload = upsertedProducts.map((p) => {
    const row = rowByCodeAndBrandId.get(`${p.code}::${p.brand_id}`)!;
    return {
      org_id: orgId,
      product_id: p.id,
      branch_id: branchId,
      quantity: row.stock,
      updated_at: new Date().toISOString(),
    };
  });

  // Cantidades previas por producto, para calcular el delta de cada movimiento
  // de stock. Un producto sin fila de stock previa en esta sucursal parte de 0.
  const previousQuantityByProduct = new Map<string, number>();
  for (const batch of chunk(upsertedProducts.map((p) => p.id), IMPORT_BATCH_SIZE)) {
    const { data: existingStockRows } = await supabase
      .from("product_stock")
      .select("product_id, quantity")
      .eq("branch_id", branchId)
      .in("product_id", batch);
    for (const row of existingStockRows ?? []) {
      previousQuantityByProduct.set(row.product_id as string, row.quantity as number);
    }
  }

  for (const batch of chunk(stockPayload, IMPORT_BATCH_SIZE)) {
    const { error } = await supabase
      .from("product_stock")
      .upsert(batch, { onConflict: "product_id,branch_id" });
    if (error) {
      console.error("confirmProductImport stock:", error.message);
      return {
        ok: false,
        error: "Los productos se guardaron, pero no se pudo actualizar el stock.",
      };
    }

    // Historial de movimientos: no bloquea el import si falla. Los datos de
    // stock ya quedaron guardados arriba; revertir miles de filas de producto
    // por un fallo en el log de auditoría sería peor que perder ese registro,
    // así que solo se deja constancia en el log del servidor.
    const movementsPayload = batch
      .filter((s) => s.quantity !== (previousQuantityByProduct.get(s.product_id) ?? 0))
      .map((s) => ({
        org_id: orgId,
        product_id: s.product_id,
        branch_id: s.branch_id,
        movement_type: "importacion" as const,
        quantity_delta: s.quantity - (previousQuantityByProduct.get(s.product_id) ?? 0),
        resulting_quantity: s.quantity,
        reason: null,
        actor_id: profile.userId,
        sale_id: null,
      }));
    if (movementsPayload.length > 0) {
      const { error: movementError } = await supabase
        .from("stock_movements")
        .insert(movementsPayload);
      if (movementError) {
        console.error("confirmProductImport movements:", movementError.message);
      }
    }
  }

  revalidatePath("/productos");
  return { ok: true, imported: stockPayload.length };
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/productos/import-actions.ts
git commit -m "feat: record importacion stock movements during bulk product import"
```

---

### Task 7: Retrofit `createSale` — movimiento `venta`

**Files:**
- Modify: `app/(dashboard)/ventas/actions.ts:156-174` (final de `createSale`)

**Interfaces:**
- Consumes: tabla `stock_movements` (Task 1); variables ya existentes en la función: `orgId`, `branchId`, `profile`, `stockByProduct`, `decremented`, `revertDecrements()`.
- Produces: cada línea de una venta confirmada deja 1 fila en `stock_movements` con `movement_type = 'venta'` y `sale_id` seteado.

- [ ] **Step 1: Reemplazar el bloque final de `createSale`**

Reemplaza desde `const itemsPayload = parsed.data.items.map((item) => ({` hasta el final de la función (líneas 156-174 actuales) por:

```typescript
  const itemsPayload = parsed.data.items.map((item) => ({
    sale_id: sale.id,
    product_id: item.productId,
    price_tier: item.priceTier,
    unit_price_bs: item.unitPriceBs,
    quantity: item.quantity,
    subtotal_bs: calculateLineSubtotal(item),
  }));
  const { error: itemsError } = await supabase.from("sale_items").insert(itemsPayload);
  if (itemsError) {
    await supabase.from("sales").delete().eq("id", sale.id);
    await revertDecrements();
    console.error("createSale items:", itemsError.message);
    return { ok: false, error: "No se pudo registrar la venta. Tu stock no fue afectado." };
  }

  // 4) Historial de movimientos: una fila por línea vendida, ligada a la venta.
  const movementsPayload = parsed.data.items.map((item) => {
    const original = stockByProduct.get(item.productId)!;
    return {
      org_id: orgId,
      product_id: item.productId,
      branch_id: branchId,
      movement_type: "venta" as const,
      quantity_delta: -item.quantity,
      resulting_quantity: original - item.quantity,
      reason: null,
      actor_id: profile.userId,
      sale_id: sale.id,
    };
  });
  const { error: movementsError } = await supabase
    .from("stock_movements")
    .insert(movementsPayload);
  if (movementsError) {
    await supabase.from("sale_items").delete().eq("sale_id", sale.id);
    await supabase.from("sales").delete().eq("id", sale.id);
    await revertDecrements();
    console.error("createSale movements:", movementsError.message);
    return { ok: false, error: "No se pudo registrar la venta. Tu stock no fue afectado." };
  }

  revalidatePath("/ventas");
  return { ok: true, saleId: sale.id, total };
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck && npm test`
Expected: 0 errores de tipo; los 18 tests existentes siguen pasando (esta función no tiene tests propios — se cubre en Task 11).

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/ventas/actions.ts
git commit -m "feat: record venta stock movements when confirming a sale"
```

---

### Task 8: `adjustStock` — nueva server action

**Files:**
- Create: `app/(dashboard)/ajuste-inventario/actions.ts`

**Interfaces:**
- Consumes: `getProfile()` (`lib/auth.ts`), `can()` (`lib/rbac.ts`), `verifyBranchInOrg()` (`lib/catalogs.ts`), tabla `stock_movements` (Task 1).
- Produces: `adjustStock(formData: FormData): Promise<AdjustStockResult>` donde `AdjustStockResult = { ok: true } | { ok: false; error: string }`. `formData` espera los campos `productId`, `branchId`, `direction` (`"add" | "reduce"`), `amount` (entero positivo), `reason` (texto no vacío).
- Consumido por: Task 9 (`AdjustStockButton`).

- [ ] **Step 1: Escribir el archivo**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { verifyBranchInOrg } from "@/lib/catalogs";

export type AdjustStockResult = { ok: true } | { ok: false; error: string };

const adjustSchema = z.object({
  productId: z.string().uuid(),
  branchId: z.string().uuid(),
  direction: z.enum(["add", "reduce"]),
  amount: z.coerce.number().int().positive("La cantidad debe ser un entero mayor a 0."),
  reason: z.string().trim().min(1, "El motivo es obligatorio.").max(300),
});

// Ajuste manual de stock desde /ajuste-inventario: descuenta o suma stock con
// bloqueo optimista (misma condición `.eq("quantity", currentQuantity)` que ya
// usa createSale) y deja constancia en stock_movements. Si el registro del
// movimiento falla después de tocar el stock, revierte el cambio.
export async function adjustStock(formData: FormData): Promise<AdjustStockResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para ajustar el stock." };
  }

  const parsed = adjustSchema.safeParse({
    productId: formData.get("productId"),
    branchId: formData.get("branchId"),
    direction: formData.get("direction"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const branchValid = await verifyBranchInOrg(supabase, parsed.data.branchId, profile.orgId);
  if (!branchValid) {
    return { ok: false, error: "La sucursal seleccionada no es válida." };
  }

  const { data: stockRow } = await supabase
    .from("product_stock")
    .select("quantity")
    .eq("product_id", parsed.data.productId)
    .eq("branch_id", parsed.data.branchId)
    .maybeSingle();
  const currentQuantity = stockRow?.quantity ?? 0;

  const delta = parsed.data.direction === "add" ? parsed.data.amount : -parsed.data.amount;
  const newQuantity = currentQuantity + delta;
  if (newQuantity < 0) {
    return { ok: false, error: "No puedes reducir más stock del disponible." };
  }

  if (stockRow) {
    const { data: updated } = await supabase
      .from("product_stock")
      .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
      .eq("product_id", parsed.data.productId)
      .eq("branch_id", parsed.data.branchId)
      .eq("quantity", currentQuantity)
      .select("quantity")
      .maybeSingle();
    if (!updated) {
      return {
        ok: false,
        error: "El stock cambió mientras hacías el ajuste. Vuelve a intentarlo.",
      };
    }
  } else {
    const { error: insertError } = await supabase.from("product_stock").insert({
      org_id: profile.orgId,
      product_id: parsed.data.productId,
      branch_id: parsed.data.branchId,
      quantity: newQuantity,
    });
    if (insertError) {
      console.error("adjustStock insert:", insertError.message);
      return { ok: false, error: "No se pudo registrar el stock." };
    }
  }

  const { error: movementError } = await supabase.from("stock_movements").insert({
    org_id: profile.orgId,
    product_id: parsed.data.productId,
    branch_id: parsed.data.branchId,
    movement_type: "ajuste_manual",
    quantity_delta: delta,
    resulting_quantity: newQuantity,
    reason: parsed.data.reason,
    actor_id: profile.userId,
    sale_id: null,
  });
  if (movementError) {
    console.error("adjustStock movement:", movementError.message);
    if (stockRow) {
      await supabase
        .from("product_stock")
        .update({ quantity: currentQuantity })
        .eq("product_id", parsed.data.productId)
        .eq("branch_id", parsed.data.branchId);
    } else {
      await supabase
        .from("product_stock")
        .delete()
        .eq("product_id", parsed.data.productId)
        .eq("branch_id", parsed.data.branchId);
    }
    return { ok: false, error: "No se pudo registrar el ajuste. El cambio fue revertido." };
  }

  revalidatePath("/ajuste-inventario");
  return { ok: true };
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/ajuste-inventario/actions.ts
git commit -m "feat: add adjustStock server action"
```

---

### Task 9: `AdjustStockButton` — modal cliente Agregar/Reducir

**Files:**
- Create: `components/ajuste-inventario/AdjustStockButton.tsx`

**Interfaces:**
- Consumes: `adjustStock` (Task 8), `Modal`/`Button`/`Field` (`components/ui`), `toast` (`lib/toast.ts`).
- Produces: `<AdjustStockButton productId branchId direction="add" | "reduce" />`.
- Consumido por: Task 10 (`page.tsx`).

- [ ] **Step 1: Escribir el componente**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { adjustStock } from "@/app/(dashboard)/ajuste-inventario/actions";

export function AdjustStockButton({
  productId,
  branchId,
  direction,
}: {
  productId: string;
  branchId: string;
  direction: "add" | "reduce";
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onConfirm() {
    setLoading(true);
    const formData = new FormData();
    formData.set("productId", productId);
    formData.set("branchId", branchId);
    formData.set("direction", direction);
    formData.set("amount", amount);
    formData.set("reason", reason);
    const res = await adjustStock(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(direction === "add" ? "Stock agregado." : "Stock reducido.");
    setOpen(false);
    setAmount("1");
    setReason("");
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant={direction === "add" ? "secondary" : "danger"}
        onClick={() => setOpen(true)}
      >
        {direction === "add" ? "Agregar" : "Reducir"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={direction === "add" ? "Agregar stock" : "Reducir stock"}
      >
        <div className="space-y-3">
          <Field
            label="Cantidad"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Field
            label="Motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Conteo físico, mercadería dañada, corrección de captura"
          />
          <Button
            className="w-full"
            disabled={loading || !reason.trim() || Number(amount) <= 0}
            onClick={onConfirm}
          >
            {loading ? "Guardando…" : "Confirmar"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add components/ajuste-inventario/AdjustStockButton.tsx
git commit -m "feat: add AdjustStockButton modal component"
```

---

### Task 10: `/ajuste-inventario` — página con listado de stock e historial

**Files:**
- Create: `app/(dashboard)/ajuste-inventario/page.tsx`

**Interfaces:**
- Consumes: `requireNavAccess` (`lib/guard.ts`), `can` (`lib/rbac.ts`), `getProfile` (`lib/auth.ts`), `escapePostgrestFilterValue` (`lib/postgrest.ts`), `movementTypeLabel`/`MOVEMENT_TYPES` (`lib/stockMovements.ts`, Task 2), `AdjustStockButton` (Task 9).
- Produces: página `/ajuste-inventario`.

- [ ] **Step 1: Escribir la página**

```tsx
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireNavAccess } from "@/lib/guard";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { movementTypeLabel, MOVEMENT_TYPES, type MovementType } from "@/lib/stockMovements";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { AdjustStockButton } from "@/components/ajuste-inventario/AdjustStockButton";

const PAGE_SIZE = 25;

type SearchParams = {
  code?: string;
  branchId?: string;
  hcode?: string;
  hbranchId?: string;
  htype?: string;
  hfrom?: string;
  hto?: string;
  hpage?: string;
};

type StockRow = {
  id: string;
  product_id: string;
  branch_id: string;
  quantity: number;
  products: { code: string } | null;
  branches: { name: string } | null;
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

const STOCK_SELECT =
  "id, product_id, branch_id, quantity, products!inner(code), branches!inner(name)";
const MOVEMENT_SELECT =
  "id, movement_type, quantity_delta, resulting_quantity, reason, sale_id, created_at, products!inner(code), branches!inner(name), profiles(full_name)";

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

  // ── Bloque "Productos": stock actual, filtrable por código y sucursal ────
  let stockQuery = supabase.from("product_stock").select(STOCK_SELECT).order("branch_id").limit(100);
  if (sp.code) stockQuery = stockQuery.ilike("products.code", `%${escapePostgrestFilterValue(sp.code)}%`);
  if (sp.branchId) stockQuery = stockQuery.eq("branch_id", sp.branchId);
  const { data: stockData } = await stockQuery;
  const stockRows = (stockData ?? []) as unknown as StockRow[];

  // ── Bloque "Historial": movimientos, filtrable por código, sucursal, tipo y fecha ──
  const hpage = Math.max(1, Number(sp.hpage) || 1);
  let movementsQuery = supabase
    .from("stock_movements")
    .select(MOVEMENT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((hpage - 1) * PAGE_SIZE, hpage * PAGE_SIZE - 1);
  if (sp.hcode)
    movementsQuery = movementsQuery.ilike("products.code", `%${escapePostgrestFilterValue(sp.hcode)}%`);
  if (sp.hbranchId) movementsQuery = movementsQuery.eq("branch_id", sp.hbranchId);
  if (sp.htype) movementsQuery = movementsQuery.eq("movement_type", sp.htype);
  if (sp.hfrom) movementsQuery = movementsQuery.gte("created_at", sp.hfrom);
  if (sp.hto) movementsQuery = movementsQuery.lte("created_at", `${sp.hto}T23:59:59`);
  const { data: movementsData, count: movementsCount } = await movementsQuery;
  const movementRows = (movementsData ?? []) as unknown as MovementRow[];
  const totalMovements = movementsCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalMovements / PAGE_SIZE));

  function buildHistorialHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.code) params.set("code", sp.code);
    if (sp.branchId) params.set("branchId", sp.branchId);
    if (sp.hcode) params.set("hcode", sp.hcode);
    if (sp.hbranchId) params.set("hbranchId", sp.hbranchId);
    if (sp.htype) params.set("htype", sp.htype);
    if (sp.hfrom) params.set("hfrom", sp.hfrom);
    if (sp.hto) params.set("hto", sp.hto);
    params.set("hpage", String(targetPage));
    return `/ajuste-inventario?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ajuste de Inventario" />

      {/* ── Productos ─────────────────────────────────────────────────── */}
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <input type="hidden" name="hpage" value="1" />
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
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Sin resultados"
            description="Ajusta los filtros de búsqueda."
          />
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

      {/* ── Historial de movimientos ──────────────────────────────────── */}
      <PageHeader title="Historial de movimientos" subtitle={`${totalMovements} registrado(s)`} />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Código</span>
            <input type="text" name="hcode" defaultValue={sp.hcode ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Sucursal</span>
            <select name="hbranchId" defaultValue={sp.hbranchId ?? ""} className={fieldInputClass}>
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
            <select name="htype" defaultValue={sp.htype ?? ""} className={fieldInputClass}>
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
            <input type="date" name="hfrom" defaultValue={sp.hfrom ?? ""} className={fieldInputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Hasta</span>
            <input type="date" name="hto" defaultValue={sp.hto ?? ""} className={fieldInputClass} />
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
          {hpage > 1 ? (
            <ButtonLink variant="secondary" size="sm" href={buildHistorialHref(hpage - 1)}>
              Anterior
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Anterior
            </Button>
          )}
          <span>
            Página {hpage} de {totalPages}
          </span>
          {hpage < totalPages ? (
            <ButtonLink variant="secondary" size="sm" href={buildHistorialHref(hpage + 1)}>
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

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/ajuste-inventario/page.tsx
git commit -m "feat: add /ajuste-inventario page with stock list and movement history"
```

---

### Task 11: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Ejecutar el chequeo automatizado completo**

Run: `npm run typecheck && npm test`
Expected: typecheck limpio; todos los tests pasan (18 anteriores + los nuevos de `lib/stockMovements.test.ts`).

- [ ] **Step 2: Activar el feature flag `ajuste_inventario`**

En el SQL Editor local (o vía Studio):

```sql
update organizations set features = features || '{"ajuste_inventario": true}'::jsonb;
```

- [ ] **Step 3: Walkthrough manual**

Con al menos 2 productos con stock en alguna sucursal:

1. Entra a `/ajuste-inventario` como admin o manager. Confirma que aparece el bloque "Productos" con Código/Sucursal/Stock y botones Agregar/Reducir, y el bloque "Historial de movimientos" debajo.
2. Crea un producto nuevo desde `/productos` con stock inicial > 0. Vuelve a `/ajuste-inventario` y confirma que aparece una fila de historial `Alta inicial` con la cantidad correcta y tu nombre como autor.
3. Desde `/ajuste-inventario`, usa "Agregar" en un producto: ingresa cantidad y motivo, confirma. Verifica que el stock sube en la lista y aparece una fila `Ajuste manual` en el historial con el motivo ingresado.
4. Usa "Reducir" con una cantidad mayor al stock disponible — confirma que se bloquea con un mensaje claro y que el stock no cambió.
5. Usa "Reducir" con una cantidad válida y motivo — confirma que el stock baja y aparece el movimiento correspondiente (delta negativo).
6. Realiza una venta desde `/ventas`. Vuelve a `/ajuste-inventario` y confirma que aparece una fila `Venta` por cada producto vendido, con el delta negativo y la referencia a la venta.
7. Importa un archivo de productos desde `/productos` (Importar). Confirma que aparecen filas `Importación` en el historial para los productos cuyo stock cambió.
8. Prueba los filtros del historial: por código, por sucursal, por tipo de movimiento, y por rango de fechas. Confirma que cada uno acota los resultados correctamente.
9. Como usuario `member` o `viewer`, confirma que no puede acceder a `/ajuste-inventario` (redirige a `/dashboard`).

- [ ] **Step 4: Si algo falla, corregir y commit**

```bash
git add -A
git commit -m "fix: address issues found in Ajuste de Inventario end-to-end verification"
```
