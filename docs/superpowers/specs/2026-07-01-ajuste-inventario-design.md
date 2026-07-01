# Ajuste de Inventario — Design Spec

## Contexto

El sistema PHP legado tiene una pantalla "Ajuste de Inventario" que permite ajustar
manualmente el stock de un producto por sucursal (botones Agregar/Reducir) y listar
productos filtrados por Código/Sucursal. Paulo pidió, además del ajuste manual,
trazabilidad completa: cuándo se dio de alta cada producto, quién lo hizo, y cuándo
se vendió — un historial unificado de movimientos de stock.

Este módulo se construye sobre Fase 1 (Productos + Sucursales + Stock) y Fase 2
(Ventas), ambas ya mergeadas. Reutiliza los mismos patrones: server actions con
locking optimista y reversión compensatoria (sin RPC/triggers de Postgres),
RBAC vía `lib/rbac.ts`, feature flags vía `lib/features.ts`, RLS por `org_id`.

## Decisiones previas (de la fase de preguntas)

1. El módulo cubre **ajuste manual de stock + historial de movimientos**, ambos.
2. No se agrega columna `created_by` a `products` — la fecha de alta alcanza
   (no es crítico saber quién creó cada producto históricamente).
3. La vista es una **lista global con filtros**, no un historial por producto aislado.
4. Existe **una tabla única `stock_movements`**, alimentada por todas las vías de
   cambio de stock (alta inicial, importación, ajuste manual, venta).
5. Se **retrofitea** `createProduct`, `updateProductStock` y `confirmProductImport`
   (Fase 1) y `createSale` (Fase 2) para escribir en `stock_movements`.
6. La importación masiva escribe **una fila de movimiento por producto importado**
   (sin agregación), reutilizando el batching existente (`IMPORT_BATCH_SIZE=500`).
7. El permiso es **`productos:write`** (admin + manager), el mismo que ya gobierna
   la edición de productos — no se introduce un permiso nuevo.

## Sección 1: Modelo de datos (aprobada)

```sql
create table stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations (id) on delete cascade,
  product_id         uuid not null references products (id) on delete cascade,
  branch_id          uuid not null references branches (id),
  movement_type      text not null check (movement_type in ('alta_inicial','importacion','ajuste_manual','venta')),
  quantity_delta     integer not null,          -- positivo o negativo
  resulting_quantity integer not null,          -- stock resultante tras el movimiento (foto del momento)
  reason             text,                      -- obligatorio solo para 'ajuste_manual'
  actor_id           uuid references profiles (id) on delete set null,
  sale_id            uuid references sales (id) on delete set null,   -- solo para 'venta'
  created_at         timestamptz not null default now()
);
```

- Ledger inmutable: RLS con políticas `select`/`insert` únicamente, sin
  `update`/`delete` — mismo patrón que `sales`/`sale_items` (Fase 2).
- `org_id` siempre viene del perfil verificado server-side, nunca del cliente.
- Índices: `(org_id, product_id, created_at desc)` para el historial por producto,
  `(org_id, branch_id, created_at desc)` para el filtro por sucursal.

### Puntos de retrofit

| Origen | Función existente | `movement_type` | Notas |
|---|---|---|---|
| Alta de producto | `createProduct` (Fase 1) | `alta_inicial` | Una fila por cada `product_stock` inicial creado |
| Importación masiva | `confirmProductImport` (Fase 1) | `importacion` | Una fila por producto importado, mismo batching de 500 |
| Edición manual de stock | `updateProductStock` (Fase 1) | `ajuste_manual` | `reason` default: `"Editado desde ficha de producto"` (ese form no tiene campo de motivo) |
| Venta | `createSale` (Fase 2) | `venta` | Una fila por línea vendida, `sale_id` seteado, se revierte junto con el resto de la compensación si la venta falla |

## Sección 2: Pantalla `/ajuste-inventario`

Una sola página con scroll (sin pestañas), dos bloques apilados — mantiene la
pantalla simple de navegar y evita el estado extra de "pestaña activa":

**Bloque "Productos"** (arriba):
- Filtros: Código (texto libre, `ilike` escapado con `escapePostgrestFilterValue`)
  y Sucursal (selector, incluye "Todas" — solo si el usuario no tiene sucursal fija;
  si el perfil tiene `branch_id`, el filtro queda fijo en esa sucursal, igual que
  en `/ventas`).
