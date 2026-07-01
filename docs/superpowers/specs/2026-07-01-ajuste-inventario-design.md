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

  - `branchId` se valida contra `getProfile()` si el usuario tiene sucursal fija
    (no se confía en el valor del cliente); si el rol tiene acceso a todas las
    sucursales, se acepta el `branchId` recibido pero se verifica que pertenezca
    al `org_id` del perfil.
  - Reduce usa locking optimista igual que `createSale`:
    `.update({ quantity: newQty }).eq("product_id", ...).eq("branch_id", ...).eq("quantity", currentQuantity)`
    — si la fila afectada es 0, se relee el stock actual y se reintenta una vez;
    si vuelve a fallar, error claro ("El stock cambió, intenta de nuevo").
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
- **Feature flag:** reutiliza el flag existente `productos` (no se introduce uno
  nuevo) — el módulo es una extensión natural de la gestión de productos y ya
  comparte los mismos datos base (`products`, `product_stock`, `branches`).
- **Nav:** nuevo item `ajuste-inventario` en `NAV_WHITELIST` para `admin` y
  `manager` únicamente (mismos roles que ven `productos:write`), gateado también
  por `canSeeNav` + el flag `productos` vía `requireNavAccess`, igual que
  `/ventas`.

## Testing

- Unit tests para `adjustStock`: reduce exitosa, reduce bloqueada por stock
  insuficiente, reduce con conflicto de locking optimista (reintento), agregar
  exitoso, reversión si falla la inserción del movimiento.
- Unit tests para los 4 puntos de retrofit: cada uno debe producir exactamente
  una fila de `stock_movements` con el `movement_type` correcto (o N filas para
  importación masiva, una por producto).
- Test de integración liviano para el filtro combinado del historial (producto +
  sucursal + tipo + rango de fechas).

## Fuera de alcance (explícitamente)

- Traspasos entre sucursales, Devoluciones, Reporte Producto, Reporte Ventas —
  módulos legados relacionados pero no pedidos ahora; podrían ser fases futuras
  independientes.
- Link clickeable desde una fila de movimiento tipo `venta` hacia el detalle de
  la venta.
- Columna `created_by` en `products` (alta histórica de productos ya existentes
  antes de este módulo no tendrá movimiento `alta_inicial` retroactivo).
