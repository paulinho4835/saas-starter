# Rediseño de Ventas como réplica del sistema legacy — Diseño

## Objetivo

Rediseñar el módulo Ventas (`/ventas`) para que replique el diseño y flujo del
sistema PHP legacy "Venta Retenes", según capturas de pantalla provistas por
el dueño del negocio. El sidebar de navegación del SaaS actual **no se
toca** — la réplica aplica solo al contenido de la página Ventas.

Se implementa primero en local (para revisión visual antes de cualquier
push/deploy).

## Alcance confirmado

Basado en las capturas y decisiones tomadas durante el brainstorming:

1. **Tabla de productos**: misma estructura de 3 filas por producto
   (CF verde, SF amarillo, MAY rojo) que ya existe hoy — se mantiene tal
   cual, pero:
   - Clic en una celda de precio abre el modal "Cantidad de producto" (ver
     sección 3) en vez de agregar directo al carrito.
   - Clic en cualquier parte de una fila de producto (fuera de precio o
     "Equiv") selecciona ese producto para poblar el panel derecho
     (Sucursal/Stock + Aplicación producto).
   - Se reemplaza el scroll infinito actual por **paginación real**
     (números de página, igual al legacy).
   - Se mantiene la función de "anclar" (pin) ya existente, como mejora
     sobre la copia — el legacy no la tiene, pero no choca visualmente y
     el dueño pidió conservarla.

2. **Filtros**: se mueven del bloque horizontal actual (arriba de la tabla,
   con auto-búsqueda debounced) a un **panel a la derecha** con botones
   explícitos "Filtrar" y "Limpiar" — sin auto-búsqueda mientras se escribe.

3. **Modal "Cantidad de producto"**: nuevo componente, se abre al hacer clic
   en un precio. Campos: Código de producto (readonly), Precio {Con
   Factura|Sin Factura|Mayorista} ({CF|SF|MAY}) (readonly), Stock de
   Sucursal Actual (readonly), Establecer precio (opcional — si se deja
   vacío usa el precio de catálogo), Cantidad (requerido). Botones Agregar
   / Cancelar.

4. **Carrito "Productos para la Venta"**: bloque a todo el ancho, debajo de
   la fila tabla+panel-derecho. Encabezado de grupo con el tipo de venta
   actual (ej. "Productos Venta con Factura"). Columnas: CÓDIGO, CANTIDAD,
   PRECIO ESTABLECIDO, SUB TOTAL, botón "Quitar". Fila "Total de la Venta".
   Botón "Venta" (antes "Confirmar venta") para registrar.
   - **Se mantiene la regla ya vigente de "un solo tipo de venta por
     venta completa"** (confirmado explícitamente: NO se permite mezclar
     CF/SF/MAY en una misma venta, a pesar de que el legacy sugiere lo
     contrario con el encabezado de grupo). Si el carrito ya tiene líneas
     de un tier y se intenta agregar uno de otro tier, se rechaza con un
     mensaje claro.
   - Nombre/NIT del cliente se mantienen como inputs simples dentro de
     este mismo bloque (el legacy no muestra dónde van en las capturas
     provistas).
   - Al agregar un producto exitosamente se muestra un toast: "Añadido en
     productos para la venta" (mismo texto que el legacy).

5. **Panel derecho — Sucursal/Stock + Aplicación producto**: debajo de los
   filtros. Tabla "Sucursal / Stock" con el stock del producto
   **seleccionado** en cada sucursal de la organización. Caja "Aplicación
   producto": textarea de **solo lectura** mostrando la nota libre del
   producto seleccionado (nuevo campo `products.notes`, editable solo desde
   el formulario de Productos). Vacíos si no hay producto seleccionado.

6. **Botón "$" (Tasa de Cambio)**: en la esquina superior, abre un modal
   "Tasa de Cambio" (Tasa de Cambio actual Bs readonly + Nueva Tasa de
   cambio Bs + Actualizar/Cancelar) que reutiliza la acción
   `updateExchangeRate` ya existente en Ajustes. Visible solo si el rol
   tiene el permiso `settings:write` (mismo gate que en Ajustes).

7. **Fuera de alcance**: el botón "x" del legacy (toggle de sidebar) no se
   replica — es una función de layout global, no del módulo Ventas.

## Arquitectura

### Archivos nuevos

- `components/ventas/AddToCartModal.tsx` — modal "Cantidad de producto".
  Recibe el producto y tier seleccionados, valida cantidad/stock, y llama
  a un callback `onAdd(line)` provisto por `SalePanel`. No conoce el
  estado del carrito — solo construye la línea y la entrega.
- `components/ventas/ExchangeRateModal.tsx` — modal "Tasa de Cambio".
  Reutiliza `updateExchangeRate` de `app/(dashboard)/ajustes/actions.ts`
  (sin cambios a esa acción). Muestra la tasa actual (prop) y un input
  para la nueva tasa.