- Tabla: Id Producto, Código, Sucursal, Stock, botones **Agregar** / **Reducir**.
- Al hacer clic en Agregar/Reducir, un modal pide **cantidad** (entero positivo) y
  **motivo** (texto libre, obligatorio) y llama a un nuevo server action:

  ```ts
  adjustStock(productId: string, branchId: string, delta: number, reason: string)
  ```

  - `branchId` se verifica con `verifyBranchInOrg` (mismo helper que ya usan
    `createProduct`/`updateProductStock`) contra el `org_id` del perfil — el
    permiso `productos:write` es de admin/manager, roles que no están atados a
    una sola sucursal (a diferencia de `ventas:create`), así que no hace falta
    la restricción adicional de sucursal fija que sí aplica en `/ventas`.
  - Usa locking optimista igual que `createSale` (tanto para Agregar como para
    Reducir): `.update({ quantity: newQty }).eq("product_id", ...).eq("branch_id", ...).eq("quantity", currentQuantity)`
    — si la fila afectada es 0 (otro cambio de stock ocurrió entre la lectura y
    la escritura), error claro y el usuario reintenta manualmente ("El stock
    cambió, intenta de nuevo"), sin reintento automático — mismo comportamiento
    que `createSale` ante un conflicto de stock.
  - Bloquea si el resultado sería negativo (mensaje: "No puedes reducir más stock
    del disponible").
  - Inserta la fila en `stock_movements` con `movement_type='ajuste_manual'`,
    `quantity_delta` positivo o negativo según el botón, `resulting_quantity`,
    `reason`, `actor_id = profile.id`.
  - Si la inserción del movimiento falla después de actualizar el stock, se
    revierte el `product_stock` (mismo patrón de compensación que `createSale`).
  - `revalidatePath("/ajuste-inventario")` al terminar.

**Bloque "Historial de movimientos"** (abajo):
- Filtros: producto (código, `ilike` escapado), sucursal, tipo de movimiento
  (selector: Todos/Alta inicial/Importación/Ajuste manual/Venta), rango de fechas
  (desde/hasta).
- Tabla: fecha, producto, sucursal, tipo, cantidad (con signo, +/-), stock
  resultante, quién lo hizo (`actor_id` → nombre del perfil, o "Sistema" si es
  null), motivo (solo si aplica). Para `venta`, se muestra el `sale_id` como
  texto de referencia (sin link clickeable en esta fase — un futuro "ver detalle
  de venta" queda fuera de alcance).
- Paginación simple (mismo patrón de límite que ya usa `/productos`).

## Sección 3: Permisos y feature flag

- **Permiso:** reutiliza `productos:write` (admin + manager) tanto para ver la
  página como para ejecutar `adjustStock` — ver el historial y hacer ajustes
  quedan bajo el mismo gate, sin permiso de solo-lectura separado (YAGNI: nadie
  pidió un rol viewer para este módulo).
- **Feature flag:** en `lib/features.ts`, `FeatureKey` y `NAV_WHITELIST` son 1:1
  por página — no existe mecanismo para que una página herede el flag de otra
  (confirmado leyendo `lib/guard.ts::requireNavAccess`, que exige `features[key]`
  con `key: FeatureKey` exacto). Se introduce un nuevo `FeatureKey`
  `ajuste_inventario` (`optIn: true`, apagado por defecto), siguiendo exactamente
  el mismo patrón que `ventas` en Fase 2 — no una excepción al estilo del
  proyecto, sino su continuación.
- **Nav:** nuevo item `ajuste_inventario` en `NAV_WHITELIST` para `admin` y
  `manager` únicamente (mismos roles que tienen `productos:write`), gateado por
  `canSeeNav` + el nuevo flag vía `requireNavAccess("ajuste_inventario")`, igual
  que `/ventas`.

## Testing

Mismo criterio que Fase 1/Fase 2: las funciones puras (`lib/stockMovements.ts`)
llevan unit tests con Vitest. Los server actions que tocan Supabase
(`adjustStock`, y los 4 puntos de retrofit) **no** tienen tests automatizados
en este codebase — ninguna acción existente los tiene (`createSale`,
`createProduct`, etc. se verifican solo manualmente) — así que este módulo
sigue el mismo patrón: se verifican con un walkthrough manual end-to-end
(igual que el Task 14 de Fase 2), cubriendo agregar, reducir, bloqueo por
stock insuficiente, conflicto de locking, y que cada uno de los 4 puntos de
retrofit efectivamente deja su fila en `stock_movements`.

## Fuera de alcance (explícitamente)

- Traspasos entre sucursales, Devoluciones, Reporte Producto, Reporte Ventas —
  módulos legados relacionados pero no pedidos ahora; podrían ser fases futuras
  independientes.
- Link clickeable desde una fila de movimiento tipo `venta` hacia el detalle de
  la venta.
- Columna `created_by` en `products` (alta histórica de productos ya existentes
  antes de este módulo no tendrá movimiento `alta_inicial` retroactivo).
