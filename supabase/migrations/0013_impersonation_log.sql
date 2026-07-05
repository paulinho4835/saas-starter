-- ============================================================================
-- Registro de impersonación: cuándo un superadmin entró a ver/operar una
-- organización como su admin. Solo visible para superadmin (is_platform_admin()),
-- nunca para la organización. Ver
-- docs/superpowers/specs/2026-07-05-impersonacion-superadmin-design.md
-- ============================================================================

create table impersonation_log (
  id                 uuid primary key default gen_random_uuid(),
  platform_admin_id  uuid not null references auth.users (id) on delete cascade,
  target_org_id      uuid not null references organizations (id) on delete cascade,
  target_profile_id  uuid not null references profiles (id) on delete cascade,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz
);

create index impersonation_log_org_idx on impersonation_log (target_org_id);

alter table impersonation_log enable row level security;

-- Solo lectura para superadmin; las escrituras las hace el service-role
-- client desde los server actions de impersonación (bypassa RLS).
create policy impersonation_log_select on impersonation_log
  for select using (is_platform_admin());
