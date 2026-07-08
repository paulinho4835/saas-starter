# Traspasos: flujo Pedido/Envío con estados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el traspaso instantáneo actual por una réplica funcional
completa del flujo Pedido/Envío del legacy (3 pestañas, máquina de estados,
carrito multi-sucursal, historial de auditoría).

**Architecture:** 3 tablas nuevas (`transfers`, `transfer_items`,
`transfer_status_history`) + 3 RPCs Postgres (`create_transfer_pedido`,
`create_transfer_envio`, `advance_transfer`) que aplican los cambios de
stock atómicamente con bloqueo de fila. Lógica pura testeable en
`lib/transferStatus.ts` (tabla de transiciones/labels) y
`lib/transferCart.ts` (agrupación del carrito por sucursal). El carrito vive
en estado de React (client-side), no en sesión de servidor. UI en 3
componentes de pestaña sobre un único `page.tsx` con `?tab=`.

**Tech Stack:** Next.js App Router (Server Components + Server Actions),
Supabase/Postgres (RPCs plpgsql, RLS), Tailwind, Zod, Vitest.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-08-traspasos-workflow-design.md`.
- `NUNCA hacer push sin autorización explícita del usuario` — todo el trabajo
  queda local.
- Español neutro en toda la UI (sin voseo).
- `p_actor_branch_id`/`branchId` SIEMPRE se resuelve server-side desde
  `getProfile()`, nunca del cliente (mismo patrón que `createSale` y
  `transferBetweenBranches`).
- El traspaso instantáneo (`transferBetweenBranches`,
  `TransferBetweenBranchesButton.tsx`) se elimina por completo. El RPC
  `transfer_stock` NO se toca ni se borra — sigue en uso por `/almacen`
  (`app/(dashboard)/almacen/actions.ts`).
- Único permiso `traspasos:create` gatea crear Pedido/Envío y toda acción de
  cambio de estado (ya existe en `lib/rbac.ts`, no se modifica).
- Sin tests de integración contra Supabase — las migraciones/RPCs se
  verifican aplicando la migración local (`npm run db:reset`) y probando
  manualmente en el servidor de desarrollo. Los archivos `lib/*.ts` puros sí
  llevan tests reales (Vitest).
- Tabla de transiciones legales (replicada en SQL y en TypeScript, fuente:
  `traspaso_model::estados` del legacy):

  | type   | rol que actúa | estado actual | siguiente estado | efecto en stock |
  |--------|----------------|----------------|-------------------|------------------|
  | pedido | destination    | en_cola        | cancelado         | ninguno |
  | pedido | origin         | en_cola        | enviando          | resta `quantity_requested` de `from_branch_id`; fija `quantity_sent` |
  | pedido | origin         | en_cola        | rechazado         | ninguno |
  | pedido | destination    | enviando       | entregado         | suma `quantity_sent` a `to_branch_id` |
  | envio  | (creación)     | —              | enviando (inicial)| resta `quantity_requested` de `from_branch_id` al crear |
  | envio  | destination    | enviando       | entregado         | suma `quantity_sent` a `to_branch_id` |

---

### Task 1: Migración — tablas, RLS y RPCs

**Files:**
- Create: `supabase/migrations/0016_traspasos_workflow.sql`

**Interfaces:**
- Produces: tablas `transfers`, `transfer_items`, `transfer_status_history`;
  RPCs `create_transfer_pedido(p_org_id uuid, p_from_branch_id uuid,
  p_to_branch_id uuid, p_actor_id uuid, p_items jsonb) returns uuid`,
  `create_transfer_envio(...)` (misma firma), `advance_transfer(p_transfer_id
  uuid, p_actor_id uuid, p_actor_branch_id uuid, p_next_status text) returns
  void`. `p_items` es un array JSON `[{"product_id": "...", "quantity": N}]`.

- [ ] **Step 1: Escribir la migración completa**

```sql
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
```

- [ ] **Step 2: Aplicar la migración localmente**

Run: `npm run db:reset`
Expected: termina sin errores (aplica todas las migraciones + `supabase/seed.sql` desde cero).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0016_traspasos_workflow.sql
git commit -m "feat: tablas y RPCs para el flujo Pedido/Envío de Traspasos"
```

---

### Task 2: `lib/transferStatus.ts` — máquina de estados pura

**Files:**
- Create: `lib/transferStatus.ts`
- Test: `lib/transferStatus.test.ts`

**Interfaces:**
- Consumes: nada (función pura).
- Produces: `TransferType`, `TransferStatus`, `TransferRole`, `TransferAction`,
  `TransferView`, `getTransferView(type, status, role): TransferView`,
  `isTerminalStatus(status): boolean`. Usados por
  `components/traspasos/TransferStatusCard.tsx` (Task 8) y
  `app/(dashboard)/traspasos/page.tsx` (Task 9).

- [ ] **Step 1: Escribir el test**

```ts
// lib/transferStatus.test.ts
import { describe, expect, it } from "vitest";
import { getTransferView, isTerminalStatus } from "./transferStatus";

describe("getTransferView", () => {
  it("pedido, destination, en_cola -> Cancelar", () => {
    expect(getTransferView("pedido", "en_cola", "destination")).toEqual({
      label: "En Cola",
      actions: [{ nextStatus: "cancelado", label: "Cancelar" }],
    });
  });

  it("pedido, destination, enviando -> Recepcionar", () => {
    expect(getTransferView("pedido", "enviando", "destination")).toEqual({
      label: "En Camino",
      actions: [{ nextStatus: "entregado", label: "Recepcionar" }],
    });
  });

  it("pedido, origin, en_cola -> Enviar o Rechazar", () => {
    expect(getTransferView("pedido", "en_cola", "origin")).toEqual({
      label: "En Cola",
      actions: [
        { nextStatus: "enviando", label: "Enviar" },
        { nextStatus: "rechazado", label: "Rechazar" },
      ],
    });
  });

  it("pedido, origin, enviando -> sin acciones (esperando al solicitante)", () => {
    expect(getTransferView("pedido", "enviando", "origin")).toEqual({
      label: "Enviando",
      actions: [],
    });
  });

  it("envio, origin, enviando -> sin acciones (esperando al receptor)", () => {
    expect(getTransferView("envio", "enviando", "origin")).toEqual({
      label: "Enviando",
      actions: [],
    });
  });

  it("envio, destination, enviando -> Recepcionar", () => {
    expect(getTransferView("envio", "enviando", "destination")).toEqual({
      label: "En Camino",
      actions: [{ nextStatus: "entregado", label: "Recepcionar" }],
    });
  });

  it("devuelve el estado crudo sin acciones para una combinación sin vista definida", () => {
    expect(getTransferView("pedido", "cancelado", "destination")).toEqual({
      label: "cancelado",
      actions: [],
    });
  });
});

describe("isTerminalStatus", () => {
  it("entregado, rechazado y cancelado son terminales", () => {
    expect(isTerminalStatus("entregado")).toBe(true);
    expect(isTerminalStatus("rechazado")).toBe(true);
    expect(isTerminalStatus("cancelado")).toBe(true);
  });

  it("en_cola y enviando no son terminales", () => {
    expect(isTerminalStatus("en_cola")).toBe(false);
    expect(isTerminalStatus("enviando")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/transferStatus.test.ts`
Expected: FAIL — `Cannot find module './transferStatus'`.

- [ ] **Step 3: Implementar `lib/transferStatus.ts`**

```ts
// lib/transferStatus.ts
// Máquina de estados de Traspasos — mirror en TypeScript de
// traspaso_model::estados del legacy. Usado tanto por la UI (label +
// acciones disponibles según type/status/role) como para validar antes de
// llamar al RPC `advance_transfer`, que vuelve a validar en SQL. Ver
// docs/superpowers/specs/2026-07-08-traspasos-workflow-design.md

export type TransferType = "pedido" | "envio";
export type TransferStatus = "en_cola" | "enviando" | "entregado" | "rechazado" | "cancelado";
// origin = quien decide enviar/rechazar (from_branch_id).
// destination = quien creó el traspaso y lo recibirá (to_branch_id).
export type TransferRole = "origin" | "destination";

export type TransferAction = { nextStatus: TransferStatus; label: string };
export type TransferView = { label: string; actions: TransferAction[] };

type ViewsByStatus = Partial<Record<TransferStatus, TransferView>>;
type ViewsByRole = Partial<Record<TransferRole, ViewsByStatus>>;

const VIEWS: Record<TransferType, ViewsByRole> = {
  pedido: {
    destination: {
      en_cola: { label: "En Cola", actions: [{ nextStatus: "cancelado", label: "Cancelar" }] },
      enviando: { label: "En Camino", actions: [{ nextStatus: "entregado", label: "Recepcionar" }] },
    },
    origin: {
      en_cola: {
        label: "En Cola",
        actions: [
          { nextStatus: "enviando", label: "Enviar" },
          { nextStatus: "rechazado", label: "Rechazar" },
        ],
      },
      enviando: { label: "Enviando", actions: [] },
    },
  },
  envio: {
    origin: {
      enviando: { label: "Enviando", actions: [] },
    },
    destination: {
      enviando: { label: "En Camino", actions: [{ nextStatus: "entregado", label: "Recepcionar" }] },
    },
  },
};

export function getTransferView(
  type: TransferType,
  status: TransferStatus,
  role: TransferRole,
): TransferView {
  return VIEWS[type]?.[role]?.[status] ?? { label: status, actions: [] };
}

export function isTerminalStatus(status: TransferStatus): boolean {
  return status === "entregado" || status === "rechazado" || status === "cancelado";
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/transferStatus.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/transferStatus.ts lib/transferStatus.test.ts
git commit -m "feat: máquina de estados pura de Traspasos (lib/transferStatus.ts)"
```

---

### Task 3: `lib/transferCart.ts` — carrito puro

**Files:**
- Create: `lib/transferCart.ts`
- Test: `lib/transferCart.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `TransferCartLine = { productId, code, branchId, branchName,
  quantity }`, `TransferCartGroup = { branchId, branchName, lines:
  TransferCartLine[] }`, `groupCartByBranch(cart): TransferCartGroup[]`,
  `PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR: string`,
  `isProductInTransferCart(cart, productId): boolean`,
  `isPositiveInteger(value): boolean`. Usados por
  `components/traspasos/TransferQuantityModal.tsx`,
  `components/traspasos/TransferCartPanel.tsx` y
  `components/traspasos/SolicitudEnvioTab.tsx` (Tasks 5–7).

- [ ] **Step 1: Escribir el test**

```ts
// lib/transferCart.test.ts
import { describe, expect, it } from "vitest";
import {
  groupCartByBranch,
  isProductInTransferCart,
  isPositiveInteger,
  PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR,
  type TransferCartLine,
} from "./transferCart";

function line(productId: string, branchId: string, branchName: string, quantity = 1): TransferCartLine {
  return { productId, code: `COD-${productId}`, branchId, branchName, quantity };
}

describe("groupCartByBranch", () => {
  it("returns an empty array for an empty cart", () => {
    expect(groupCartByBranch([])).toEqual([]);
  });

  it("groups lines by branchId preserving first-appearance order", () => {
    const cart = [
      line("p1", "b2", "Norte"),
      line("p2", "b1", "Central"),
      line("p3", "b2", "Norte"),
    ];
    const groups = groupCartByBranch(cart);
    expect(groups.map((g) => g.branchId)).toEqual(["b2", "b1"]);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[1].lines).toHaveLength(1);
  });

  it("keeps branchName from the group's first line", () => {
    const cart = [line("p1", "b1", "Central")];
    expect(groupCartByBranch(cart)[0].branchName).toBe("Central");
  });
});

describe("isProductInTransferCart", () => {
  it("returns true when the product is already in the cart, regardless of branch", () => {
    const cart = [line("p1", "b1", "Central")];
    expect(isProductInTransferCart(cart, "p1")).toBe(true);
  });

  it("returns false when the product is not in the cart", () => {
    const cart = [line("p1", "b1", "Central")];
    expect(isProductInTransferCart(cart, "p2")).toBe(false);
  });
});

describe("isPositiveInteger", () => {
  it("accepts positive integers", () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(42)).toBe(true);
  });

  it("rejects zero, negatives and non-integers", () => {
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(-1)).toBe(false);
    expect(isPositiveInteger(1.5)).toBe(false);
  });
});

describe("PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR", () => {
  it("is a non-empty user-facing message", () => {
    expect(PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/transferCart.test.ts`
Expected: FAIL — `Cannot find module './transferCart'`.

- [ ] **Step 3: Implementar `lib/transferCart.ts`**

```ts
// lib/transferCart.ts
// Reglas puras del carrito de Traspasos (Pedido/Envío) — sin acceso a DB ni
// a React, mismo espíritu que lib/ventasCart.ts. Ver
// docs/superpowers/specs/2026-07-08-traspasos-workflow-design.md

export type TransferCartLine = {
  productId: string;
  code: string;
  branchId: string;
  branchName: string;
  quantity: number;
};

export type TransferCartGroup = {
  branchId: string;
  branchName: string;
  lines: TransferCartLine[];
};

// El legacy permite en un mismo carrito de Pedido (o de Envío) productos
// dirigidos a varias sucursales distintas; al confirmar crea un traspaso por
// cada sucursal involucrada. Agrupa preservando el orden de primera
// aparición de cada sucursal.
export function groupCartByBranch(cart: TransferCartLine[]): TransferCartGroup[] {
  const order: string[] = [];
  const byBranch = new Map<string, TransferCartGroup>();
  for (const line of cart) {
    let group = byBranch.get(line.branchId);
    if (!group) {
      group = { branchId: line.branchId, branchName: line.branchName, lines: [] };
      byBranch.set(line.branchId, group);
      order.push(line.branchId);
    }
    group.lines.push(line);
  }
  return order.map((id) => byBranch.get(id)!);
}

export const PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR =
  "El producto ya está agregado en este carrito.";

// El legacy (mostrar_modal_cantidad) solo prohíbe agregar el MISMO producto
// dos veces al carrito de Pedido/Envío, sin importar a qué sucursal —
// pedidoCart y envioCart son carritos separados, así que un producto puede
// estar en ambos a la vez.
export function isProductInTransferCart(cart: TransferCartLine[], productId: string): boolean {
  return cart.some((line) => line.productId === productId);
}

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/transferCart.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/transferCart.ts lib/transferCart.test.ts
git commit -m "feat: carrito puro de Traspasos agrupado por sucursal (lib/transferCart.ts)"
```

---

### Task 4: `app/(dashboard)/traspasos/actions.ts` — server actions

**Files:**
- Modify (reescribir completo): `app/(dashboard)/traspasos/actions.ts`
- Delete: `components/traspasos/TransferBetweenBranchesButton.tsx`

**Interfaces:**
- Consumes: `getProfile()` (`lib/auth.ts`), `can()` (`lib/rbac.ts`),
  `verifyBranchInOrg()` (`lib/catalogs.ts`), RPCs de Task 1.
- Produces: `createTransferRequest(formData): Promise<CreateTransferResult>`,
  `createTransferShipment(formData): Promise<CreateTransferResult>`,
  `advanceTransferStatus(formData): Promise<AdvanceTransferResult>`,
  `validateTransferQuantity(formData): Promise<ValidateTransferQuantityResult>`,
  `getTransferProductStock(productId): Promise<ProductBranchStockResult>`.
  Todas usadas por componentes de Tasks 5–9.

`createTransferRequest`/`createTransferShipment` reciben un campo `groups`
en el `FormData`, un JSON `{ branchId: string; items: { productId: string;
quantity: number }[] }[]` (uno por sucursal del carrito, ya agrupado por
`groupCartByBranch` en el cliente).

- [ ] **Step 1: Borrar el botón de traspaso instantáneo**

Run: `rm "components/traspasos/TransferBetweenBranchesButton.tsx"`

(En PowerShell: `Remove-Item "components\traspasos\TransferBetweenBranchesButton.tsx"`.)

- [ ] **Step 2: Reescribir `app/(dashboard)/traspasos/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { verifyBranchInOrg } from "@/lib/catalogs";

const transferItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
});

const transferGroupSchema = z.object({
  branchId: z.string().uuid(),
  items: z.array(transferItemSchema).min(1),
});

const createTransferSchema = z.object({
  groups: z.array(transferGroupSchema).min(1, "Agrega al menos un producto."),
});

export type CreateTransferResult = { ok: true } | { ok: false; error: string };

async function createTransferGroups(
  formData: FormData,
  rpcName: "create_transfer_pedido" | "create_transfer_envio",
  branchRole: "from" | "to",
): Promise<CreateTransferResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "traspasos:create")) {
    return { ok: false, error: "No tienes permiso para hacer traspasos." };
  }
  if (!profile.branchId) {
    return { ok: false, error: "No tienes una sucursal asignada." };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("groups") ?? "[]"));
  } catch {
    return { ok: false, error: "Carrito inválido." };
  }
  const parsed = createTransferSchema.safeParse({ groups: raw });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  for (const group of parsed.data.groups) {
    if (group.branchId === profile.branchId) {
      return { ok: false, error: "La sucursal de origen y destino no pueden ser la misma." };
    }
    const validBranch = await verifyBranchInOrg(supabase, group.branchId, profile.orgId);
    if (!validBranch) {
      return { ok: false, error: "Alguna de las sucursales seleccionadas no es válida." };
    }
    const items = group.items.map((i) => ({ product_id: i.productId, quantity: i.quantity }));
    const { error } = await supabase.rpc(rpcName, {
      p_org_id: profile.orgId,
      p_from_branch_id: branchRole === "from" ? group.branchId : profile.branchId,
      p_to_branch_id: branchRole === "from" ? profile.branchId : group.branchId,
      p_actor_id: profile.userId,
      p_items: items,
    });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/traspasos");
  return { ok: true };
}

// Crea un Pedido por cada sucursal del carrito: solicita stock a esa
// sucursal (from_branch_id = la sucursal elegida), quedará a nombre de la
// propia (to_branch_id).
export async function createTransferRequest(formData: FormData): Promise<CreateTransferResult> {
  return createTransferGroups(formData, "create_transfer_pedido", "from");
}

// Crea un Envío por cada sucursal del carrito: manda stock propio
// (from_branch_id = la propia) a la sucursal elegida (to_branch_id).
export async function createTransferShipment(formData: FormData): Promise<CreateTransferResult> {
  return createTransferGroups(formData, "create_transfer_envio", "to");
}

const advanceSchema = z.object({
  transferId: z.string().uuid(),
  nextStatus: z.enum(["en_cola", "enviando", "entregado", "rechazado", "cancelado"]),
});

export type AdvanceTransferResult = { ok: true } | { ok: false; error: string };

export async function advanceTransferStatus(formData: FormData): Promise<AdvanceTransferResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "traspasos:create")) {
    return { ok: false, error: "No tienes permiso para hacer traspasos." };
  }
  if (!profile.branchId) {
    return { ok: false, error: "No tienes una sucursal asignada." };
  }
  const parsed = advanceSchema.safeParse({
    transferId: formData.get("transferId"),
    nextStatus: formData.get("nextStatus"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_transfer", {
    p_transfer_id: parsed.data.transferId,
    p_actor_id: profile.userId,
    p_actor_branch_id: profile.branchId,
    p_next_status: parsed.data.nextStatus,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/traspasos");
  return { ok: true };
}

const validateQuantitySchema = z.object({
  productId: z.string().uuid(),
  branchId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
});

export type ValidateTransferQuantityResult = { ok: true } | { ok: false; error: string };

// Valida que la cantidad pedida/enviada no exceda el stock ACTUAL de la
// sucursal relevante (para Pedido: la sucursal elegida como origen; para
// Envío: siempre la propia) antes de agregarla al carrito — igual que
// agregar_producto_carrito() del legacy, que revisa Existencia antes de
// aceptar la línea en el carrito de sesión.
export async function validateTransferQuantity(
  formData: FormData,
): Promise<ValidateTransferQuantityResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  const parsed = validateQuantitySchema.safeParse({
    productId: formData.get("productId"),
    branchId: formData.get("branchId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("product_stock")
    .select("quantity")
    .eq("product_id", parsed.data.productId)
    .eq("branch_id", parsed.data.branchId)
    .maybeSingle();
  const available = data?.quantity ?? 0;
  if (parsed.data.quantity > available) {
    return { ok: false, error: `La cantidad debe estar entre 0 y ${available}.` };
  }
  return { ok: true };
}

// Stock del producto en TODAS las sucursales salvo la propia — panel "Datos
// adicionales" de la pestaña Solicitud/Envío (igual que
// Producto::cantidades_sucursales() del legacy).
export type ProductBranchStockResult =
  | { ok: true; rows: { branchName: string; quantity: number }[] }
  | { ok: false; error: string };

export async function getTransferProductStock(productId: string): Promise<ProductBranchStockResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!profile.branchId) return { ok: true, rows: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_stock")
    .select("quantity, branches(name)")
    .eq("product_id", productId)
    .neq("branch_id", profile.branchId);

  if (error) {
    console.error("getTransferProductStock:", error.message);
    return { ok: false, error: "No se pudo cargar el stock por sucursal." };
  }

  const rows = ((data ?? []) as unknown as { quantity: number; branches: { name: string } | null }[]).map(
    (r) => ({ branchName: r.branches?.name ?? "—", quantity: r.quantity }),
  );
  return { ok: true, rows };
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: errores SOLO en `app/(dashboard)/traspasos/page.tsx` y
`app/(dashboard)/traspasos/TraspasosFilters.tsx` (todavía no actualizados —
se resuelven en Tasks 7 y 9). Ningún error debe apuntar a
`actions.ts`. Si aparece un error en `actions.ts`, corregirlo antes de
continuar.

- [ ] **Step 4: Commit**

```bash
git add app/"(dashboard)"/traspasos/actions.ts
git rm components/traspasos/TransferBetweenBranchesButton.tsx
git commit -m "feat: server actions del flujo Pedido/Envío de Traspasos"
```

---

### Task 5: Modal de cantidad/sucursal + panel de info de producto

**Files:**
- Create: `components/traspasos/TransferQuantityModal.tsx`
- Create: `components/traspasos/ProductInfoPanel.tsx`

**Interfaces:**
- Consumes: `Modal`, `Button`, `FieldLabel`, `fieldInputClass` (`components/ui/*`),
  `isPositiveInteger` (`lib/transferCart.ts`, Task 3),
  `validateTransferQuantity`, `getTransferProductStock` (`actions.ts`, Task 4).
- Produces: `TransferProceso = "pedido" | "envio"`, `TransferModalProduct =
  { id: string; code: string }`, `TransferModalLine = { productId, code,
  branchId, branchName, quantity }`, componente
  `TransferQuantityModal({ product, proceso, branches, ownBranchId, onClose,
  onAdd })`; `TransferInfoProduct = { id: string; code: string; application:
  string | null }`, componente `ProductInfoPanel({ product })`. Ambos
  consumidos por `SolicitudEnvioTab.tsx` (Task 7).

- [ ] **Step 1: Implementar `components/traspasos/TransferQuantityModal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { isPositiveInteger } from "@/lib/transferCart";
import { validateTransferQuantity } from "@/app/(dashboard)/traspasos/actions";

export type TransferProceso = "pedido" | "envio";
export type TransferModalProduct = { id: string; code: string };
export type TransferModalLine = {
  productId: string;
  code: string;
  branchId: string;
  branchName: string;
  quantity: number;
};

export function TransferQuantityModal({
  product,
  proceso,
  branches,
  ownBranchId,
  onClose,
  onAdd,
}: {
  product: TransferModalProduct | null;
  proceso: TransferProceso | null;
  branches: { id: string; name: string }[];
  ownBranchId: string;
  onClose: () => void;
  onAdd: (line: TransferModalLine) => void;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Cada vez que se abre el modal con un producto/proceso distinto, limpia
  // los campos y el error de la vez anterior.
  useEffect(() => {
    setBranchId(branches[0]?.id ?? "");
    setQuantity("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, proceso]);

  if (!product || !proceso) return null;

  const qtyNumber = Number(quantity);
  const qtyValid = isPositiveInteger(qtyNumber);

  async function handleAdd() {
    if (!product || !proceso || !qtyValid || !branchId) return;
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.set("productId", product.id);
    // Envío valida contra el stock PROPIO (siempre se manda desde la propia
    // sucursal); Pedido valida contra el stock de la sucursal elegida (a
    // quien se le pide) — igual que agregar_producto_carrito() del legacy.
    formData.set("branchId", proceso === "envio" ? ownBranchId : branchId);
    formData.set("quantity", quantity);
    const res = await validateTransferQuantity(formData);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const branch = branches.find((b) => b.id === branchId);
    onAdd({
      productId: product.id,
      code: product.code,
      branchId,
      branchName: branch?.name ?? "—",
      quantity: qtyNumber,
    });
    onClose();
  }

  const title = proceso === "pedido" ? "Pedido de Productos" : "Envío de Productos";
  const branchLabel = proceso === "pedido" ? "Seleccione Sucursal (origen)" : "Seleccione Sucursal (destino)";
  const procesoLabel = proceso === "pedido" ? "Pedido" : "Envío";

  return (
    <Modal open={Boolean(product) && Boolean(proceso)} onClose={onClose} title={title}>
      <div className="space-y-3">
        <label className="block text-sm">
          <FieldLabel>{branchLabel}</FieldLabel>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={fieldInputClass}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <FieldLabel>Código de Producto</FieldLabel>
          <input type="text" disabled value={product.code} className={fieldInputClass} />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <label className="block text-sm">
          <FieldLabel>Seleccione Cantidad de {procesoLabel}</FieldLabel>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={fieldInputClass}
            autoComplete="off"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="button" disabled={!qtyValid || !branchId || loading} onClick={handleAdd}>
            {loading ? "Verificando…" : `Agregar al carrito de ${procesoLabel}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Implementar `components/traspasos/ProductInfoPanel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { getTransferProductStock } from "@/app/(dashboard)/traspasos/actions";

export type TransferInfoProduct = { id: string; code: string; application: string | null };

// "Datos adicionales" del legacy: aplicación del producto + stock en las
// demás sucursales, para el producto seleccionado en la tabla.
export function ProductInfoPanel({ product }: { product: TransferInfoProduct | null }) {
  const [rows, setRows] = useState<{ branchName: string; quantity: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    getTransferProductStock(product.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setRows([]);
        return;
      }
      setError(null);
      setRows(res.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [product]);

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Sucursal / Stock
        </h3>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && rows.length === 0 && (
          <p className="text-sm text-slate-400">Selecciona un producto para ver su stock.</p>
        )}
        {!error && rows.length > 0 && (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.branchName} className="border-b border-slate-100">
                  <td className="py-1 text-slate-700">{r.branchName}</td>
                  <td className="py-1 text-right font-medium text-slate-800">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <label className="block text-sm">
        <FieldLabel>Aplicación producto</FieldLabel>
        <textarea
          disabled
          rows={5}
          value={product?.application ?? ""}
          placeholder={product ? "Este producto no tiene aplicación registrada." : "Selecciona un producto."}
          className={fieldInputClass}
        />
      </label>
    </Card>
  );
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en estos dos archivos (los de `page.tsx`/
`TraspasosFilters.tsx` de Task 4 siguen presentes, es esperado).

- [ ] **Step 4: Commit**

```bash
git add components/traspasos/TransferQuantityModal.tsx components/traspasos/ProductInfoPanel.tsx
git commit -m "feat: modal de cantidad/sucursal y panel de info de producto (Traspasos)"
```

---

### Task 6: Tabla de productos y panel de carrito

**Files:**
- Create: `components/traspasos/TransferProductsTable.tsx`
- Create: `components/traspasos/TransferCartPanel.tsx`

**Interfaces:**
- Consumes: `Card`, `Button` (`components/ui/*`), `pageWindow`
  (`lib/ventasCart.ts`), `groupCartByBranch` (`lib/transferCart.ts`, Task 3),
  `TransferProceso` (`TransferQuantityModal.tsx`, Task 5).
- Produces: `TransferProduct = { id, code, application, stock }`, componente
  `TransferProductsTable({ products, selectedProductId, onSelectProduct,
  onOpenModal, page, totalPages, baseQuery, canManage })`; componente
  `TransferCartPanel({ pedidoCart, envioCart, onRemovePedido, onRemoveEnvio,
  onSubmitPedido, onSubmitEnvio, loadingPedido, loadingEnvio })`. Ambos
  consumidos por `SolicitudEnvioTab.tsx` (Task 7).

- [ ] **Step 1: Implementar `components/traspasos/TransferProductsTable.tsx`**

```tsx
"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { pageWindow } from "@/lib/ventasCart";
import type { TransferProceso } from "@/components/traspasos/TransferQuantityModal";

export type TransferProduct = {
  id: string;
  code: string;
  application: string | null;
  stock: number;
};

// td.row-selected del legacy (azul claro) — mismo valor que ProductsTable.tsx de Ventas.
const SELECTED_ROW_CLASS = "bg-[#ced4ff]";

export function TransferProductsTable({
  products,
  selectedProductId,
  onSelectProduct,
  onOpenModal,
  page,
  totalPages,
  baseQuery,
  canManage,
}: {
  products: TransferProduct[];
  selectedProductId: string | null;
  onSelectProduct: (product: TransferProduct) => void;
  onOpenModal: (product: TransferProduct, proceso: TransferProceso) => void;
  page: number;
  totalPages: number;
  baseQuery: string;
  canManage: boolean;
}) {
  const pageItems = pageWindow(page, totalPages);

  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams(baseQuery);
    params.set("tab", "sol_env");
    params.set("page", String(targetPage));
    return `/traspasos?${params.toString()}`;
  }

  const arrowClass =
    "flex h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";
  const arrowDisabledClass =
    "flex h-9 min-w-9 cursor-not-allowed items-center justify-center rounded-lg border border-slate-100 px-3 text-slate-300";

  return (
    <Card className="overflow-hidden">
      <div className="max-h-[calc(100vh-11rem)] overflow-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Cantidad</th>
              {canManage && <th className="px-3 py-2"></th>}
              {canManage && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const selected = p.id === selectedProductId;
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelectProduct(p)}
                  className={`cursor-pointer ${selected ? SELECTED_ROW_CLASS : "hover:bg-slate-50"}`}
                >
                  <td className="px-3 py-2 font-medium text-slate-800">{p.code}</td>
                  <td className="px-3 py-2 text-slate-600">{p.stock}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenModal(p, "pedido");
                        }}
                      >
                        Pedido
                      </Button>
                    </td>
                  )}
                  {canManage && (
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenModal(p, "envio");
                        }}
                      >
                        Envío
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav
          aria-label="Paginación"
          className="flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-100 p-3 text-sm"
        >
          {page > 1 ? (
            <a href={buildPageHref(page - 1)} className={arrowClass} aria-label="Página anterior">
              ‹
            </a>
          ) : (
            <span className={arrowDisabledClass} aria-hidden="true">
              ‹
            </span>
          )}
          {pageItems.map((item, i) =>
            item === "…" ? (
              <span key={`gap-${i}`} className="flex h-9 w-9 items-center justify-center text-slate-400" aria-hidden="true">
                …
              </span>
            ) : item === page ? (
              <span
                key={item}
                aria-current="page"
                className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-brand-600 px-3 font-semibold text-white"
              >
                {item}
              </span>
            ) : (
              <a
                key={item}
                href={buildPageHref(item)}
                className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                {item}
              </a>
            ),
          )}
          {page < totalPages ? (
            <a href={buildPageHref(page + 1)} className={arrowClass} aria-label="Página siguiente">
              ›
            </a>
          ) : (
            <span className={arrowDisabledClass} aria-hidden="true">
              ›
            </span>
          )}
        </nav>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Implementar `components/traspasos/TransferCartPanel.tsx`**

```tsx
"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { TransferCartLine } from "@/lib/transferCart";

function CartTable({
  title,
  cart,
  quantityLabel,
  onRemove,
  onSubmit,
  loading,
  submitLabel,
}: {
  title: string;
  cart: TransferCartLine[];
  quantityLabel: string;
  onRemove: (productId: string, branchId: string) => void;
  onSubmit: () => void;
  loading: boolean;
  submitLabel: string;
}) {
  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-lg text-slate-800">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2">Código</th>
            <th className="px-3 py-2">{quantityLabel}</th>
            <th className="px-3 py-2">Sucursal</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {cart.map((line) => (
            <tr key={`${line.productId}-${line.branchId}`} className="border-b border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-800">{line.code}</td>
              <td className="px-3 py-2 text-slate-600">{line.quantity}</td>
              <td className="px-3 py-2 text-slate-600">{line.branchName}</td>
              <td className="px-3 py-2 text-right">
                {/* .btn-danger del legacy: rojo Bootstrap sólido. */}
                <button
                  type="button"
                  onClick={() => onRemove(line.productId, line.branchId)}
                  className="rounded bg-[#d9534f] px-2 py-1 text-xs font-medium text-white hover:bg-[#c9302c]"
                >
                  Borrar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cart.length > 0 && (
        <Button disabled={loading} onClick={onSubmit}>
          {loading ? "Enviando…" : submitLabel}
        </Button>
      )}
    </Card>
  );
}

