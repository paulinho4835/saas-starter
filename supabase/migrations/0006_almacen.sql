-- ============================================================================
-- Almacén: la sucursal-depósito y la transferencia atómica hacia una tienda.
-- Ver docs/superpowers/specs/2026-07-02-almacen-design.md
-- ============================================================================

alter table branches add column is_warehouse boolean not null default false;

-- Garantiza como máximo un almacén por organización.
create unique index branches_one_warehouse_per_org_idx
  on branches (org_id) where is_warehouse;

-- 'transferencia' se usa dos veces por operación: una fila negativa en la
-- sucursal de origen (almacén) y una positiva en la de destino.
alter table stock_movements drop constraint stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('alta_inicial', 'importacion', 'ajuste_manual', 'venta', 'transferencia'));

create or replace function transfer_stock(
  p_org_id           uuid,
  p_product_id       uuid,
  p_from_branch_id   uuid,
  p_to_branch_id     uuid,
  p_quantity         integer,
  p_actor_id         uuid
) returns void
language plpgsql
security invoker
as $$
declare
  v_from_qty integer;
  v_to_qty   integer;
begin
  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a 0.';
  end if;
  if p_from_branch_id = p_to_branch_id then
    raise exception 'La sucursal de origen y destino no pueden ser la misma.';
  end if;

  select quantity into v_from_qty
    from product_stock
   where product_id = p_product_id and branch_id = p_from_branch_id
     for update;

  if v_from_qty is null or v_from_qty < p_quantity then
    raise exception 'No hay stock suficiente en el almacén para transferir esa cantidad.';
  end if;

  update product_stock
     set quantity = quantity - p_quantity, updated_at = now()
   where product_id = p_product_id and branch_id = p_from_branch_id;

  insert into product_stock (org_id, product_id, branch_id, quantity)
  values (p_org_id, p_product_id, p_to_branch_id, p_quantity)
  on conflict (product_id, branch_id)
  do update set quantity = product_stock.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_to_qty;

  insert into stock_movements
    (org_id, product_id, branch_id, movement_type, quantity_delta, resulting_quantity, reason, actor_id)
  values
    (p_org_id, p_product_id, p_from_branch_id, 'transferencia', -p_quantity, v_from_qty - p_quantity,
     'Transferencia a sucursal', p_actor_id),
    (p_org_id, p_product_id, p_to_branch_id, 'transferencia', p_quantity, v_to_qty,
     'Transferencia desde Almacén', p_actor_id);
end;
$$;

-- Grant explícito (no depende de que 0003_grants.sql exista en esta rama):
-- authenticated necesita poder ejecutar el RPC desde el server action.
grant execute on function transfer_stock(uuid, uuid, uuid, uuid, integer, uuid)
  to authenticated, service_role;
