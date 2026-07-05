# Reporte Producto — Design Spec

## Contexto

Replica la pantalla "Reporte producto" del sistema anterior (captura del
cliente): una fila por combinación producto+sucursal con stock, costo y
precios, filtrable por sucursal y marca, con totales al pie y exportación
a Excel. Es el módulo `reporte_productos`, hasta ahora solo reservado
(placeholder sin página).

## Diseño

- **Solo lectura**, sin permiso especial — mismo criterio que Reporte de
  Ventas (accesible a admin y manager vía `requireNavAccess`, sin `can()`).
- **Filtros:** Sucursal (dropdown, "Todas" por defecto) y Marca (dropdown,
  "Todas" por defecto). Botones "Generar" / "Limpiar".
- **Tabla:** una fila por `product_stock` (producto × sucursal), columnas:
  Código producto, Sucursal, Marca, Stock, Costo origen dólares (`cost_usd`
  del producto), Con Factura (`price_cf_bs`), Sin Factura (`price_sf_bs`),
  Por Mayor (`price_may_bs`), Medida Interna/Externa/Altura/Pestaña/Tope
  (`internal_mm/external_mm/height_mm/flange_mm/stop_mm`).
- **Paginación:** 30 filas por página (el sistema anterior pagina también,
  con un tamaño de página distinto — no relevante para la funcionalidad).
- **Totales al pie** (sobre TODAS las filas que matchean el filtro, no solo
  la página actual): "Cantidad total items" (cuenta de filas), "Stock
  total" (suma de `quantity`), "Costo total origen en dólares" (suma de
  `quantity * cost_usd`) — calculados con una query de agregación aparte
  (mismos filtros, sin paginar), igual al patrón ya usado en otros reportes
  de este proyecto (sin RPC de agregación en DB).
- **Exportar Excel:** botón que exporta la página actual visible (mismo
  patrón que se acaba de construir para Movimientos de Producto —
  `ExportMovimientosButton` client-side con `xlsx`).
- **Nav:** se promueve `"reporte_productos"` de `ReservedFeatureKey` a
  `FeatureKey` real, insertado en `FEATURES`/`NAV_WHITELIST` (admin y
  manager) entre `devoluciones` y `reporte_ventas`, replicando el orden
  del sistema anterior.

## Archivos

- Nuevo: `app/(dashboard)/reporte-productos/page.tsx`
- Nuevo: `components/reporteProductos/ExportReporteProductosButton.tsx`
  (o reutilizar un componente de exportación genérico — ver implementación)
- Modificar: `lib/features.ts`, `lib/rbac.ts`, `supabase/seed.sql`

Sin cambios de esquema — todas las columnas ya existen en `products` /
`product_stock`.
