# Ventas: medidas de producto en tabla — Diseño

## Contexto

Adenda a la Fase 2 (`docs/superpowers/specs/2026-07-01-ventas-design.md`), ya
implementada y en producción/QA. El spec original de Ventas documentaba como
referencia visual una lista de productos con 3 filas de precio (CF/SF/MAY)
por producto, mostrando también las medidas físicas (MI/ME/ALT/PEST/TOPE).
La implementación real simplificó esto a 1 fila por producto con 3 botones
(+SF/+CF/+MAY) y **no muestra las medidas**, aunque los filtros de búsqueda
por MI/ME/ALT/PEST/TOPE sí funcionan (comparan contra columnas que ya existen
en `products`: `internal_mm`, `external_mm`, `height_mm`, `flange_mm`,
`stop_mm`).

Pedido del usuario: quiere ver las medidas del producto al vender, sin tener
que adivinar cuál es cuál — replicando (funcionalmente, no estéticamente) la
tabla del sistema PHP viejo.

**Fuera de alcance:** la columna `EQUIV` de la captura vieja no tiene
concepto equivalente en el esquema actual (no existe tabla ni relación de
"producto equivalente"). El spec original de Ventas ya la descartó
explícitamente, cubierta en su lugar por la búsqueda con tolerancia
(`lib/measurementSearch.ts`). No se construye aquí.

## Cambios

### 1. `app/(dashboard)/ventas/page.tsx`

`RESULT_SELECT` ya filtra por las 5 columnas de medida pero no las trae de
vuelta. Se agregan al select y al `products.map(...)` que arma
`ProductResult`:

```typescript
const RESULT_SELECT =
  "id, code, application, price_sf_bs, price_cf_bs, price_may_bs, internal_mm, external_mm, height_mm, flange_mm, stop_mm, product_brands(name), product_stock!inner(quantity)";
```

Nuevos campos en `ProductResultRow` y en el objeto mapeado a `SalePanel`:
`internalMm`, `externalMm`, `heightMm`, `flangeMm`, `stopMm` (todos
`number | null`, tal como están en la tabla `products`).

### 2. `components/ventas/SalePanel.tsx`

La lista `<ul>` de productos (líneas 128-156 actuales) se reemplaza por una
tabla:

- **Encabezado:** Código · Marca · Stock · Tipo · Precio (Bs) · MI · ME ·
  ALT · PEST · TOPE.
- **3 sub-filas por producto** (SF, CF, MAY — mismo orden que
  `TIER_LABEL`), cada una clickeable: el clic llama a `addToCart(product,
  tier)` (misma función que ya existe, sin cambios en su firma ni en la
  lógica del carrito).
- **Código, Marca, Stock y las 5 columnas de medida** se muestran una sola
  vez por producto (`rowSpan={3}` en la primera sub-fila), no repetidos en
  las 3 — son iguales para los 3 tiers de precio, solo el precio y el tipo
  cambian por fila. La aplicación (`p.application`, ya mostrada hoy como
  texto secundario bajo el código) se conserva dentro de la celda de
  Código, también con `rowSpan={3}`.
- Si `stock <= 0`, las 3 sub-filas del producto quedan deshabilitadas
  (mismo criterio que hoy usa el botón `disabled={p.stock <= 0}`), con
  estilo visual atenuado (`opacity-50 cursor-not-allowed`) en vez de
  ocultarse.
- **Medidas nulas** se muestran como `—`. Las que sí tienen valor se
  formatean sin ceros decimales sobrantes (`12` en vez de `12.00`,
  `12.5` se mantiene) vía un helper `formatMm(value: number | null)`
  local al componente.
- Tinte de fondo sutil por tier (igual espíritu que la captura vieja, sin
  copiar sus colores exactos) usando las clases ya existentes del design
  system — detalle menor, no bloqueante si no calza pixel-perfect.
- El resto del componente (carrito, `onConfirm`, `createSale`) no cambia.

### 3. Sin cambios de datos ni de server actions

No se toca el esquema, RLS, ni `actions.ts`. Es un cambio de lectura +
presentación sobre columnas que ya existen y ya se usan para filtrar.

## Testing

Sin tests automatizados nuevos (mismo patrón que el resto de Ventas: sin
suite para páginas/componentes de UI de Supabase). Verificación manual:
cargar `/ventas`, confirmar que las 5 columnas de medida aparecen con datos
reales, que cada una de las 3 sub-filas por producto agrega el tier correcto
al carrito, que un producto con `stock = 0` no permite agregar, y que
`npm run typecheck` pasa en 0 errores.
