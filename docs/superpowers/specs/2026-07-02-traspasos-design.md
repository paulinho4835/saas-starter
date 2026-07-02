# Traspasos (transferencia de stock entre sucursales) — Design Spec

## Contexto

`/almacen` ya permite transferir stock del almacén hacia una sucursal
(unidireccional, origen fijo). Falta un módulo general para mover stock
entre dos sucursales cualesquiera (no solo desde el almacén) — ej. una
sucursal le presta un repuesto a otra.

## Decisiones (confirmadas con el usuario)

- **Permisos:** admin y manager (mismo nivel que Ajuste de Inventario,
  Movimientos de Producto y Devoluciones).
- **Flujo:** instantáneo — se descuenta de origen y se suma a destino en
  el mismo momento en que se registra (no hay estado "en tránsito").

## Diseño

- **Reutiliza el RPC existente `transfer_stock`** (`supabase/migrations/0006_almacen.sql`)
  — ya es genérico en `p_from_branch_id`/`p_to_branch_id`, atómico (row
  lock + upsert), y ya escribe dos filas en `stock_movements` con
  `movement_type = 'transferencia'`. No se toca su lógica de stock.
- **Único cambio de schema:** el texto de `reason` que graba el RPC dice
  literalmente "Transferencia desde Almacén", lo cual es incorrecto/confuso
  cuando el origen no es el almacén (se ve en `/movimientos-producto`).
  Migración `0012_traspasos.sql` reemplaza la función (`create or replace`,
  mismo nombre y firma) para que el `reason` incluya el nombre de la
  sucursal contraria en cada fila (ej. "Transferencia a Sucursal Norte" /
  "Transferencia desde Sucursal Central") en vez del texto fijo. Sin
  cambios de tablas ni de RLS.
- **Nuevo módulo `/traspasos`**, con permiso `traspasos:create` (nuevo,
  admin+manager) — separado de `almacen:transfer` porque Almacén sigue
  siendo su propio flujo (origen fijo, pensado para reposición desde
  depósito central) y no todas las orgs necesariamente tienen almacén
  configurado.
- **Página:** lista `product_stock` de TODAS las sucursales (no solo
  almacén), con filtros código/aplicación/marca/sucursal (mismo patrón que
  `/almacen`, reutilizando el componente de filtros). Cada fila (producto +
  sucursal + cantidad) tiene un botón "Transferir" que abre un modal para
  elegir sucursal destino (todas menos la de origen) y cantidad.
- **Server action** `transferBetweenBranches(formData)` en
  `app/(dashboard)/traspasos/actions.ts`: valida `productId`,
  `fromBranchId`, `toBranchId`, `quantity` con Zod, chequea
  `can(role, "traspasos:create")`, valida que ambas sucursales pertenezcan
  a la org (`verifyBranchInOrg`), llama al mismo RPC `transfer_stock`.
  A diferencia de Almacén, `fromBranchId` viene del cliente (es la fila
  sobre la que se hizo clic) — se revalida igual server-side contra la org.
- **Feature flag:** se mueve `"traspasos"` de `ReservedFeatureKey` a
  `FeatureKey`/`FEATURES` real (`href: "/traspasos"`, `optIn: true`,
  posición después de `almacen`, antes de `pedidos`). Se agrega a
  `NAV_WHITELIST` de admin y manager, y a `supabase/seed.sql`.

## Archivos

- Nuevo: `supabase/migrations/0012_traspasos.sql`
- Nuevo: `app/(dashboard)/traspasos/page.tsx`
- Nuevo: `app/(dashboard)/traspasos/actions.ts`
- Nuevo: `app/(dashboard)/traspasos/TraspasosFilters.tsx`
- Nuevo: `components/traspasos/TransferBetweenBranchesButton.tsx`
- Modificar: `lib/features.ts`, `lib/rbac.ts`, `supabase/seed.sql`

Sin cambios de tablas ni RLS — solo reemplazo de una función SQL existente.
