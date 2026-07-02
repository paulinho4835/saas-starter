# Dashboard — Design Spec

## Contexto

El dashboard actual (`app/(dashboard)/dashboard/page.tsx`) es el placeholder del
template original: cuenta `customers` e `items` (módulo genérico "Inventario",
sin relación con el negocio real de repuestos). Paulo pidió un dashboard real:
qué productos se venden, cuánto capital hay invertido en la tienda, y "todo lo
que creas necesario".

El negocio ya tiene los datos para esto: `products` trae `cost_usd` +
`exchange_rate` (costo real de cada producto), `product_stock` el stock por
sucursal, y `sales`/`sale_items` el historial de ventas con cantidad y
subtotal por línea.

## Decisiones previas (de la fase de preguntas)

1. **Capital = valor al costo**: `stock × cost_usd × exchange_rate`, no precio
   de venta.
2. **Alcance organización completa, con desglose por sucursal** (no solo la
   sucursal del usuario logueado).
3. **Ventas: últimos 30 días por defecto**, con selector para cambiar a 7
   días / este mes / todo el tiempo.
4. **Capital es solo para admin** (dato financiero sensible). Ventas, top
   productos y stock bajo son visibles para cualquier rol con acceso al
   dashboard (hoy: todos, es una página `core`).
5. Se agrega **alerta de stock bajo/agotado** (no pedida explícitamente, pero
   encaja con Almacén: saber cuándo reponer). Umbral fijo `LOW_STOCK_THRESHOLD
   = 5` unidades, sobre sucursales de venta (excluye el almacén — tiene
   volumen mayor por diseño, no aplica la misma alerta).
6. Se **quita** la tarjeta "Items en inventario" (módulo genérico sin uso
   real en este negocio). Se mantiene "Clientes" (dato real, usado en Ventas).

## Sección 1: Cálculo de capital — función SQL (aprobada)

El capital cruza `product_stock.quantity` con `products.cost_usd` y
`products.exchange_rate` — no es una suma de una sola columna, así que
PostgREST no puede agregarlo directo. Se agrega una función, mismo patrón que
`transfer_stock` (Almacén):

```sql
create or replace function dashboard_capital_by_branch(p_org_id uuid)
returns table (branch_id uuid, branch_name text, capital_bs numeric)
language sql
security invoker
stable
as $$
  select
    b.id,
    b.name,
    coalesce(sum(ps.quantity * p.cost_usd * p.exchange_rate), 0)::numeric
  from branches b
  left join product_stock ps on ps.branch_id = b.id
  left join products p on p.id = ps.product_id
  where b.org_id = p_org_id
  group by b.id, b.name
  order by b.name;
$$;

grant execute on function dashboard_capital_by_branch(uuid) to authenticated, service_role;
```

`security invoker` + `stable` (sin efectos secundarios, cacheable dentro de
la misma transacción) — respeta RLS igual que el resto del código.

## Sección 2: Top productos vendidos — función SQL (aprobada)

Mismo motivo: cruza `sale_items` con `products`/`product_brands` para mostrar
código y marca, no solo IDs.

```sql
create or replace function dashboard_top_products(p_org_id uuid, p_since timestamptz, p_limit integer)
returns table (
  product_id     uuid,
  code           text,
  brand_name     text,
  quantity_sold  bigint,
  revenue_bs     numeric
)
language sql
security invoker
stable
as $$
  select
    p.id,
    p.code,
    pb.name,
    sum(si.quantity)::bigint,
    sum(si.subtotal_bs)::numeric
  from sale_items si
  join sales s on s.id = si.sale_id
  join products p on p.id = si.product_id
  left join product_brands pb on pb.id = p.brand_id
  where s.org_id = p_org_id and s.created_at >= p_since
  group by p.id, p.code, pb.name
  order by sum(si.quantity) desc
  limit p_limit;
$$;

grant execute on function dashboard_top_products(uuid, timestamptz, integer) to authenticated, service_role;
```

## Sección 3: UI (aprobada)

`app/(dashboard)/dashboard/page.tsx` (server component, reemplaza el actual):

- **Fila de KPIs** (`Stat`, componente ya existente):
  - "Clientes" (cuenta `customers`, como hoy).
  - "Capital invertido" — **solo si `profile.role === "admin"`** — total org
    (suma de `dashboard_capital_by_branch`), formateado en Bs.
  - "Ventas ({período})" — suma de `total_bs` de `sales` en el rango.
  - "Cantidad de ventas ({período})" — `count` de `sales` en el rango.
- **Selector de período** (7 días / 30 días / este mes / todo), client
  component chico con debounce-free `router.replace` (sin necesidad de
  debounce, es un `<select>` con `onChange` directo, no texto libre).
- **Tabla "Top 10 productos vendidos"**: código, marca, cantidad, ingreso —
  del período seleccionado.
- **Tabla "Desglose de capital por sucursal"** — solo admin — sucursal +
  capital, del resultado de `dashboard_capital_by_branch` sin agregar.
- **Lista "Stock bajo"**: productos con `quantity <= 5` en alguna sucursal
  no-almacén, ordenados por cantidad ascendente, máximo 10 filas, con
  nombre de sucursal — para saber qué reponer desde Almacén.

## Fuera de alcance (YAGNI)

- Gráficos (no hay librería de charts en el proyecto; agregarla es una
  decisión aparte, no pedida). Todo se muestra en tarjetas/tablas.
- Comparación contra el período anterior (% de crecimiento) — no pedido.
- Exportar el dashboard a PDF/Excel — no pedido.
- Dashboard personalizable por usuario (elegir qué tarjetas ver) — no pedido.
