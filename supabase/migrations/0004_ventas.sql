-- ============================================================================
-- Fase 2: Ventas.
-- Ver docs/superpowers/specs/2026-07-01-ventas-design.md
-- ============================================================================

-- ── Sucursal fija del vendedor ───────────────────────────────────────────
alter table profiles add column branch_id uuid references branches (id) on delete set null;

-- ── Ventas ───────────────────────────────────────────────────────────────
create table sales (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  branch_id   uuid not null references branches (id),
  seller_id   uuid not null references profiles (id),
  customer_id uuid references customers (id) on delete set null,
  total_bs    numeric not null default 0,
  created_at  timestamptz not null default now()
);
create index sales_org_id_idx on sales (org_id);

-- ── Líneas de venta ──────────────────────────────────────────────────────
create table sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references sales (id) on delete cascade,
  product_id    uuid not null references products (id),
  price_tier    text not null check (price_tier in ('sf', 'cf', 'may')),
  unit_price_bs numeric not null,
  quantity      integer not null check (quantity > 0),
  subtotal_bs   numeric not null
);
create index sale_items_sale_id_idx on sale_items (sale_id);

-- ============================================================================
-- RLS — mismo patrón que 0001_init.sql / 0002_productos.sql.
-- Sin políticas update/delete: en esta fase una venta confirmada no se edita
-- ni se anula (eso es Fase 4: Traspasos/Devoluciones).
-- ============================================================================
alter table sales      enable row level security;
alter table sale_items enable row level security;

create policy sales_select on sales for select using (org_id = auth_org_id());
create policy sales_insert on sales for insert with check (org_id = auth_org_id());

create policy sale_items_select on sale_items for select using (
  exists (select 1 from sales s where s.id = sale_items.sale_id and s.org_id = auth_org_id())
);
create policy sale_items_insert on sale_items for insert with check (
  exists (select 1 from sales s where s.id = sale_items.sale_id and s.org_id = auth_org_id())
);
