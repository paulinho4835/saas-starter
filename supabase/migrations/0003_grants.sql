-- ============================================================================
-- Privilegios de tabla para los roles de Supabase (anon, authenticated,
-- service_role).
--
-- POR QUÉ: las versiones nuevas del CLI y de Supabase Cloud ya NO otorgan
-- automáticamente los privilegios del Data API (SELECT/INSERT/UPDATE/DELETE)
-- a las tablas nuevas del schema `public` (antes sí, comportamiento "legacy").
-- Sin estos grants, supabase-js recibe "permission denied for table ..." y lo
-- devuelve como `data: null`, dejando la app sin poder leer perfiles, orgs ni
-- ninguna tabla de negocio (ej. el sidebar/nav aparece vacío).
--
-- SEGURIDAD: el control de acceso real por fila lo hace RLS (habilitado en cada
-- tabla, con políticas que comparan contra auth_org_id()). Estos grants solo
-- habilitan el acceso a nivel de tabla; RLS sigue filtrando qué filas ve cada
-- organización. El service_role sigue bypasseando RLS por diseño (panel
-- /superadmin). Este es el mismo modelo que Supabase aplicaba por defecto.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- Tablas/secuencias/funciones creadas por migraciones futuras heredan los mismos
-- privilegios, para no repetir este bloque en cada migración.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;
