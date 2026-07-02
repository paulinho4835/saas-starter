# Movimientos de Producto — Diseño

## Contexto

Referencia visual: captura del sistema PHP viejo (VENTA RETENES), pantalla
"Movimientos de Producto" — filtros (Código de producto, Desde, Hasta,
Sucursal) + botón "Ver movimientos" + tabla "Movimientos" con columnas Tipo
movimiento, Fecha, Ajuste de Inventario, Cantidad, Compra CF, Compra SF,
Compra MAY, Devolución, Usuario, Stock actualizado + botón "Exportar Excel".

El usuario reportó primero un bug en los botones Agregar/Reducir de Ajuste
de Inventario (ya resuelto por separado — dos procesos `next dev`
duplicados corrompiendo el caché de build). Al aclarar el pedido, especificó:

> "ajuste de inventario solamente es para aumentar o disminuir los
> repuestos, lo que necesitamos es el modulo movimiento de producto, ahi
> debe verse el historial de ese producto"

El historial ya existe hoy, pero embebido dentro de `/ajuste-inventario`
(sección "Historial de movimientos", líneas 76-105 y 164-267 de
`app/(dashboard)/ajuste-inventario/page.tsx`), con filtros equivalentes
(código, sucursal, tipo, desde, hasta) sobre la misma tabla `stock_movements`
que ya alimenta ese ledger (ver `lib/stockMovements.ts` y la migración
`0005_ajuste_inventario.sql`).

**Decisión (confirmada por el usuario):** extraer ese historial a su propia
página `/movimientos-producto` con entrada propia en el menú lateral, y
quitarlo de Ajuste de Inventario para no duplicar. Ajuste de Inventario
queda exclusivamente para aumentar/reducir stock.

**Fuera de alcance:** el botón "Exportar Excel" de la captura vieja
(confirmado explícitamente por el usuario: no en esta versión). El desglose
por columnas separadas (Compra CF / Compra SF / Compra MAY / Devolución /
Ajuste de Inventario) tampoco se replica — se mantiene una sola columna
"Tipo" con el valor legible (`movementTypeLabel`), igual que hoy; separar en
columnas por tipo es un cambio cosmético no pedido y el tipo `'devolucion'`
ni siquiera existe todavía en el check constraint de `movement_type` (se
agregará cuando se implemente el módulo Devoluciones, todavía no
diseñado en detalle).

## Cambios

### 1. `app/(dashboard)/movimientos-producto/page.tsx` (nueva)

Server Component. Reutiliza tal cual la lógica que hoy vive en
`ajuste-inventario/page.tsx`:

- Filtros vía `searchParams` (`code`, `branchId`, `type`, `from`, `to`,
  `page`) sobre `GET` — se simplifican los nombres de query param (ya no
  necesitan el prefijo `h` porque no comparten página con el bloque
  "Productos").
- Query: `stock_movements` con `MOVEMENT_SELECT` (mismo select que hoy:
  `id, movement_type, quantity_delta, resulting_quantity, reason, sale_id,
  created_at, products!inner(code), branches!inner(name),
  profiles(full_name)`), paginado de a 25 (`PAGE_SIZE`), orden
  `created_at desc`.
- Filtro por código: `ilike` sobre `products.code`. Por sucursal: `eq` sobre
  `branch_id`. Por tipo: `eq` sobre `movement_type` (opciones desde
  `MOVEMENT_TYPES`/`movementTypeLabel` de `lib/stockMovements.ts`, sin
  cambios). Por fecha: `gte`/`lte` sobre `created_at` (mismo patrón
  `${to}T23:59:59` para incluir el día completo).
- Render: mismo formulario de filtros, misma lista (`<ul>` con tipo, fecha,
  cantidad con signo, stock resultante, usuario, motivo, venta asociada) y
  misma paginación Anterior/Siguiente que hoy están en
  `ajuste-inventario/page.tsx`.
- Guard: `await requireNavAccess("movimientos_producto")` (mismo patrón que
  usa hoy `ajuste-inventario`, pero con la feature key nueva).
- Sin botón "Exportar Excel" (confirmado fuera de alcance).

### 2. `app/(dashboard)/ajuste-inventario/page.tsx`

Se elimina el bloque completo "Historial de movimientos": el segundo
`PageHeader`, el formulario de filtros `hcode/hbranchId/htype/hfrom/hto`, la
`<Card>` con la lista de movimientos, la paginación asociada, el tipo
`MovementRow`, la constante `MOVEMENT_SELECT`, la función
`buildHistorialHref`, y las variables derivadas (`hpage`, `movementsQuery`,
`movementRows`, `totalMovements`, `totalPages`). Se limpian los imports que
queden sin uso (`movementTypeLabel`, `MOVEMENT_TYPES`, `MovementType`,
`ButtonLink`, `History` si deja de usarse en algún ícono — se revisa en la
implementación).

Queda solo la sección "Productos": filtro por código/sucursal, lista de
stock actual con los botones `AdjustStockButton` (Agregar/Reducir) cuando
`canAdjust`.

### 3. `lib/features.ts`

Nuevo `FeatureKey`: `"movimientos_producto"`. Nueva entrada en `FEATURES`,
inmediatamente después de `ajuste_inventario` para que aparezcan juntos en
el menú:

```typescript
{ key: "movimientos_producto", label: "Movimientos de Producto", href: "/movimientos-producto", optIn: true },
```

### 4. `lib/rbac.ts`

Se agrega `"movimientos_producto"` a `NAV_WHITELIST.admin` y
`NAV_WHITELIST.manager` (mismo público que hoy ve `ajuste_inventario` —
no se agrega a `member`/`viewer`). No se agrega ningún `Permission` nuevo:
la página es de solo lectura y su único guard es `requireNavAccess`, igual
que Ajuste de Inventario hoy.

### 5. Sin cambios de esquema, RLS, ni server actions

Es un movimiento de código de lectura sobre `stock_movements`, tabla que ya
existe con las políticas `select`/`insert` correctas (migración
`0005_ajuste_inventario.sql`). No se toca ninguna migración ni ningún
`actions.ts`.

## Testing

Sin tests automatizados nuevos (mismo patrón que el resto del proyecto:
sin suite para páginas de Supabase). Verificación manual:

1. Con un usuario admin o manager, confirmar que "Movimientos de Producto"
   aparece en el menú lateral (feature flag habilitado) y que
   `/movimientos-producto` carga el historial con los mismos datos que
   antes mostraba `/ajuste-inventario`.
2. Confirmar que los filtros (código, sucursal, tipo, desde, hasta) y la
   paginación funcionan igual que antes.
3. Confirmar que `/ajuste-inventario` ya no muestra la sección de
   historial, solo "Productos" con Agregar/Reducir funcionando.
4. Con un usuario `member`/`viewer`, confirmar que no ve "Movimientos de
   Producto" en el menú y que `/movimientos-producto` redirige/bloquea
   (mismo comportamiento que hoy tiene `/ajuste-inventario` para esos
   roles).
5. `npm run typecheck` en 0 errores.
