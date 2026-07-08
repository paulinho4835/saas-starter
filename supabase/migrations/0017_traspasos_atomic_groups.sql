-- ============================================================================
-- Fix: hace atómica la creación de un traspaso multi-sucursal (un carrito
-- puede generar varios `transfers`, uno por sucursal). Antes cada grupo se
-- creaba con una llamada RPC independiente desde el cliente (una transacción
-- Postgres por grupo); si un grupo fallaba a mitad de camino, los grupos
-- previos ya habían aplicado sus movimientos de stock de forma irreversible,
-- y un reintento del cliente los duplicaba. Esta función envuelve TODOS los
-- grupos de un carrito en una sola llamada RPC = una sola transacción: si
-- cualquier grupo falla, ninguno se aplica.
-- ============================================================================

create or replace function create_transfer_groups(
  p_org_id         uuid,
  p_own_branch_id  uuid,
  p_actor_id       uuid,
  p_type           text,
  p_groups         jsonb
) returns uuid[]
language plpgsql
security invoker
as $$
declare
  v_group       jsonb;
  v_transfer_id uuid;
  v_ids         uuid[] := '{}';
begin
  if p_type not in ('pedido', 'envio') then
    raise exception 'Tipo de traspaso inválido.';
  end if;
  if jsonb_array_length(p_groups) = 0 then
    raise exception 'El carrito debe tener al menos un grupo.';
  end if;

  for v_group in select * from jsonb_array_elements(p_groups) loop
    if p_type = 'pedido' then
      v_transfer_id := create_transfer_pedido(
        p_org_id, (v_group->>'branch_id')::uuid, p_own_branch_id, p_actor_id, v_group->'items'
      );
    else
      v_transfer_id := create_transfer_envio(
        p_org_id, p_own_branch_id, (v_group->>'branch_id')::uuid, p_actor_id, v_group->'items'
      );
    end if;
    v_ids := array_append(v_ids, v_transfer_id);
  end loop;

  return v_ids;
end;
$$;

grant execute on function create_transfer_groups(uuid, uuid, uuid, text, jsonb)
  to authenticated, service_role;