- `components/ventas/BranchStockPanel.tsx` — tabla "Sucursal / Stock" +
  caja "Aplicación producto" de solo lectura. Recibe el producto
  seleccionado (o `null`) y la lista de stock por sucursal ya resuelta
  por el servidor.
- `supabase/migrations/00XX_product_notes.sql` — agrega `products.notes
  text` (nullable, sin default).

### Archivos modificados

- `app/(dashboard)/ventas/page.tsx`:
  - Agrega manejo de `page` en `searchParams`, con `range()` para paginar
    (mismo patrón `PAGE_SIZE` que otros módulos, ej. 25). Si hay filtro de
    medida activo, se mantiene el comportamiento actual de mostrar todo el
    rango sin paginar (paginar rompería el orden por cercanía).
  - Calcula `totalPages` vía `count: "exact"` en la query.
  - Pasa `exchangeRate` (de `organizations.exchange_rate`, mismo patrón
    que en Productos) para el modal "$".
  - No resuelve stock multi-sucursal aquí — eso se hace client-side bajo
    demanda cuando se selecciona un producto (ver Data flow).
- `app/(dashboard)/ventas/VentasFilters.tsx`:
  - Quita el debounce/auto-navegación.
  - Se reestructura a layout vertical de 2 columnas, con botones
    "Filtrar" (submit) y "Limpiar" (reset a `/ventas`).
- `components/ventas/SalePanel.tsx`:
  - Se separa en sub-render: tabla paginada (izquierda), columna derecha
    (filtros ya vienen de `page.tsx` como children/slot + `BranchStockPanel`
    + botón "$"), carrito a todo el ancho abajo.
  - Nuevo estado `selectedProductId` para resaltar fila y alimentar
    `BranchStockPanel`.
  - La lógica de "un tipo por venta" se endurece: `addToCart` rechaza si
    `cart.length > 0` y el tier del nuevo ítem no coincide con
    `priceTierForSaleType(saleType)` actual, en vez de recalcular todo el
    carrito silenciosamente.
- `app/(dashboard)/productos/*` — se agrega el campo "Notas" (textarea) al
  formulario de creación/edición de producto (`ProductFormModal.tsx`) y a
  `productSchema`/`parseProductForm` en `actions.ts`. Cambio acotado: un
  campo de texto opcional más, mismo patrón que `application`.

### Data flow — stock por sucursal (panel derecho)

Al seleccionar un producto (clic en fila), `SalePanel` llama a un nuevo
Server Action de solo lectura `getProductBranchStock(productId)`
(`app/(dashboard)/ventas/actions.ts`) que:
1. Verifica sesión/org vía `getProfile()`.
2. Consulta `product_stock` + `branches(name)` filtrando por
   `product_id` (RLS ya aísla por `org_id`).
3. Devuelve `{ branchName: string; quantity: number }[]` y `notes: string
   | null` (de `products.notes`).

Se resuelve on-demand (no en el `page.tsx` inicial) porque depende de la
selección del usuario y evita cargar stock de todas las sucursales para
los ~25 productos de cada página cuando no hace falta.

## Manejo de errores

- Modal cantidad: botón "Agregar" deshabilitado si `cantidad` no es entero
  positivo o excede el stock de sucursal. Mensaje inline, no toast.
- Mezcla de tipos: toast de error ("Esta venta ya tiene productos {tipo
  actual}, no se puede mezclar con {tipo nuevo}."), el modal no se cierra.
- `getProductBranchStock`: si falla, el panel derecho muestra "No se pudo
  cargar el stock por sucursal." sin bloquear el resto de la página.
- Migración `notes`: columna nullable sin default — no rompe productos
  existentes ni requiere backfill.

## Testing

- Mantener cobertura existente de `calculateSaleTotal`/`calculateLineSubtotal`
  (sin cambios de comportamiento).
- Nuevos tests:
  - `AddToCartModal`: valida cantidad > stock → deshabilita Agregar;
    precio custom sobreescribe el de catálogo; cantidad vacía no agrega.
  - `SalePanel` (o función extraída): bloqueo de mezcla de tipos —
    agregar un tier distinto al del carrito no vacío es rechazado.
  - Paginación en `page.tsx`: página fuera de rango no rompe (clamp a
    `totalPages`), filtro de medida activo ignora `page`.
  - `getProductBranchStock`: devuelve stock correcto multi-sucursal para
    un producto de prueba (test de integración contra Supabase local si
    existe, o mock si no).

## Fuera de alcance (explícitamente descartado durante el brainstorming)

- No se replica el botón "x" (toggle de sidebar) — layout global, no
  Ventas.
- No se permite mezclar tipos de venta CF/SF/MAY en una misma venta —
  se mantiene la restricción ya vigente pese a que el legacy sugiere
  grupos mixtos.
- La nota "Aplicación producto" no es editable desde Ventas — solo
  lectura, se edita en Productos.
