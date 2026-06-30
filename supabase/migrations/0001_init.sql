-- ============================================================================
-- Esquema inicial del SaaS multi-tenant.
--   organizations  → el "tenant" (cada cuenta cliente)
--   profiles       → usuarios, 1:1 con auth.users, ligados a una organización
--   platform_admins→ operadores de la plataforma (dueños del SaaS / superadmin)
--   customers      → entidad de negocio de EJEMPLO (copia este patrón)
--   items          → segunda entidad de EJEMPLO (inventario)
--   audit_log      → bitácora opcional
--
-- Aislamiento: cada tabla de negocio tiene org_id y políticas RLS que comparan
-- contra auth_org_id() (la organización del usuario autenticado). El service-role
-- (panel /superadmin) BYPASSA RLS por diseño.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Organizaciones ──────────────────────────────────────────────────────────
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  features   jsonb not null default '{}'::jsonb,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Perfiles (usuarios) ─────────────────────────────────────────────────────
create table profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  org_id                  uuid not null references organizations (id) on delete cascade,
  full_name               text not null default '',
  role                    text not null default 'member'
                            check (role in ('admin', 'manager', 'member', 'viewer')),
  active                  boolean not null default true,
  terms_accepted_at       timestamptz,
  terms_accepted_version  text,
  created_at              timestamptz not null default now()
);
create index profiles_org_id_idx on profiles (org_id);

-- ── Operadores de la plataforma (superadmin) ────────────────────────────────
create table platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ── Helper: organización del usuario autenticado ────────────────────────────
-- SECURITY DEFINER + search_path fijo para que la lectura de profiles dentro de
-- la función no dispare las propias políticas RLS (evita recursión).
create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid()
$$;

create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- Rol del usuario autenticado. SECURITY DEFINER para que las políticas puedan
-- consultarlo sin volver a disparar la RLS de profiles (evita recursión infinita
-- al comparar el rol dentro de una policy sobre la propia tabla profiles).
create or replace function auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

-- ── Entidad de ejemplo: clientes ────────────────────────────────────────────
create table customers (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  full_name  text not null,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);
create index customers_org_id_idx on customers (org_id);

-- ── Entidad de ejemplo: items de inventario ─────────────────────────────────
create table items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  quantity   integer not null default 0,
  created_at timestamptz not null default now()
);
create index items_org_id_idx on items (org_id);

-- ── Bitácora de auditoría (opcional) ────────────────────────────────────────
create table audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid references organizations (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_id_idx on audit_log (org_id);

-- ============================================================================
-- RLS
-- ============================================================================
alter table organizations  enable row level security;
alter table profiles        enable row level security;
alter table platform_admins enable row level security;
alter table customers       enable row level security;
alter table items           enable row level security;
alter table audit_log       enable row level security;

-- organizations: cada usuario ve solo la suya; el admin puede editarla.
create policy org_select on organizations
  for select using (id = auth_org_id());
create policy org_update on organizations
  for update using (id = auth_org_id() and auth_role() = 'admin');

-- profiles: cada usuario ve los de su organización; puede editar su PROPIA fila
-- (p. ej. aceptar términos); el admin puede editar las filas de su organización.
create policy profiles_select on profiles
  for select using (org_id = auth_org_id());
create policy profiles_update_self on profiles
  for update using (id = auth.uid());
create policy profiles_update_admin on profiles
  for update using (org_id = auth_org_id() and auth_role() = 'admin');

-- platform_admins: cada quien puede comprobar si ÉL es operador (self-select).
create policy platform_admins_self on platform_admins
  for select using (user_id = auth.uid());

-- Helper de políticas de negocio: pertenece a mi organización.
-- (Se repite el patrón en cada tabla; cópialo para tus entidades nuevas.)

-- customers
create policy customers_select on customers
  for select using (org_id = auth_org_id());
create policy customers_insert on customers
  for insert with check (org_id = auth_org_id());
create policy customers_update on customers
  for update using (org_id = auth_org_id());
create policy customers_delete on customers
  for delete using (org_id = auth_org_id());

-- items
create policy items_select on items
  for select using (org_id = auth_org_id());
create policy items_insert on items
  for insert with check (org_id = auth_org_id());
create policy items_update on items
  for update using (org_id = auth_org_id());
create policy items_delete on items
  for delete using (org_id = auth_org_id());

-- audit_log: solo lectura dentro de la organización (lo escribe el service-role).
create policy audit_select on audit_log
  for select using (org_id = auth_org_id());
