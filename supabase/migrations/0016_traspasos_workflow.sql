-- ============================================================================
-- Traspasos: reemplaza el traspaso instantáneo por el flujo Pedido/Envío con
-- estados, réplica funcional del legacy (traspaso_controller.php). Ver
-- docs/superpowers/specs/2026-07-08-traspasos-workflow-design.md
-- ============================================================================

-- ── transfers ────────────────────────────────────────────────────────────
create table transfers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations (id) on delete cascade,
  type            text not null check (type in ('pedido', 'envio')),
  status          text not null check (status in ('en_cola', 'enviando', 'entregado', 'rechazado', 'cancelado')),
  from_branch_id  uuid not null,
  to_branch_id    uuid not null,
  created_by      uuid not null references profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint transfers_from_branch_id_fkey foreign key (from_branch_id) references branches (id),
  constraint transfers_to_branch_id_fkey foreign key (to_branch_id) references branches (id)
);
create index transfers_org_id_idx on transfers (org_id);
create index transfers_from_branch_id_idx on transfers (from_branch_id);
create index transfers_to_branch_id_idx on transfers (to_branch_id);

-- ── transfer_items ───────────────────────────────────────────────────────
create table transfer_items (
  id                  uuid primary key default gen_random_uuid(),
  transfer_id         uuid not null references transfers (id) on delete cascade,
  product_id          uuid not null references products (id),
  quantity_requested  integer not null check (quantity_requested > 0),
  quantity_sent       integer check (quantity_sent >= 0)
);
create index transfer_items_transfer_id_idx on transfer_items (transfer_id);

-- ── transfer_status_history ──────────────────────────────────────────────
-- Una fila por cada cambio de estado (incluida la creación). Solo para
-- auditoría — no se consulta desde la UI en esta versión.
create table transfer_status_history (
  id           uuid primary key default gen_random_uuid(),
  transfer_id  uuid not null references transfers (id) on delete cascade,
  status       text not null,
  actor_id     uuid not null references profiles (id),
  created_at   timestamptz not null default now()
);
create index transfer_status_history_transfer_id_idx on transfer_status_history (transfer_id);

-- ── RLS — mismo patrón que sale_returns (0011_devoluciones.sql) ─────────
alter table transfers               enable row level security;
alter table transfer_items          enable row level security;
alter table transfer_status_history enable row level security;

create policy transfers_select on transfers for select using (org_id = auth_org_id());
create policy transfers_insert on transfers for insert with check (org_id = auth_org_id());
create policy transfers_update on transfers for update using (org_id = auth_org_id());

create policy transfer_items_select on transfer_items for select using (
  exists (select 1 from transfers t where t.id = transfer_items.transfer_id and t.org_id = auth_org_id())
);
create policy transfer_items_insert on transfer_items for insert with check (
  exists (select 1 from transfers t where t.id = transfer_items.transfer_id and t.org_id = auth_org_id())
);
create policy transfer_items_update on transfer_items for update using (
  exists (select 1 from transfers t where t.id = transfer_items.transfer_id and t.org_id = auth_org_id())
);

create policy transfer_status_history_select on transfer_status_history for select using (
  exists (select 1 from transfers t where t.id = transfer_status_history.transfer_id and t.org_id = auth_org_id())
);
create policy transfer_status_history_insert on transfer_status_history for insert with check (
  exists (select 1 from transfers t where t.id = transfer_status_history.transfer_id and t.org_id = auth_org_id())
);

-- ============================================================================
-- RPCs
-- ============================================================================

-- Crea un Pedido: solicita `p_items` a `p_from_branch_id`, quedan a nombre
-- de `p_to_branch_id` (quien lo creó). Estado inicial 'en_cola', sin tocar
-- stock — el stock recién se mueve cuando el origen acepta (advance_transfer).
create or replace function create_transfer_pedido(
  p_org_id          uuid,
  p_from_branch_id  uuid,
  p_to_branch_id    uuid,
  p_actor_id        uuid,
  p_items           jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_transfer_id uuid;
  v_item        jsonb;
begin
  if p_from_branch_id = p_to_branch_id then
    raise exception 'La sucursal de origen y destino no pueden ser la misma.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe tener al menos un producto.';
  end if;

  insert into transfers (org_id, type, status, from_branch_id, to_branch_id, created_by)
  values (p_org_id, 'pedido', 'en_cola', p_from_branch_id, p_to_branch_id, p_actor_id)
  returning id into v_transfer_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'quantity')::integer <= 0 then
      raise exception 'La cantidad debe ser mayor a 0.';
    end if;
    insert into transfer_items (transfer_id, product_id, quantity_requested)
    values (v_transfer_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::integer);
  end loop;

  insert into transfer_status_history (transfer_id, status, actor_id)
  values (v_transfer_id, 'en_cola', p_actor_id);

  return v_transfer_id;
