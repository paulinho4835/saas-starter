-- ============================================================================
-- Fase 1: Productos + Sucursales + Stock.
-- Ver docs/superpowers/specs/2026-06-30-productos-sucursales-stock-design.md
-- ============================================================================

-- ── Sucursales ───────────────────────────────────────────────────────────
create table branches (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index branches_org_name_idx on branches (org_id, lower(name));

-- ── Marcas ───────────────────────────────────────────────────────────────
create table product_brands (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index product_brands_org_name_idx on product_brands (org_id, lower(name));

-- ── Familias ─────────────────────────────────────────────────────────────
create table product_families (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index product_families_org_name_idx on product_families (org_id, lower(name));

-- ── Procedencias ─────────────────────────────────────────────────────────
create table product_origins (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index product_origins_org_name_idx on product_origins (org_id, lower(name));

-- ── Proveedores ──────────────────────────────────────────────────────────
create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations (id) on delete cascade,
  name         text not null,
  phone        text,
  contact_name text,
  notes        text,
  created_at   timestamptz not null default now()
);
create unique index suppliers_org_name_idx on suppliers (org_id, lower(name));

-- ── Productos ────────────────────────────────────────────────────────────
create table products (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id) on delete cascade,
  code           text not null,
  brand_id       uuid not null references product_brands (id),
  family_id      uuid not null references product_families (id),
  origin_id      uuid references product_origins (id) on delete set null,
  supplier_id    uuid references suppliers (id) on delete set null,
  internal_mm    numeric,
  external_mm    numeric,
  height_mm      numeric,
  flange_mm      numeric,
  stop_mm        numeric,
  application    text,
  cost_usd       numeric,
  exchange_rate  numeric,
  margin_sf_pct  numeric,
  margin_cf_pct  numeric,
  margin_may_pct numeric,
  price_sf_bs    numeric not null default 0,
  price_cf_bs    numeric not null default 0,
  price_may_bs   numeric not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Llave de coincidencia para alta manual y carga masiva (ver spec).
create unique index products_org_code_brand_idx on products (org_id, code, brand_id);
create index products_org_id_idx on products (org_id);

-- ── Stock por sucursal ───────────────────────────────────────────────────
create table product_stock (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  branch_id  uuid not null references branches (id) on delete cascade,
  quantity   integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (product_id, branch_id)
);
create index product_stock_org_id_idx on product_stock (org_id);

-- ============================================================================
-- RLS — mismo patrón que 0001_init.sql: aislamiento por org_id = auth_org_id().
-- ============================================================================
alter table branches         enable row level security;
alter table product_brands   enable row level security;
alter table product_families enable row level security;
alter table product_origins  enable row level security;
alter table suppliers        enable row level security;
alter table products         enable row level security;
alter table product_stock    enable row level security;

create policy branches_select on branches for select using (org_id = auth_org_id());
create policy branches_insert on branches for insert with check (org_id = auth_org_id());
create policy branches_update on branches for update using (org_id = auth_org_id());
create policy branches_delete on branches for delete using (org_id = auth_org_id());

create policy product_brands_select on product_brands for select using (org_id = auth_org_id());
create policy product_brands_insert on product_brands for insert with check (org_id = auth_org_id());
create policy product_brands_update on product_brands for update using (org_id = auth_org_id());
create policy product_brands_delete on product_brands for delete using (org_id = auth_org_id());

create policy product_families_select on product_families for select using (org_id = auth_org_id());
create policy product_families_insert on product_families for insert with check (org_id = auth_org_id());
create policy product_families_update on product_families for update using (org_id = auth_org_id());
create policy product_families_delete on product_families for delete using (org_id = auth_org_id());

create policy product_origins_select on product_origins for select using (org_id = auth_org_id());
create policy product_origins_insert on product_origins for insert with check (org_id = auth_org_id());
create policy product_origins_update on product_origins for update using (org_id = auth_org_id());
create policy product_origins_delete on product_origins for delete using (org_id = auth_org_id());

create policy suppliers_select on suppliers for select using (org_id = auth_org_id());
create policy suppliers_insert on suppliers for insert with check (org_id = auth_org_id());
create policy suppliers_update on suppliers for update using (org_id = auth_org_id());
create policy suppliers_delete on suppliers for delete using (org_id = auth_org_id());

create policy products_select on products for select using (org_id = auth_org_id());
create policy products_insert on products for insert with check (org_id = auth_org_id());
create policy products_update on products for update using (org_id = auth_org_id());
create policy products_delete on products for delete using (org_id = auth_org_id());

create policy product_stock_select on product_stock for select using (org_id = auth_org_id());
create policy product_stock_insert on product_stock for insert with check (org_id = auth_org_id());
create policy product_stock_update on product_stock for update using (org_id = auth_org_id());
create policy product_stock_delete on product_stock for delete using (org_id = auth_org_id());
