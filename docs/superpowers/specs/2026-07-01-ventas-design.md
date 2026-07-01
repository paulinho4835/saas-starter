# Fase 2: Ventas — Diseño

## Contexto

Continuación de la Fase 1 (Productos + Sucursales + Stock, ver
`docs/superpowers/specs/2026-06-30-productos-sucursales-stock-design.md`), ya
implementada y en QA manual. Esta fase agrega el panel de **Ventas**: buscar
productos por catálogo o por medidas físicas, armar un carrito, y confirmar
una venta que descuenta stock de la sucursal del vendedor.

Referencia visual: capturas del sistema PHP viejo, pantalla "Ventas" —
filtros por Aplicación/Código/Marca/MI/ME/Altura/Pestaña/Tope, lista de
productos con 3 filas de precio (CF/SF/MAY) por producto, stock visible por
sucursal, botón "Equiv" (queda cubierto por la búsqueda con tolerancia, ver
abajo — no se construye como funcionalidad separada).

## Modelo de datos

Sigue el patrón ya establecido: `org_id` + RLS contra `auth_org_id()`.

### Cambio a tabla existente: `profiles`

```sql
alter table profiles add column branch_id uuid references branches (id) on delete set null;
```

Nullable: no todo usuario necesita sucursal (ej. antes de que el admin se la
asigne), pero **confirmar una venta requiere que el vendedor tenga
`branch_id` asignado** — si no, la acción de venta devuelve un error
explícito pidiendo que el admin se lo asigne primero en `/ajustes`.

### Tablas nuevas

```sql
sales (ventas)
  id          uuid primary key default gen_random_uuid()
  org_id      uuid not null references organizations (id) on delete cascade
  branch_id   uuid not null references branches (id)
  seller_id   uuid not null references profiles (id)
  customer_id uuid references customers (id)          -- nullable: venta "mostrador"
  total_bs    numeric not null
  created_at  timestamptz not null default now()

sale_items (líneas de venta)
  id            uuid primary key default gen_random_uuid()
  sale_id       uuid not null references sales (id) on delete cascade
  product_id    uuid not null references products (id)
  price_tier    text not null check (price_tier in ('sf', 'cf', 'may'))
  unit_price_bs numeric not null   -- precio realmente cobrado (el vendedor puede editarlo)
  quantity      numeric not null check (quantity > 0)
  subtotal_bs   numeric not null   -- unit_price_bs * quantity, calculado en el server action
```

RLS: `select`/`insert` filtrados por `org_id = auth_org_id()`, igual que el
resto de tablas de negocio. No hay `update`/`delete` de ventas en esta fase
(anular/devolver una venta es Fase 4 — Devoluciones).

`customers` no cambia — se reutiliza tal cual existe hoy.

## Búsqueda de productos

Página `/ventas`, filtros:

- **Código** y **Aplicación**: `ilike '%valor%'` (texto).
- **Marca**: select exacto (mismo catálogo `product_brands` de Fase 1).
- **MI / ME / Altura / Pestaña / Tope**: cada uno es un campo numérico
  opcional; si se llena, filtra `between valor - 0.5 and valor + 0.5` (rango
  de tolerancia fijo de ±0.5mm, no configurable en esta versión).

Los resultados solo muestran productos con fila en `product_stock` para
`branch_id = profile.branch_id` (la sucursal del vendedor) — no se pueden
vender productos de otra sucursal desde este panel. Cada resultado muestra
código, marca, familia, aplicación, stock en esa sucursal, y los 3 precios
(SF/CF/MAY) ya calculados en `products`.

## Carrito y confirmación de venta

- Carrito vive en estado de cliente (React), no se persiste hasta confirmar.
- Por cada producto agregado: elegir **nivel de precio** (SF/CF/MAY,
  precarga el valor de `products.price_*_bs` correspondiente) y **cantidad**;
  el precio queda editable a mano por si el vendedor da un precio especial
  puntual.
- Cliente (`customer_id`) opcional: buscar uno existente de `customers` o
  dejar la venta sin cliente asociado.
- Botón **"Confirmar venta"** manda todo el carrito de una vez a un server
  action `createSale(formData)` que, todo-o-nada:
  1. Valida stock suficiente por cada línea en `product_stock` (sucursal del
     vendedor).
  2. Si alguna línea no alcanza, no confirma nada — informa qué producto(s)
     fallaron y cuánto stock hay disponible.
  3. Si todas alcanzan: descuenta cada línea de `product_stock`, inserta
     `sales` + `sale_items`, calcula `total_bs` como suma de `subtotal_bs`.
  4. Si un descuento de stock falla a mitad de camino (error de red/DB),
     revierte (compensa) los descuentos ya aplicados de líneas anteriores en
     la misma venta — mismo patrón de compensación ya usado en Fase 1 (Task
     10: `createProduct` revierte el insert de producto si falla el insert de
     stock).
- No se genera comprobante imprimible en esta fase — la venta queda como
  registro interno, consultable después (reporte de ventas es Fase 5).

## Permisos y navegación

- Feature flag nuevo `ventas` (opt-in por organización, mismo patrón que
  `productos`/`proveedores` en `lib/features.ts`).
- Permiso nuevo `ventas:create` en `lib/rbac.ts`: **admin, manager, member**
  pueden buscar y confirmar ventas. **viewer** no ve el módulo en el nav
  (vender es una acción, no una lectura — mismo criterio que ya aplica a
  Productos/Proveedores para el rol viewer).

## Cambio a `/ajustes`: asignar sucursal a cada usuario

El admin asigna la sucursal de cada vendedor desde la pantalla de equipo que
ya existe (`TeamPanel`, `/ajustes`):

- Al **invitar** un usuario nuevo: selector de sucursal opcional junto al
  selector de rol ya existente.
- Al **editar** un usuario existente: selector de sucursal editable en cada
  fila de la lista de miembros (mismo patrón de "editar y guardar" que ya usa
  el stock por sucursal en `ProductFormModal`).

## Fuera de alcance de esta fase (explícitamente diferido)

- Botón "Equiv" como funcionalidad independiente — cubierto por la búsqueda
  con tolerancia de medidas.
- Comprobante/ticket imprimible de la venta.
- Anular o devolver una venta confirmada (Fase 4: Traspasos/Devoluciones).
- Reporte de ventas con filtros/gráficos (Fase 5: Reportes).
- Permitir que el propio vendedor cambie su sucursal (solo el admin la
  asigna en esta fase).
- Relajar los campos obligatorios del import de productos (código/marca/
  familia) para permitir productos sin código buscables solo por medida —
  quedó pendiente de una conversación previa, explícitamente diferido a
  petición del usuario para no mezclarlo con esta fase.
