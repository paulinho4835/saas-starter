-- ============================================================================
-- Soft-delete de productos (active) + fórmula de CF corregida y consistente:
-- CF Bs siempre se deriva de SF Bs × 1.13 (antes usaba margin_cf_pct como
-- input independiente, con fórmulas inconsistentes entre el formulario y el
-- reporte legacy). Ver
-- docs/superpowers/specs/2026-07-08-productos-legacy-replica-design.md
-- ============================================================================

alter table products
  add column active boolean not null default true;

-- Recalcula margin_cf_pct/price_cf_bs de los productos existentes con la
-- fórmula derivada, para que queden consistentes con la nueva regla antes de
-- que código nuevo dependa de ella.
update products
set price_cf_bs = round(price_sf_bs * 1.13, 2),
    margin_cf_pct = case
      when cost_usd is not null and exchange_rate is not null
           and cost_usd * exchange_rate > 0
        then round((round(price_sf_bs * 1.13, 2) / (cost_usd * exchange_rate) - 1) * 100, 2)
      else margin_cf_pct
    end
where price_sf_bs is not null;

-- set_org_exchange_rate (0014_org_exchange_rate.sql) recalculaba CF a partir
-- de margin_cf_pct almacenado, con una fórmula independiente. Se reemplaza
-- para que derive CF de SF×1.13, igual que
-- app/(dashboard)/productos/actions.ts (Task 3).
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
      price_may_bs = round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_may_pct, 0) / 100), 2),
      price_cf_bs = round(
        round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_sf_pct, 0) / 100), 2) * 1.13,
        2
      ),
      margin_cf_pct = case
        when coalesce(cost_usd, 0) * p_exchange_rate > 0
          then round((
            round(
              round(coalesce(cost_usd, 0) * p_exchange_rate * (1 + coalesce(margin_sf_pct, 0) / 100), 2) * 1.13,
              2
            ) / (coalesce(cost_usd, 0) * p_exchange_rate) - 1
          ) * 100, 2)
        else 0
      end,
      updated_at = now()
  where org_id = p_org_id
    and cost_usd is not null
    and margin_sf_pct is not null
    and margin_may_pct is not null;
$$;

grant execute on function set_org_exchange_rate(uuid, numeric) to authenticated, service_role;
