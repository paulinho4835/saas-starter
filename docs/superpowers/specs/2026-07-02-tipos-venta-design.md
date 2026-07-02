# Tipos de Venta — Design Spec

## Contexto

Hoy cada línea de venta elige su propio `price_tier` (`sf`/`cf`/`may`) desde
la tabla de productos en `/ventas` — 3 filas por producto, una por precio.
Paulo pidió agregar el método de cobro (Efectivo/QR) cruzado con si la venta
lleva factura, como **4 tipos de venta**: Sin Factura, Con Factura, Sin
Factura QR, Con Factura QR. Además quiere filtrar el Dashboard por Total /
Efectivo / QR.

## Decisiones previas (de la fase de preguntas)

1. El tipo de venta se elige **una sola vez por venta completa**, no por
   línea — como el método de pago de un ticket.
2. El tipo de venta **determina el precio de todas las líneas** de esa
   venta: variantes "Sin Factura" (con o sin QR) usan precio SF, variantes
   "Con Factura" (con o sin QR) usan precio CF. El precio **Mayorista** se
   mantiene como una 5ta opción de tipo de venta (sin variante QR/Efectivo
   separada — el mayorista casi siempre paga en efectivo/transferencia, no
   se pidió una variante QR para él).
3. El selector de precio por línea en el carrito **se elimina** — la tabla
   de productos en `/ventas` pasa de 3 filas por producto a **1 fila**, con
   el precio correspondiente al tipo de venta activo en ese momento.
4. El filtro "Ventas Totales / Efectivo / QR" se agrega al **Dashboard
   existente**, junto al selector de período ya construido — no se crea una
   página nueva de "Reporte de Ventas" (eso sigue fuera de alcance, como ya
   estaba documentado en `RESERVED_FEATURES`).

## Sección 1: Modelo de datos (aprobada)

```sql
alter table sales add column sale_type text not null default 'sin_factura'
  check (sale_type in ('sin_factura', 'con_factura', 'sin_factura_qr', 'con_factura_qr', 'mayorista'));
```

- Vive en `sales` (la venta completa), no en `sale_items` — coherente con la
  decisión 1.
- `sale_items.price_tier` (`sf`/`cf`/`may`) **no se elimina**: se sigue
  llenando, pero ahora se **deriva server-side de `sale_type`**, no se
  confía en un valor por línea mandado por el cliente:

  | `sale_type` | `price_tier` de cada línea |
  |---|---|
  | `sin_factura` | `sf` |
  | `sin_factura_qr` | `sf` |
  | `con_factura` | `cf` |
  | `con_factura_qr` | `cf` |
  | `mayorista` | `may` |

- Agrupación para el filtro de pago del Dashboard:
  - **Efectivo**: `sin_factura`, `con_factura`, `mayorista`.
  - **QR**: `sin_factura_qr`, `con_factura_qr`.
  - **Total**: sin filtro.

## Sección 2: `/ventas` — un tipo de venta por carrito (aprobada)

- Nuevo selector "Tipo de venta" (5 opciones) en el panel del carrito
  (`SalePanel.tsx`), por encima del cliente.
- La tabla de productos pasa de 3 filas (SF/CF/MAY) a **1 fila por
  producto**, mostrando el precio correspondiente al tipo de venta
  seleccionado en ese momento (usando la tabla de la Sección 1 para mapear
  `sale_type` → columna de precio).
- Si el usuario cambia el tipo de venta con productos ya en el carrito, se
  **recalculan** `unitPriceBs` de todas las líneas del carrito al precio del
  nuevo tipo (una venta = un solo tipo, no puede quedar el carrito con
  precios de un tipo viejo).
- `createSale` (`app/(dashboard)/ventas/actions.ts`) recibe `saleType` como
  campo nuevo del `FormData` (ya no recibe `priceTier` por línea desde el
  cliente para determinar el tier — lo deriva server-side de `saleType` con
  la tabla de la Sección 1, mismo criterio de "no confiar en el cliente"
  que ya aplica a `org_id`/`branch_id`). El precio unitario (`unitPriceBs`)
  sigue viniendo del cliente sin re-validar contra la DB — mismo modelo de
  confianza que ya existía antes de este cambio (no se introduce una
  superficie de ataque nueva).

## Sección 3: Dashboard — filtro de pago (aprobada)

- Nuevo selector "Total / Efectivo / QR" (`PaymentFilter`, client component
  chico, mismo patrón que `PeriodSelect`) junto al selector de período.
- Afecta únicamente las tarjetas **"Ventas · período"** y **"Cantidad de
  ventas · período"** (filtra `sales.sale_type in (...)` según el grupo
  elegido). **No afecta** "Top productos vendidos" ni "Stock bajo" — esas
  no dependen del método de pago (no se pidió, YAGNI).

## Fuera de alcance (YAGNI)

- Página dedicada de "Reporte de Ventas" con historial detallado — sigue
  siendo `reporte_ventas`, un `ReservedFeatureKey` sin página construida.
- Variante QR para Mayorista.
- Pagos mixtos dentro de una misma venta (parte efectivo, parte QR).
- Editar el tipo de venta de una venta ya confirmada.