export function TransferCartPanel({
  pedidoCart,
  envioCart,
  onRemovePedido,
  onRemoveEnvio,
  onSubmitPedido,
  onSubmitEnvio,
  loadingPedido,
  loadingEnvio,
}: {
  pedidoCart: TransferCartLine[];
  envioCart: TransferCartLine[];
  onRemovePedido: (productId: string, branchId: string) => void;
  onRemoveEnvio: (productId: string, branchId: string) => void;
  onSubmitPedido: () => void;
  onSubmitEnvio: () => void;
  loadingPedido: boolean;
  loadingEnvio: boolean;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <CartTable
        title="Productos para Pedir"
        cart={pedidoCart}
        quantityLabel="Cantidad a Pedir"
        onRemove={onRemovePedido}
        onSubmit={onSubmitPedido}
        loading={loadingPedido}
        submitLabel="Pedir Productos"
      />
      <CartTable
        title="Productos para Enviar"
        cart={envioCart}
        quantityLabel="Cantidad a Enviar"
        onRemove={onRemoveEnvio}
        onSubmit={onSubmitEnvio}
        loading={loadingEnvio}
        submitLabel="Enviar Productos"
      />
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en estos dos archivos.

- [ ] **Step 4: Commit**

```bash
git add components/traspasos/TransferProductsTable.tsx components/traspasos/TransferCartPanel.tsx
git commit -m "feat: tabla de productos y panel de carrito de Traspasos"
```

---

### Task 7: Orquestador de la pestaña Solicitud/Envío + filtro

**Files:**
- Create: `components/traspasos/SolicitudEnvioTab.tsx`
- Modify (reescribir completo): `app/(dashboard)/traspasos/TraspasosFilters.tsx`

**Interfaces:**
- Consumes: todo lo de Tasks 3, 4, 5, 6.
- Produces: componente `SolicitudEnvioTab({ products, page, totalPages,
  baseQuery, branches, ownBranchId, filters, canManage })`; componente
  `TraspasosFilters({ initialCode })`. Ambos consumidos por `page.tsx`
  (Task 9).

- [ ] **Step 1: Reescribir `app/(dashboard)/traspasos/TraspasosFilters.tsx`**

El legacy (Solicitud/Envío) solo filtra por "Codigo de producto" — sin
aplicación, marca ni sucursal (la sucursal ya está fija: la propia).

```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { fieldInputClass } from "@/components/ui/Field";

const DEBOUNCE_MS = 300;

export function TraspasosFilters({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [isPending, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function update(value: string) {
    setCode(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      params.set("tab", "sol_env");
      if (value) params.set("code", value);
      startTransition(() => {
        router.replace(`/traspasos?${params.toString()}`, { scroll: false });
      });
    }, DEBOUNCE_MS);
  }

  return (
    <Card className="p-4">
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Código de producto</span>
        <input
          type="text"
          value={code}
          onChange={(e) => update(e.target.value)}
          className={fieldInputClass}
          autoFocus
          autoComplete="off"
        />
      </label>
      <span className="mt-1 block text-xs text-slate-400" aria-live="polite">
        {isPending ? "Buscando…" : ""}
      </span>
    </Card>
  );
}
```

- [ ] **Step 2: Implementar `components/traspasos/SolicitudEnvioTab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import {
  groupCartByBranch,
  isProductInTransferCart,
  PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR,
  type TransferCartLine,
} from "@/lib/transferCart";
import { createTransferRequest, createTransferShipment } from "@/app/(dashboard)/traspasos/actions";
import { TransferProductsTable, type TransferProduct } from "@/components/traspasos/TransferProductsTable";
import { ProductInfoPanel } from "@/components/traspasos/ProductInfoPanel";
import {
  TransferQuantityModal,
  type TransferModalLine,
  type TransferProceso,
} from "@/components/traspasos/TransferQuantityModal";
import { TransferCartPanel } from "@/components/traspasos/TransferCartPanel";

export function SolicitudEnvioTab({
  products,
  page,
  totalPages,
  baseQuery,
  branches,
  ownBranchId,
  filters,
  canManage,
}: {
  products: TransferProduct[];
  page: number;
  totalPages: number;
  baseQuery: string;
  branches: { id: string; name: string }[];
  ownBranchId: string;
  filters: React.ReactNode;
  canManage: boolean;
}) {
  const [selectedProduct, setSelectedProduct] = useState<TransferProduct | null>(null);
  const [modalProduct, setModalProduct] = useState<TransferProduct | null>(null);
  const [modalProceso, setModalProceso] = useState<TransferProceso | null>(null);
  const [pedidoCart, setPedidoCart] = useState<TransferCartLine[]>([]);
  const [envioCart, setEnvioCart] = useState<TransferCartLine[]>([]);
  const [loadingPedido, setLoadingPedido] = useState(false);
  const [loadingEnvio, setLoadingEnvio] = useState(false);
  const router = useRouter();

  function openModal(product: TransferProduct, proceso: TransferProceso) {
    const cart = proceso === "pedido" ? pedidoCart : envioCart;
    if (isProductInTransferCart(cart, product.id)) {
      toast(PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR, "error");
      return;
    }
    setModalProduct(product);
    setModalProceso(proceso);
  }

  function handleAdd(line: TransferModalLine) {
    if (modalProceso === "pedido") {
      setPedidoCart((prev) => [...prev, line]);
    } else {
      setEnvioCart((prev) => [...prev, line]);
    }
    toast(`Añadido al carrito de ${modalProceso === "pedido" ? "Pedido" : "Envío"}`);
  }

  function removeLine(proceso: TransferProceso, productId: string, branchId: string) {
    const setCart = proceso === "pedido" ? setPedidoCart : setEnvioCart;
    setCart((prev) => prev.filter((l) => !(l.productId === productId && l.branchId === branchId)));
  }

  async function submitCart(proceso: TransferProceso) {
    const cart = proceso === "pedido" ? pedidoCart : envioCart;
    const setLoading = proceso === "pedido" ? setLoadingPedido : setLoadingEnvio;
    const setCart = proceso === "pedido" ? setPedidoCart : setEnvioCart;
    if (cart.length === 0) return;

    setLoading(true);
    const groups = groupCartByBranch(cart).map((g) => ({
      branchId: g.branchId,
      items: g.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    }));
    const formData = new FormData();
    formData.set("groups", JSON.stringify(groups));
    const action = proceso === "pedido" ? createTransferRequest : createTransferShipment;
    const res = await action(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(proceso === "pedido" ? "Pedido Efectuado Exitosamente" : "Envio Efectuado Exitosamente");
    setCart([]);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TransferProductsTable
            products={products}
            selectedProductId={selectedProduct?.id ?? null}
            onSelectProduct={setSelectedProduct}
            onOpenModal={openModal}
            page={page}
            totalPages={totalPages}
            baseQuery={baseQuery}
            canManage={canManage}
          />
        </div>
        <div className="space-y-4">
          {filters}
          <ProductInfoPanel product={selectedProduct} />
        </div>
      </div>

      {canManage && (pedidoCart.length > 0 || envioCart.length > 0) && (
        <TransferCartPanel
          pedidoCart={pedidoCart}
          envioCart={envioCart}
          onRemovePedido={(productId, branchId) => removeLine("pedido", productId, branchId)}
          onRemoveEnvio={(productId, branchId) => removeLine("envio", productId, branchId)}
          onSubmitPedido={() => submitCart("pedido")}
          onSubmitEnvio={() => submitCart("envio")}
          loadingPedido={loadingPedido}
          loadingEnvio={loadingEnvio}
        />
      )}

      {canManage && (
        <TransferQuantityModal
          product={modalProduct}
          proceso={modalProceso}
          branches={branches}
          ownBranchId={ownBranchId}
          onClose={() => {
            setModalProduct(null);
            setModalProceso(null);
          }}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: el único error restante debe estar en
`app/(dashboard)/traspasos/page.tsx` (se resuelve en Task 9).

- [ ] **Step 4: Commit**

```bash
git add components/traspasos/SolicitudEnvioTab.tsx app/"(dashboard)"/traspasos/TraspasosFilters.tsx
git commit -m "feat: pestaña Solicitud/Envío de Traspasos (carrito + filtro por código)"
```

---

### Task 8: Tarjeta de traspaso + pestañas Salientes/Entrantes

**Files:**
- Create: `components/traspasos/TransferStatusCard.tsx`
- Create: `components/traspasos/SalientesEntrantesTab.tsx`

**Interfaces:**
- Consumes: `getTransferView`, `TransferRole`, `TransferStatus`,
  `TransferType` (`lib/transferStatus.ts`, Task 2), `advanceTransferStatus`
  (`actions.ts`, Task 4), `Card`, `Button`, `EmptyState`
  (`components/ui/*`).
- Produces: `TransferCardItem = { productId, code, application,
  quantityRequested, quantitySent, currentStock }`, `TransferCardData = {
  id, createdAt, counterBranchName, status, role, type, items }`,
  componente `TransferStatusCard({ transfer, canManage })`; componente
  `SalientesEntrantesTab({ pedidoTitle, envioTitle, pedidos, envios,
  canManage })`. Ambos consumidos por `page.tsx` (Task 9).

- [ ] **Step 1: Implementar `components/traspasos/TransferStatusCard.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import { getTransferView, type TransferRole, type TransferStatus, type TransferType } from "@/lib/transferStatus";
import { advanceTransferStatus } from "@/app/(dashboard)/traspasos/actions";

export type TransferCardItem = {
  productId: string;
  code: string;
  application: string | null;
  quantityRequested: number;
  quantitySent: number | null;
  currentStock: number | null;
};

export type TransferCardData = {
  id: string;
  createdAt: string;
  counterBranchName: string;
  status: TransferStatus;
  role: TransferRole;
  type: TransferType;
  items: TransferCardItem[];
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-BO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const READONLY_FIELD_CLASS =
  "w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600";

export function TransferStatusCard({
  transfer,
  canManage,
}: {
  transfer: TransferCardData;
  canManage: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const view = getTransferView(transfer.type, transfer.status, transfer.role);
  // "Cant. enviada" solo tiene sentido una vez que el pedido salió de 'en
  // cola' (o siempre en un Envío, que nace con cantidad_enviada = solicitada).
  const showSentColumn = transfer.type === "envio" || transfer.status !== "en_cola";
  // "Stock actual" solo aplica al fulfiller de un Pedido (rol origin) —
  // igual que la columna del legacy en vista_entrantes.blade.php.
  const showStockColumn = transfer.type === "pedido" && transfer.role === "origin";

  async function handleAction(nextStatus: string) {
    setLoading(true);
    const formData = new FormData();
    formData.set("transferId", transfer.id);
    formData.set("nextStatus", nextStatus);
    const res = await advanceTransferStatus(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast("Se actualizó el estado");
    router.refresh();
  }

  return (
    <Card className="grid gap-4 p-4 md:grid-cols-[1fr_2fr]">
      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-500"># {transfer.id.slice(0, 8)}</p>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Fecha</span>
          <input type="text" readOnly value={DATE_FORMATTER.format(new Date(transfer.createdAt))} className={READONLY_FIELD_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Sucursal</span>
          <input type="text" readOnly value={transfer.counterBranchName} className={READONLY_FIELD_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Estado</span>
          <input type="text" readOnly value={view.label} className={READONLY_FIELD_CLASS} />
        </label>
        {canManage && view.actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {view.actions.map((action) => (
              <Button
                key={action.nextStatus}
                size="sm"
                variant="danger"
                disabled={loading}
                onClick={() => handleAction(action.nextStatus)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Aplicación</th>
              <th className="px-3 py-2">Cant. solicitada</th>
              {showSentColumn && <th className="px-3 py-2">Cant. enviada</th>}
              {showStockColumn && <th className="px-3 py-2">Stock actual</th>}
            </tr>
          </thead>
          <tbody>
            {transfer.items.map((item) => (
              <tr key={item.productId} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{item.code}</td>
                <td className="px-3 py-2 text-slate-500">{item.application ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{item.quantityRequested}</td>
                {showSentColumn && <td className="px-3 py-2 text-slate-600">{item.quantitySent ?? "—"}</td>}
                {showStockColumn && <td className="px-3 py-2 text-slate-600">{item.currentStock ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Implementar `components/traspasos/SalientesEntrantesTab.tsx`**

```tsx
import { ArrowLeftRight } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { TransferStatusCard, type TransferCardData } from "@/components/traspasos/TransferStatusCard";

export function SalientesEntrantesTab({
  pedidoTitle,
  envioTitle,
  pedidos,
  envios,
  canManage,
}: {
  pedidoTitle: string;
  envioTitle: string;
  pedidos: TransferCardData[];
  envios: TransferCardData[];
  canManage: boolean;
}) {
  if (pedidos.length === 0 && envios.length === 0) {
    return (
      <EmptyState
        icon={<ArrowLeftRight className="h-6 w-6" />}
        title="Sin traspasos pendientes"
        description="No hay traspasos activos en esta sección."
      />
    );
  }

  return (
    <div className="space-y-6">
      {pedidos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-800">{pedidoTitle}</h3>
          {pedidos.map((t) => (
            <TransferStatusCard key={t.id} transfer={t} canManage={canManage} />
          ))}
        </div>
      )}
      {envios.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-800">{envioTitle}</h3>
          {envios.map((t) => (
            <TransferStatusCard key={t.id} transfer={t} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: el único error restante debe seguir siendo en
`app/(dashboard)/traspasos/page.tsx` (se resuelve en Task 9).

- [ ] **Step 4: Commit**

```bash
git add components/traspasos/TransferStatusCard.tsx components/traspasos/SalientesEntrantesTab.tsx
git commit -m "feat: tarjeta de traspaso y pestañas Salientes/Entrantes"
```

---

### Task 9: `page.tsx` — wiring de las 3 pestañas + verificación final

**Files:**
- Modify (reescribir completo): `app/(dashboard)/traspasos/page.tsx`

**Interfaces:**
- Consumes: todo lo de Tasks 2–8.
- Produces: página final de `/traspasos`.

- [ ] **Step 1: Reescribir `app/(dashboard)/traspasos/page.tsx`**

```tsx
import { ArrowLeftRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { requireNavAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { escapePostgrestFilterValue } from "@/lib/postgrest";
import { clampPage } from "@/lib/ventasCart";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import type { TransferRole, TransferType } from "@/lib/transferStatus";
import { TraspasosFilters } from "./TraspasosFilters";
import { SolicitudEnvioTab } from "@/components/traspasos/SolicitudEnvioTab";
import { SalientesEntrantesTab } from "@/components/traspasos/SalientesEntrantesTab";
import type { TransferProduct } from "@/components/traspasos/TransferProductsTable";
import type { TransferCardData, TransferCardItem } from "@/components/traspasos/TransferStatusCard";

// El legacy pagina el listado de Solicitud/Envío de a 10 (Producto::filtro_producto_por_codigo).
const PAGE_SIZE = 10;

type TabKey = "sol_env" | "salientes" | "entrantes";

type SearchParams = {
  tab?: string;
  code?: string;
  page?: string;
};

type TransferItemRow = {
  product_id: string;
  quantity_requested: number;
  quantity_sent: number | null;
  products: { code: string; application: string | null } | null;
};

type TransferRow = {
  id: string;
  type: TransferType;
  status: TransferCardData["status"];
  created_at: string;
  from_branch: { name: string } | null;
  to_branch: { name: string } | null;
  transfer_items: TransferItemRow[];
};

const TRANSFER_SELECT =
  "id, type, status, created_at, from_branch:branches!transfers_from_branch_id_fkey(name), to_branch:branches!transfers_to_branch_id_fkey(name), transfer_items(product_id, quantity_requested, quantity_sent, products(code, application))";

export default async function TraspasosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireNavAccess("traspasos");
  const sp = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();

  if (!profile?.branchId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Traspasos" />
        <EmptyState
          icon={<ArrowLeftRight className="h-6 w-6" />}
          title="No tienes una sucursal asignada"
          description="Pide al administrador que te asigne una sucursal en Ajustes antes de hacer traspasos."
        />
      </div>
    );
  }

  const branchId = profile.branchId;
  const canManage = can(profile.role, "traspasos:create");
  const tab: TabKey = sp.tab === "salientes" || sp.tab === "entrantes" ? sp.tab : "sol_env";

  const { data: branchesData } = await supabase
    .from("branches")
    .select("id, name")
    .neq("id", branchId)
    .order("name");
  const branches = branchesData ?? [];

  async function buildTransferCards(
    type: TransferType,
    branchColumn: "from_branch_id" | "to_branch_id",
    role: TransferRole,
  ): Promise<TransferCardData[]> {
    const { data } = await supabase
      .from("transfers")
      .select(TRANSFER_SELECT)
      .eq("type", type)
      .eq(branchColumn, branchId)
      .not("status", "in", "(entregado,rechazado,cancelado)")
      .order("created_at", { ascending: true });

    const rows = (data ?? []) as unknown as TransferRow[];

    // "Stock actual" solo aplica a Pedidos donde mi sucursal decide enviar
    // (role='origin') — se muestra para decidir cuánto puede realmente
    // cubrir, igual que el legacy.
    let stockByProduct = new Map<string, number>();
    if (type === "pedido" && role === "origin") {
      const productIds = [...new Set(rows.flatMap((r) => r.transfer_items.map((i) => i.product_id)))];
      if (productIds.length > 0) {
        const { data: stockRows } = await supabase
          .from("product_stock")
          .select("product_id, quantity")
          .eq("branch_id", branchId)
          .in("product_id", productIds);
        stockByProduct = new Map(
          (stockRows ?? []).map((s) => [s.product_id as string, s.quantity as number]),
        );
      }
    }

    return rows.map((r) => {
      const counterBranch = role === "origin" ? r.to_branch : r.from_branch;
      const items: TransferCardItem[] = r.transfer_items.map((i) => ({
        productId: i.product_id,
        code: i.products?.code ?? "—",
        application: i.products?.application ?? null,
        quantityRequested: i.quantity_requested,
        quantitySent: i.quantity_sent,
        currentStock:
          type === "pedido" && role === "origin" ? (stockByProduct.get(i.product_id) ?? 0) : null,
      }));
      return {
        id: r.id,
        createdAt: r.created_at,
        counterBranchName: counterBranch?.name ?? "—",
        status: r.status,
        role,
        type: r.type,
        items,
      };
    });
  }

  if (tab === "salientes") {
    const [pedidos, envios] = await Promise.all([
      buildTransferCards("pedido", "to_branch_id", "destination"),
      buildTransferCards("envio", "from_branch_id", "origin"),
    ]);
    return (
      <div className="space-y-6">
        <PageHeader title="Traspasos" />
        {tabsNav(tab)}
        <SalientesEntrantesTab
          pedidoTitle="Pedidos de Productos"
          envioTitle="Envío de productos"
          pedidos={pedidos}
          envios={envios}
          canManage={canManage}
        />
      </div>
    );
  }

  if (tab === "entrantes") {
    const [pedidos, envios] = await Promise.all([
      buildTransferCards("pedido", "from_branch_id", "origin"),
      buildTransferCards("envio", "to_branch_id", "destination"),
    ]);
    return (
      <div className="space-y-6">
        <PageHeader title="Traspasos" />
        {tabsNav(tab)}
        <SalientesEntrantesTab
          pedidoTitle="Pedidos"
          envioTitle="Recepción de Envíos"
          pedidos={pedidos}
          envios={envios}
          canManage={canManage}
        />
      </div>
    );
  }

  // tab === "sol_env"
  const explicitPage = sp.page ? Math.max(1, Number(sp.page) || 1) : 1;
  let query = supabase
    .from("products")
    .select("id, code, application, product_stock!inner(quantity)", { count: "exact" })
    .eq("product_stock.branch_id", branchId)
    .order("created_at", { ascending: false });
  if (sp.code) query = query.ilike("code", `%${escapePostgrestFilterValue(sp.code)}%`);

  const { data, count } = await query.range(0, PAGE_SIZE * 200 - 1);
  const allRows = (data ?? []) as unknown as {
    id: string;
    code: string;
    application: string | null;
    product_stock: { quantity: number }[];
  }[];
  const totalPages = Math.max(1, Math.ceil((count ?? allRows.length) / PAGE_SIZE));
  const page = clampPage(explicitPage, totalPages);
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const products: TransferProduct[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    application: r.application,
    stock: r.product_stock[0]?.quantity ?? 0,
  }));

  const baseParams = new URLSearchParams();
  if (sp.code) baseParams.set("code", sp.code);
  const baseQuery = baseParams.toString();

  return (
    <div className="space-y-6">
      <PageHeader title="Traspasos" />
      {tabsNav(tab)}
      <SolicitudEnvioTab
        products={products}
        page={page}
        totalPages={totalPages}
        baseQuery={baseQuery}
        branches={branches}
        ownBranchId={branchId}
        filters={<TraspasosFilters initialCode={sp.code ?? ""} />}
        canManage={canManage}
      />
    </div>
  );
}

function tabsNav(active: TabKey) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "sol_env", label: "Solicitud/Envío" },
    { key: "salientes", label: "Salientes" },
    { key: "entrantes", label: "Entrantes" },
  ];
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <a
          key={t.key}
          href={`/traspasos?tab=${t.key}`}
          className={`px-4 py-2 text-sm font-medium ${
            t.key === active ? "border-b-2 border-brand text-brand" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores en todo el proyecto.

- [ ] **Step 3: Correr toda la suite de tests**

Run: `npx vitest run`
Expected: todos los tests pasan, incluyendo los 13 de
`lib/transferStatus.test.ts` y los 8 de `lib/transferCart.test.ts`.

- [ ] **Step 4: Verificación manual en servidor de desarrollo**

Run: `npm run dev`, luego con dos usuarios de sucursales distintas (o
cambiando `branch_id` del perfil entre pruebas):

1. Ir a `/traspasos?tab=sol_env` — ver tabla de productos propios, paginada
   de a 10, filtro por código funcionando.
2. Clic en "Pedido" de un producto → modal pide sucursal + cantidad → probar
   una cantidad mayor al stock de esa sucursal → debe mostrar el error
   inline sin cerrar el modal. Con una cantidad válida, agregar — aparece en
   "Productos para Pedir".
3. Clic en "Envío" de otro producto → mismo flujo, valida contra el stock
   PROPIO. Agregar — aparece en "Productos para Enviar".
4. "Pedir Productos" — confirma sin errores, el carrito de Pedido se vacía,
   el stock NO cambia todavía (Pedido nace en `en_cola`).
5. "Enviar Productos" — confirma sin errores, el carrito de Envío se vacía,
   el stock PROPIO baja de inmediato.
6. Con el usuario de la sucursal a la que se le pidió el Pedido: ir a
   `/traspasos?tab=entrantes` — debe verse el Pedido con botones "Enviar"/
   "Rechazar" y la columna "Stock actual". Clic en "Enviar" — el stock de
   esa sucursal baja, el estado pasa a "Enviando".
7. Con el usuario original: `/traspasos?tab=salientes` — el Pedido ahora
   muestra "En Camino" con botón "Recepcionar". Clic — el stock propio sube.
8. Repetir 6–7 para el Envío creado en el paso 5, desde la perspectiva del
   receptor en `/traspasos?tab=entrantes` (botón "Recepcionar").
9. Confirmar en `/movimientos-producto` que las filas `transferencia`
   aparecen en los momentos correctos (al enviar, al recepcionar).

- [ ] **Step 5: Commit**

```bash
git add app/"(dashboard)"/traspasos/page.tsx
git commit -m "feat: wiring final de las 3 pestañas de Traspasos"
```

---

## Self-Review

**Cobertura del spec:** modelo de datos (Task 1), máquina de estados con
las 6 transiciones de la tabla (Tasks 1 SQL + 2 TS), carrito multi-sucursal
en React (Tasks 3, 5, 6, 7), 3 pestañas con la regla Salientes=creado-por-mí
/ Entrantes=dirigido-a-mí (Task 9), historial de auditoría sin UI (Task 1,
tabla `transfer_status_history`), permiso único `traspasos:create` (Tasks 4,
6, 7, 8, 9 vía `canManage`), eliminación del traspaso instantáneo (Task 4).
Todos los ítems del spec tienen tarea.

**Placeholders:** ninguno — todo paso de código trae la implementación
completa, sin "TODO" ni fragmentos a medio escribir.

**Consistencia de tipos:** `TransferCartLine`, `TransferProceso`,
`TransferProduct`, `TransferCardData`/`TransferCardItem`, `TransferRole`,
`TransferStatus`, `TransferType` se definen una sola vez cada uno (Tasks 2,
3, 5, 6, 8) y se importan igual en cada consumidor — verificado que los
nombres de campos (`productId`, `branchId`, `branchName`, `quantity`,
`quantityRequested`, `quantitySent`, `currentStock`) coinciden en todos los
archivos que los usan.
