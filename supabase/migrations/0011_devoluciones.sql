-- ============================================================================
-- Devoluciones: revertir ítems de una venta confirmada sin editarla.
-- Ver docs/superpowers/specs/2026-07-02-devoluciones-design.md
-- ============================================================================

-- ── Devoluciones ─────────────────────────────────────────────────────────
-- Una fila por devolución procesada (una línea de venta puede tener varias
-- devoluciones parciales a lo largo del tiempo). sale_id/product_id/branch_id
-- se duplican desde sale_items/sales, mismo criterio que stock_movements.
create table sale_returns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations (id) on delete cascade,
  sale_item_id  uuid not null references sale_items (id),
  sale_id       uuid not null references sales (id),
  product_id    uuid not null references products (id),
  branch_id     uuid not null references branches (id),
  quantity      integer not null check (quantity > 0),
  amount_bs     numeric not null,
  actor_id      uuid not null references profiles (id),
  created_at    timestamptz not null default now()
);
create index sale_returns_org_id_idx on sale_returns (org_id);
create index sale_returns_sale_item_id_idx on sale_returns (sale_item_id);

alter table sale_returns enable row level security;

create policy sale_returns_select on sale_returns for select using (org_id = auth_org_id());
create policy sale_returns_insert on sale_returns for insert with check (org_id = auth_org_id());

-- ── stock_movements: nuevo tipo 'devolucion' ────────────────────────────────
alter table stock_movements drop constraint stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('alta_inicial', 'importacion', 'ajuste_manual', 'venta', 'transferencia', 'devolucion'));
