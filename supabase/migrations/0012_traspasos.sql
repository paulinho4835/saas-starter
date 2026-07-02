-- ============================================================================
-- Traspasos: transferencia general de stock entre sucursales (no solo desde
-- el almacén). Reemplaza transfer_stock() para que el `reason` describa la
-- sucursal contraria en vez del texto fijo "desde Almacén", que era incorrecto
-- para traspasos que no involucran al almacén.
-- Ver docs/superpowers/specs/2026-07-02-traspasos-design.md
-- ============================================================================

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
  v_from_name text;
  v_to_name   text;
begin
  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a 0.';
  end if;
  if p_from_branch_id = p_to_branch_id then
    raise exception 'La sucursal de origen y destino no pueden ser la misma.';
  end if;

  select name into v_from_name from branches where id = p_from_branch_id;
  select name into v_to_name from branches where id = p_to_branch_id;

  select quantity into v_from_qty
    from product_stock
   where product_id = p_product_id and branch_id = p_from_branch_id
     for update;

  if v_from_qty is null or v_from_qty < p_quantity then
    raise exception 'No hay stock suficiente en la sucursal de origen para transferir esa cantidad.';
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
     'Transferencia a ' || coalesce(v_to_name, 'otra sucursal'), p_actor_id),
    (p_org_id, p_product_id, p_to_branch_id, 'transferencia', p_quantity, v_to_qty,
     'Transferencia desde ' || coalesce(v_from_name, 'otra sucursal'), p_actor_id);
end;
$$;

grant execute on function transfer_stock(uuid, uuid, uuid, uuid, integer, uuid)
  to authenticated, service_role;
