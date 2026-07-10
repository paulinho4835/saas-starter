-- ============================================================================
-- Reporte de Ventas: totales (Bs, Efectivo, QR) calculados en Postgres sobre
-- TODO el rango filtrado, no solo sobre las filas que se traen a pantalla.
-- Antes se sumaban en JS las primeras 2000 filas (RESULT_LIMIT) — si el rango
-- de fechas tenía más ventas que eso, los totales de cuadre de caja quedaban
-- mal en silencio. Ahora la tabla en pantalla se pagina, pero los totales
-- siempre reflejan el rango completo.
-- ============================================================================

create or replace function report_sales_totals(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid,
  p_sale_types text[],
  p_customer_ids uuid[],
  p_efectivo_types text[],
  p_qr_types text[]
)
returns table (
  total_bs numeric,
  total_efectivo_bs numeric,
  total_qr_bs numeric,
  items_count bigint
)
language sql
security invoker
stable
as $$
  select
    coalesce(sum(si.subtotal_bs), 0)::numeric,
    coalesce(sum(si.subtotal_bs) filter (where s.sale_type = any(p_efectivo_types)), 0)::numeric,
    coalesce(sum(si.subtotal_bs) filter (where s.sale_type = any(p_qr_types)), 0)::numeric,
    count(*)::bigint
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.org_id = p_org_id
    and s.created_at >= p_from
    and s.created_at <= p_to
    and (p_branch_id is null or s.branch_id = p_branch_id)
    and (p_sale_types is null or s.sale_type = any(p_sale_types))
    and (p_customer_ids is null or s.customer_id = any(p_customer_ids));
$$;

grant execute on function report_sales_totals(uuid, timestamptz, timestamptz, uuid, text[], uuid[], text[], text[]) to authenticated, service_role;
