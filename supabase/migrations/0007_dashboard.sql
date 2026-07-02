-- ============================================================================
-- Dashboard: agregaciones que cruzan tablas (capital al costo, top productos).
-- Ver docs/superpowers/specs/2026-07-02-dashboard-design.md
-- ============================================================================

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
