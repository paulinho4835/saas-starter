-- ============================================================================
-- Dashboard: total y cantidad de ventas del período agregados en Postgres.
-- Antes se traían todas las filas de sales.total_bs a Node para sumarlas en
-- JS; con "todo el histórico" (period=all) eso escala con toda la historia
-- de ventas de la organización.
-- ============================================================================

create or replace function dashboard_sales_summary(
  p_org_id uuid,
  p_since timestamptz,
  p_sale_types text[] default null
)
returns table (total_bs numeric, sales_count bigint)
language sql
security invoker
stable
as $$
  select
    coalesce(sum(s.total_bs), 0)::numeric,
    count(*)::bigint
  from sales s
  where s.org_id = p_org_id
    and s.created_at >= p_since
    and (p_sale_types is null or s.sale_type = any(p_sale_types));
$$;

grant execute on function dashboard_sales_summary(uuid, timestamptz, text[]) to authenticated, service_role;
