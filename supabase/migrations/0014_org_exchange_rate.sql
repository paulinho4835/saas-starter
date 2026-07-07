-- ============================================================================
-- Tipo de cambio global por organización: antes vivía por producto
-- (products.exchange_rate, editable en cada ficha). Ahora es un valor único
-- por organización que, al cambiar, recalcula el precio de TODOS los
-- productos automáticamente. products.exchange_rate se conserva (lo usa
-- dashboard_capital_by_branch en 0007_dashboard.sql) pero deja de ser
-- editable desde el formulario de producto — siempre queda sincronizado con
-- organizations.exchange_rate.
-- ============================================================================

alter table organizations
  add column exchange_rate numeric not null default 6.96;

-- Backfill: usar el tipo de cambio más frecuente entre los productos
-- existentes de cada organización (si tiene productos con exchange_rate).
with rates as (
  select org_id, exchange_rate, count(*) as cnt
  from products
  where exchange_rate is not null
  group by org_id, exchange_rate
),
ranked as (
  select org_id, exchange_rate,
         row_number() over (partition by org_id order by cnt desc, exchange_rate desc) as rn
  from rates
)
update organizations o
set exchange_rate = r.exchange_rate
from ranked r
where r.org_id = o.id and r.rn = 1;

-- Recalcula el tipo de cambio y los precios de todos los productos de una
-- organización en una sola transacción. security invoker: respeta RLS del
-- usuario que llama (org_update exige rol admin; products_update exige
-- misma org), igual que el resto de funciones de agregación del proyecto.
create or replace function set_org_exchange_rate(p_org_id uuid, p_exchange_rate numeric)
returns void
language sql
security invoker
as $$
  update organizations
  set exchange_rate = p_exchange_rate
  where id = p_org_id;

  update products
  set exchange_rate = p_exchange_rate,
      price_sf_bs = round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_sf_pct, 0) / 100), 2),
      price_cf_bs = round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_cf_pct, 0) / 100), 2),
      price_may_bs = round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_may_pct, 0) / 100), 2),
      updated_at = now()
  where org_id = p_org_id
    and cost_usd is not null
    and margin_sf_pct is not null
    and margin_cf_pct is not null
    and margin_may_pct is not null;
$$;

grant execute on function set_org_exchange_rate(uuid, numeric) to authenticated, service_role;
