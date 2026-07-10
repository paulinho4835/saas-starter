-- supabase/migrations/0019_platform_usage.sql
-- Panel de uso de Supabase en /superadmin: dos funciones de solo lectura
-- que exponen el tamaño real de DB y Storage (las mismas cifras que
-- Supabase usa para medir el plan Free), invocables solo por service_role.

create or replace function public.platform_db_size_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;

create or replace function public.platform_storage_usage_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)
  from storage.objects;
$$;

revoke execute on function public.platform_db_size_bytes() from public, anon, authenticated;
revoke execute on function public.platform_storage_usage_bytes() from public, anon, authenticated;
grant execute on function public.platform_db_size_bytes() to service_role;
grant execute on function public.platform_storage_usage_bytes() to service_role;
