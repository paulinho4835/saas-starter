# Pedidos: agrupar por proveedor + selección manual — Design Spec

## Contexto

El módulo `/pedidos` ya existe (`app/(dashboard)/pedidos/page.tsx`): lista
productos con stock menor a 5 unidades por sucursal, con filtros de
código/sucursal e impresión. Pedido: agrupar el listado por proveedor y
poder destildar productos que no se quieren pedir antes de imprimir.

## Decisiones (confirmadas con el usuario)

- **Umbral de stock bajo:** global (5), no por producto. Ya es así — no
  cambia.
- **Alcance del stock:** por sucursal (ya es así — no cambia).
- **Selección manual:** checkbox por fila para incluir/excluir del pedido.
  La lista se sigue generando automáticamente por stock bajo; el checkbox
  no agrega productos fuera del criterio, solo permite destildar los que
  no se quieren pedir todavía. Todo viene marcado por defecto. Solo lo
  marcado se imprime.
- **Agrupación por proveedor:** en pantalla y al imprimir, con encabezado
  de sección por proveedor (no solo una columna "Proveedor" en una tabla
  plana como ahora).

## Diseño

- La query server-side sigue igual (stock < 5, filtros código/sucursal).
- El agrupamiento por proveedor se hace en el server component
  (`Map<string, StockRow[]>`, orden alfabético de proveedor; "Sin
  proveedor" al final para productos sin `supplier_id`).
- Nuevo client component `components/pedidos/PedidosList.tsx` recibe los
  grupos ya armados y maneja el estado de checkboxes (`Set<string>` de
  claves seleccionadas, todo seleccionado por defecto). Reemplaza la
  tabla plana actual.
- Cada fila no marcada recibe la clase `print:hidden` (condicional en
  React), de modo que `window.print()` (ya implementado en
  `PrintButton.tsx`, sin cambios) omite las filas destildadas sin
  necesidad de tocar el DOM al imprimir.
- Un checkbox "Seleccionar todos" por sección de proveedor y uno global.
- Vista de impresión: título general + subtítulo por proveedor antes de
  cada grupo (usa la clase `hidden print:block` ya usada para el título
  actual).
- Sin cambios de esquema, RLS, ni server actions — es una reorganización
  de UI sobre datos que ya se consultan igual.
- `supabase/seed.sql`: agregar `"pedidos": true` a los features de la
  organización demo (sigue el mismo patrón que `reporte_ventas` y
  `devoluciones`), ya que el feature existe en `lib/features.ts` pero no
  está habilitado en el seed local.

## Archivos

- Modificar: `app/(dashboard)/pedidos/page.tsx` (agrupar por proveedor,
  pasar grupos al nuevo componente client)
- Nuevo: `components/pedidos/PedidosList.tsx`
- Modificar: `supabase/seed.sql` (habilitar `pedidos` en la org demo)

Sin cambios de esquema, RLS ni server actions nuevas.
