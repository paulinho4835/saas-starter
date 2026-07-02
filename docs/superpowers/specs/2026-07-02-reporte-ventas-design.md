# Reporte de Ventas — Design Spec

## Contexto

Referencia: captura del sistema PHP viejo ("VENTA RETENES" → "Reporte Ventas"),
pantalla con filtros (Nombre/NIT, Desde, Hasta, Sucursal, Tipo de venta) +
botón "Generar" + tabla "Vendidos" (una fila por producto vendido) + total al
pie.

Pedido del usuario: nuevo módulo de reporte que permita visualizar las ventas
del día, filtrar por rango de fechas, filtrar por tipo de venta (QR/CF/SF/etc.)
y ver los totales.

## Alcance

Página nueva de solo lectura: `/reporte-ventas`. No hay escritura, no hay
cambios de esquema — toda la data ya existe en `sales`, `sale_items`,
`customers`, `branches`, `profiles`.

**Acceso:** admin y manager (mismo criterio que Movimientos de Producto —
visibilidad de ventas es información sensible). Se agrega como módulo opt-in
nuevo (`reporte_ventas`) en `lib/features.ts` y `lib/rbac.ts`.

**Granularidad de resultados:** una fila por línea de venta (`sale_items`),
igual que la captura de referencia — permite ver qué producto se vendió, a
qué precio y en qué venta, no solo el total agregado.

**Exportar Excel:** fuera de alcance por ahora (no fue pedido explícitamente).

## Filtros

- **Desde / Hasta** (fecha): por defecto ambos son el día de hoy, para que al
  entrar a la página ya se vean "las ventas del día" sin acción adicional.
- **Cliente** (texto libre): busca por nombre o NIT (`ilike`, igual patrón que
  `/clientes`).
- **Sucursal** (select): "Todas" o una sucursal específica. Sin restricción
  por rol — admin y manager ven todas las sucursales de la organización
  (mismo criterio que Movimientos de Producto).
- **Tipo de venta** (select): "Todas" o uno de los 5 `SALE_TYPES` existentes
  (`sin_factura`, `con_factura`, `sin_factura_qr`, `con_factura_qr`,
  `mayorista`). Esto ya cubre el pedido de "filtrar por qr, cf, sf, etc.",
  porque el tipo de venta determina tanto el tier de precio (sf/cf/mayorista)
  como el método de pago (efectivo/QR) — ver `lib/saleType.ts`.

Filtros vía formulario GET (server component, sin JS dinámico) — mismo
patrón que Movimientos de Producto, no el patrón de búsqueda dinámica de
Ventas (ese módulo es de venta activa, este es de consulta histórica con
"Generar").

## Tabla de resultados

Una fila por `sale_items`, ordenadas por fecha de venta descendente. Columnas:

| Columna | Origen |
|---|---|
| Fecha | `sales.created_at` |
| Sucursal | `branches.name` |
| Tipo de venta | `sales.sale_type` → `SALE_TYPE_LABEL` |
| Cliente | `customers.full_name` (o "Mostrador" si `customer_id` es null) |
| NIT | `customers.nit` |
| Código producto | `products.code` |
| Precio (Bs) | `sale_items.unit_price_bs` |
| Cantidad | `sale_items.quantity` |
| Subtotal (Bs) | `sale_items.subtotal_bs` |

Sin paginación: se traen todos los resultados del rango filtrado (con un
límite defensivo de 2000 filas, igual criterio que la búsqueda por medida en
Ventas) — un reporte de rango de fechas acotado (el caso típico es "hoy" o
"esta semana") no debería superar eso, y el usuario ya controla el volumen
con el filtro de fechas.

## Totales

Al pie de la tabla, calculados sobre las filas filtradas (no sobre el total
de la organización):

- **Total ventas:** cantidad de líneas mostradas.
- **Total Bs:** suma de `subtotal_bs`.
- **Total Efectivo Bs:** suma de `subtotal_bs` donde
  `paymentMethodForSaleType(sale_type) === "efectivo"`.
- **Total QR Bs:** suma de `subtotal_bs` donde
  `paymentMethodForSaleType(sale_type) === "qr"`.

## Archivos

- Nuevo: `app/(dashboard)/reporte-ventas/page.tsx`
- Modificar: `lib/features.ts` (nuevo `FeatureKey` `"reporte_ventas"`, entry
  opt-in con `href: "/reporte-ventas"`)
- Modificar: `lib/rbac.ts` (agregar `"reporte_ventas"` a `NAV_WHITELIST.admin`
  y `NAV_WHITELIST.manager`)

Sin migraciones SQL, sin server actions nuevas (solo lectura vía
`createClient()` + RLS existente, que ya aísla por `org_id`).
