-- ============================================================================
-- Ajuste de Inventario: historial de movimientos de stock.
-- Ver docs/superpowers/specs/2026-07-01-ajuste-inventario-design.md
-- ============================================================================

create table stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations (id) on delete cascade,
  product_id         uuid not null references products (id) on delete cascade,
  branch_id          uuid not null references branches (id),
  movement_type      text not null check (movement_type in ('alta_inicial', 'importacion', 'ajuste_manual', 'venta')),
  quantity_delta     integer not null,
  resulting_quantity integer not null,
  reason             text,
  actor_id           uuid references profiles (id) on delete set null,
  sale_id            uuid references sales (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index stock_movements_org_product_idx on stock_movements (org_id, product_id, created_at desc);
create index stock_movements_org_branch_idx on stock_movements (org_id, branch_id, created_at desc);

-- ============================================================================
-- RLS — ledger inmutable: solo select/insert, mismo patrón que sales/sale_items
-- (0004_ventas.sql). Sin update/delete: un movimiento ya registrado no se edita.
-- ============================================================================
alter table stock_movements enable row level security;

create policy stock_movements_select on stock_movements for select using (org_id = auth_org_id());
create policy stock_movements_insert on stock_movements for insert with check (org_id = auth_org_id());
