# Devoluciones — Design Spec

## Contexto

Referencia: pantalla "Devoluciones" del sistema PHP viejo — filtros (Nombre/NIT
cliente, Desde, Hasta, Sucursal) + botón "Buscar Ventas" + tabla listando
ventas/líneas con columnas Sucursal, Fecha de venta, Tipo de venta, Nombre
cliente, NIT cliente, Producto, Precio venta, Nro pedidos, y una columna
Devolución con input de cantidad + botón "Devolver" por fila.

Pedido: permitir devolver ítems de una venta ya confirmada, revirtiendo su
efecto (stock y dinero) sin editar ni borrar la venta original.

## Decisiones (confirmadas con el usuario)

- **Acceso:** admin y manager (mismo criterio que registrar una venta,
  `ventas:create` → nuevo permiso paralelo `devoluciones:create`).
- **Efecto de una devolución:** restaura el stock de la sucursal donde se
  vendió y reduce `sales.total_bs` por el monto devuelto. La venta original
  **nunca se edita ni se borra** — cada devolución queda como un registro
  histórico aparte (tabla nueva `sale_returns`), mismo criterio de
  inmutabilidad que ya usa Ventas.
- **Cantidad parcial:** se puede devolver menos de lo vendido en una línea.
  El máximo devolvible por línea es `sale_items.quantity - Σ(devoluciones
  previas de esa línea)`.

## Modelo de datos

### Nueva tabla `sale_returns`

Una fila por devolución procesada (no por línea de venta — una línea puede
tener varias devoluciones parciales a lo largo del tiempo).

```sql
create table sale_returns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations (id) on delete cascade,
  sale_item_id  uuid not null references sale_items (id),
  sale_id       uuid not null references sales (id),
  product_id    uuid not null references products (id),
  branch_id     uuid not null references branches (id),
  quantity      integer not null check (quantity > 0),
  amount_bs     numeric not null,
  actor_id      uuid not null references profiles (id),
  created_at    timestamptz not null default now()
);
```

`sale_id`, `product_id` y `branch_id` se duplican desde `sale_items`/`sales`
(denormalizado) para que el reporte de devoluciones no dependa de un join de
3 niveles — mismo criterio que `stock_movements` ya usa (guarda
`resulting_quantity`, `branch_id`, etc. en vez de recalcular).

RLS: `select`/`insert` con `org_id = auth_org_id()`, igual patrón que
`sales`/`sale_items`. Sin `update`/`delete` — una devolución tampoco se edita.

### `stock_movements`: nuevo tipo `devolucion`

Amplía el check constraint (mismo patrón que Almacén agregó `transferencia`
en `0006_almacen.sql`):

```sql
alter table stock_movements drop constraint stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('alta_inicial', 'importacion', 'ajuste_manual', 'venta', 'transferencia', 'devolucion'));
```

Cada devolución inserta una fila en `stock_movements` con
`movement_type = 'devolucion'`, `quantity_delta > 0`, `sale_id` apuntando a
la venta original (la columna ya existe y ya se usa para `venta`).

### `lib/rbac.ts`: nuevo permiso

`devoluciones:create`, otorgado a `admin` y `manager` (mismo set que
`ventas:create`).

### `lib/features.ts`: módulo real

`devoluciones` pasa de `ReservedFeatureKey` (placeholder) a `FeatureKey` real,
opt-in, con `href: "/devoluciones"`. Se agrega a `NAV_WHITELIST.admin` y
`NAV_WHITELIST.manager`.

## Flujo de la devolución (server action)

`createReturn(saleItemId: string, quantity: number)`:

1. `getProfile()` + `can(role, "devoluciones:create")`.
2. Lee `sale_items` (con `sales!inner(branch_id, total_bs, org_id)`) por
   `saleItemId`, verifica que pertenece a la organización del usuario.
3. Calcula `alreadyReturned` = suma de `sale_returns.quantity` para ese
   `sale_item_id`. `remaining = sale_items.quantity - alreadyReturned`.
4. Valida `0 < quantity <= remaining`; si no, error explicando el máximo
   devolvible.
5. `amount = round(quantity * sale_items.unit_price_bs, 2)`.
6. Restaura stock en `product_stock` (branch de la venta, producto de la
   línea) con el mismo bloqueo optimista que `createSale` usa para
   descontar (lectura + `.eq("quantity", currentQuantity)` en el update).
7. Inserta la fila de `stock_movements` (`devolucion`, `+quantity`). Si
   falla, revierte el paso 6.
8. Inserta la fila de `sale_returns`. Si falla, revierte 6 y 7.
9. Actualiza `sales.total_bs = total_bs - amount` (mismo patrón de lectura +
   escritura condicionada). Si falla, revierte 6, 7 y 8.
10. `revalidatePath("/devoluciones")`.

Igual que `createSale`, cada paso posterior a una escritura exitosa tiene su
reversión si un paso siguiente falla — nunca se deja stock, movimiento o
`sale_returns` a medio aplicar sin también revertir el dinero, ni viceversa.

Todas las escrituras usan el cliente autenticado normal (RLS ya cubre
`org_id`), **excepto** la actualización de `sales.total_bs`: como `sales` no
tiene política `update` (una venta no se edita desde el flujo normal), esa
escritura puntual usa `createAdminClient()` tras la verificación de permiso
— mismo patrón que `setUserActive`/`setUserBranch` en `ajustes/actions.ts`.

## Página `/devoluciones`

Mismo layout de filtros que Reporte de Ventas (Cliente nombre/NIT, Desde,
Hasta, Sucursal, con Desde/Hasta por defecto en "hoy"), reutilizando la
misma resolución de cliente por nombre/NIT. **No** incluye el filtro de tipo
de venta (no es relevante para decidir qué devolver).

Tabla de resultados: una fila por `sale_items` del rango filtrado — mismas
columnas que Reporte de Ventas (fecha, sucursal, tipo de venta, cliente,
NIT, código, precio, cantidad vendida) **más**:

- **Devuelto:** suma de devoluciones previas de esa línea.
- **Restante:** `quantity - devuelto`.
- **Devolución:** input numérico (máx = restante) + botón "Devolver". Si
  `restante === 0`, no se muestra el input/botón — la línea ya está
  totalmente devuelta (se indica con texto "Devuelto completo").

El input + botón viven en un client component (`ReturnRowAction`) porque
necesitan estado local (cantidad tecleada) y llamar al server action; el
resto de la página es un server component, igual patrón que
`TransferStockButton` en Almacén.

Límite defensivo de filas: 2000, igual que Reporte de Ventas.

## Archivos

- Nuevo: `supabase/migrations/0011_devoluciones.sql` (tabla `sale_returns` +
  ampliación de `stock_movements` check constraint)
- Modificar: `lib/rbac.ts` (permiso `devoluciones:create`)
- Modificar: `lib/features.ts` (mover `devoluciones` de reservado a real)
- Modificar: `lib/stockMovements.ts` (nuevo `MovementType` `devolucion`)
- Nuevo: `app/(dashboard)/devoluciones/actions.ts` (`createReturn`)
- Nuevo: `app/(dashboard)/devoluciones/page.tsx`
- Nuevo: `components/devoluciones/ReturnRowAction.tsx`

Sin cambios a `createSale` ni a las páginas de Ventas/Reporte de Ventas
existentes (las devoluciones se reflejan ahí automáticamente porque leen
`sales.total_bs` y `product_stock` en vivo).