end;
$$;

grant execute on function create_transfer_pedido(uuid, uuid, uuid, uuid, jsonb)
  to authenticated, service_role;

-- Crea un Envío: manda `p_items` desde `p_from_branch_id` (quien lo creó) a
-- `p_to_branch_id`. Estado inicial 'enviando', descuenta stock del origen
-- de inmediato (igual que el legacy, que no espera aprobación para enviar).
create or replace function create_transfer_envio(
  p_org_id          uuid,
  p_from_branch_id  uuid,
  p_to_branch_id    uuid,
  p_actor_id        uuid,
  p_items           jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_transfer_id uuid;
  v_item        jsonb;
  v_product_id  uuid;
  v_quantity    integer;
  v_from_qty    integer;
  v_to_name     text;
begin
  if p_from_branch_id = p_to_branch_id then
    raise exception 'La sucursal de origen y destino no pueden ser la misma.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El envío debe tener al menos un producto.';
  end if;

  select name into v_to_name from branches where id = p_to_branch_id;

  insert into transfers (org_id, type, status, from_branch_id, to_branch_id, created_by)
  values (p_org_id, 'envio', 'enviando', p_from_branch_id, p_to_branch_id, p_actor_id)
  returning id into v_transfer_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity <= 0 then
      raise exception 'La cantidad debe ser mayor a 0.';
    end if;

    select quantity into v_from_qty from product_stock
     where product_id = v_product_id and branch_id = p_from_branch_id
     for update;
    if v_from_qty is null or v_from_qty < v_quantity then
      raise exception 'No hay stock suficiente para enviar % unidades.', v_quantity;
    end if;

    update product_stock
       set quantity = quantity - v_quantity, updated_at = now()
     where product_id = v_product_id and branch_id = p_from_branch_id;

    insert into transfer_items (transfer_id, product_id, quantity_requested, quantity_sent)
    values (v_transfer_id, v_product_id, v_quantity, v_quantity);

    insert into stock_movements
      (org_id, product_id, branch_id, movement_type, quantity_delta, resulting_quantity, reason, actor_id)
    values
      (p_org_id, v_product_id, p_from_branch_id, 'transferencia',
       -v_quantity, v_from_qty - v_quantity,
       'Traspaso (envío) a ' || coalesce(v_to_name, 'otra sucursal'), p_actor_id);
  end loop;

  insert into transfer_status_history (transfer_id, status, actor_id)
  values (v_transfer_id, 'enviando', p_actor_id);

  return v_transfer_id;
end;
$$;

grant execute on function create_transfer_envio(uuid, uuid, uuid, uuid, jsonb)
  to authenticated, service_role;

-- Avanza el estado de un traspaso existente. `p_actor_branch_id` decide el
-- rol de quien actúa (origin si coincide con from_branch_id, destination si
-- coincide con to_branch_id) y con eso valida si la transición pedida es
-- legal para ese type+status+rol — tabla idéntica a traspaso_model::estados
-- del legacy (ver lib/transferStatus.ts para el mirror en TypeScript usado
-- por la UI). Aplica los cambios de stock exactamente en el mismo momento
-- en que el legacy los aplica.
create or replace function advance_transfer(
  p_transfer_id      uuid,
  p_actor_id         uuid,
  p_actor_branch_id  uuid,
  p_next_status      text
) returns void
language plpgsql
security invoker
as $$
declare
  v_transfer   transfers%rowtype;
  v_role       text;
  v_item       record;
  v_from_qty   integer;
  v_to_qty     integer;
  v_from_name  text;
  v_to_name    text;
  v_applied    boolean := false;
begin
  select * into v_transfer from transfers where id = p_transfer_id for update;
  if v_transfer.id is null then
    raise exception 'Traspaso no encontrado.';
  end if;

  if p_actor_branch_id = v_transfer.to_branch_id then
    v_role := 'destination';
  elsif p_actor_branch_id = v_transfer.from_branch_id then
    v_role := 'origin';
  else
    raise exception 'No tienes permiso sobre este traspaso.';
  end if;

  select name into v_from_name from branches where id = v_transfer.from_branch_id;
  select name into v_to_name from branches where id = v_transfer.to_branch_id;

  if v_transfer.type = 'pedido' and v_role = 'destination' then
    if v_transfer.status = 'en_cola' and p_next_status = 'cancelado' then
      v_applied := true;
    elsif v_transfer.status = 'enviando' and p_next_status = 'entregado' then
      for v_item in select * from transfer_items where transfer_id = p_transfer_id loop
        insert into product_stock (org_id, product_id, branch_id, quantity)
        values (v_transfer.org_id, v_item.product_id, v_transfer.to_branch_id, v_item.quantity_sent)
        on conflict (product_id, branch_id)
        do update set quantity = product_stock.quantity + excluded.quantity, updated_at = now()
        returning quantity into v_to_qty;

        insert into stock_movements
          (org_id, product_id, branch_id, movement_type, quantity_delta, resulting_quantity, reason, actor_id)
        values
          (v_transfer.org_id, v_item.product_id, v_transfer.to_branch_id, 'transferencia',
           v_item.quantity_sent, v_to_qty,
           'Traspaso (pedido) recibido desde ' || coalesce(v_from_name, 'otra sucursal'), p_actor_id);
      end loop;
      v_applied := true;
    end if;

  elsif v_transfer.type = 'pedido' and v_role = 'origin' then
    if v_transfer.status = 'en_cola' and p_next_status = 'rechazado' then
      v_applied := true;
    elsif v_transfer.status = 'en_cola' and p_next_status = 'enviando' then
      for v_item in select * from transfer_items where transfer_id = p_transfer_id loop
        select quantity into v_from_qty from product_stock
         where product_id = v_item.product_id and branch_id = v_transfer.from_branch_id
         for update;
        if v_from_qty is null or v_from_qty < v_item.quantity_requested then
          raise exception 'No hay stock suficiente para enviar % unidades.', v_item.quantity_requested;
        end if;

        update product_stock
           set quantity = quantity - v_item.quantity_requested, updated_at = now()
         where product_id = v_item.product_id and branch_id = v_transfer.from_branch_id;

        update transfer_items
           set quantity_sent = quantity_requested
         where id = v_item.id;

        insert into stock_movements
          (org_id, product_id, branch_id, movement_type, quantity_delta, resulting_quantity, reason, actor_id)
        values
          (v_transfer.org_id, v_item.product_id, v_transfer.from_branch_id, 'transferencia',
           -v_item.quantity_requested, v_from_qty - v_item.quantity_requested,
           'Traspaso (pedido) enviado a ' || coalesce(v_to_name, 'otra sucursal'), p_actor_id);
      end loop;
      v_applied := true;
    end if;

  elsif v_transfer.type = 'envio' and v_role = 'destination' then
    if v_transfer.status = 'enviando' and p_next_status = 'entregado' then
      for v_item in select * from transfer_items where transfer_id = p_transfer_id loop
        insert into product_stock (org_id, product_id, branch_id, quantity)
        values (v_transfer.org_id, v_item.product_id, v_transfer.to_branch_id, v_item.quantity_sent)
        on conflict (product_id, branch_id)
        do update set quantity = product_stock.quantity + excluded.quantity, updated_at = now()
        returning quantity into v_to_qty;

        insert into stock_movements
          (org_id, product_id, branch_id, movement_type, quantity_delta, resulting_quantity, reason, actor_id)
        values
          (v_transfer.org_id, v_item.product_id, v_transfer.to_branch_id, 'transferencia',
           v_item.quantity_sent, v_to_qty,
           'Traspaso (envío) recibido desde ' || coalesce(v_from_name, 'otra sucursal'), p_actor_id);
      end loop;
      v_applied := true;
    end if;
  end if;

  if not v_applied then
    raise exception 'Transición de estado no permitida.';
  end if;

  update transfers set status = p_next_status, updated_at = now() where id = p_transfer_id;
  insert into transfer_status_history (transfer_id, status, actor_id) values (p_transfer_id, p_next_status, p_actor_id);
end;
$$;

grant execute on function advance_transfer(uuid, uuid, uuid, text)
  to authenticated, service_role;
