# Traspasos: flujo Pedido/Envío con estados (réplica del legacy) — Design Spec

## Contexto

El módulo `/traspasos` actual (ver `docs/superpowers/specs/2026-07-02-traspasos-design.md`)
implementa un traspaso **instantáneo**: un único botón "Transferir" que
descuenta de origen y suma a destino en el mismo momento, sin estado "en
tránsito". Fue una decisión deliberada para evitar la complejidad del
legacy.

El usuario revisó el módulo equivalente del sistema legacy PHP ("Venta
Retenes", `traspaso_controller.php` + `resources/views/traspaso/*`) y pidió
explícitamente reemplazar el traspaso instantáneo por una **réplica
funcional completa** de ese flujo: carritos de sesión "Pedido"/"Envío", 3
pestañas (Solicitud/Envío, Salientes, Entrantes), máquina de estados por
traspaso, e historial de cambios de estado.

## Decisiones (confirmadas con el usuario)

- **Carrito:** estado de React en el cliente (mismo patrón que el carrito de
  Ventas), no un borrador persistido en DB. Se pierde si se recarga la
  página a medias — aceptado.
- **Multi-sucursal por carrito:** SÍ, idéntico al legacy — un mismo carrito
  de Pedido (o de Envío) puede tener productos dirigidos a varias sucursales
  distintas; al confirmar se crea un `transfer` por cada sucursal
  involucrada.
- **Tiempo real:** NO. Las pestañas Salientes/Entrantes se actualizan al
  cargar/recargar la página o tras una acción (`router.refresh()`), igual
  que el resto del sistema. Sin Supabase Realtime.
- **Historial de estados:** SÍ, se guarda (`transfer_status_history`) para
  auditoría, aunque no se muestre en la UI en esta primera versión.
- **Traspaso instantáneo actual:** se reemplaza por completo. Se elimina
  `components/traspasos/TransferBetweenBranchesButton.tsx` y deja de
  usarse `transferBetweenBranches()`. `/almacen` (traspaso unidireccional
  fijo desde almacén) no se toca — es un flujo aparte.
- **Paginación Salientes/Entrantes:** el legacy pagina de a UN traspaso por
  vez (`paginate(1)`) — se identificó como limitación, no como decisión de
  diseño. Aquí se muestra la lista completa de traspasos no terminales por
  sección, sin paginar de a uno.
- **Permisos:** un único permiso `traspasos:create` (ya existente, admin +
  manager) gatea todas las acciones — crear Pedido/Envío, aceptar, rechazar,
  recepcionar, cancelar — igual que el legacy, que exige un único permiso
  `tras` para toda la pantalla.

## Modelo de datos

Migración `supabase/migrations/0016_traspasos_workflow.sql`.

### `transfers`

```sql
create table transfers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations (id) on delete cascade,
  type            text not null check (type in ('pedido', 'envio')),
  status          text not null check (status in ('en_cola', 'enviando', 'entregado', 'rechazado', 'cancelado')),
  from_branch_id  uuid not null references branches (id),
  to_branch_id    uuid not null references branches (id),
  created_by      uuid not null references profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

**Convención fija de `from_branch_id`/`to_branch_id` según `type`** (idéntica
al legacy, donde `agregar_producto_a_sesion()` asigna origen/destino según
si `$proceso == 'Envio'` o no):

- `type = 'pedido'`: `to_branch_id` = la sucursal de quien **creó** el
  Pedido (quien lo recibirá). `from_branch_id` = la sucursal a la que se le
  pide el stock (quien decide enviar o rechazar).
- `type = 'envio'`: `from_branch_id` = la sucursal de quien **creó** el
  Envío (quien envía). `to_branch_id` = la sucursal destino elegida.

Regla derivada, usada para las pestañas: **"Salientes" = todo lo que el
usuario creó** (`created_by`'s branch matches the "creator" side per type
— equivalentemente: pedidos donde `to_branch_id` = mi sucursal, o envíos
donde `from_branch_id` = mi sucursal). **"Entrantes" = todo lo que requiere
mi acción** (el complemento: pedidos donde `from_branch_id` = mi sucursal,
o envíos donde `to_branch_id` = mi sucursal).

### `transfer_items`

```sql
create table transfer_items (
  id                   uuid primary key default gen_random_uuid(),
  transfer_id          uuid not null references transfers (id) on delete cascade,
  product_id           uuid not null references products (id),
  quantity_requested   integer not null check (quantity_requested > 0),
  quantity_sent        integer check (quantity_sent >= 0)
);
```

- Pedido al crearse: `quantity_requested` = cantidad pedida, `quantity_sent`
  = null.
- Envío al crearse: `quantity_requested` = `quantity_sent` = cantidad
  enviada (se usa el mismo campo `quantity_requested` para no duplicar
  columnas; en un Envío ambas valen lo mismo desde el inicio).
- Pedido en transición `en_cola → enviando`: `quantity_sent` se fija igual a
  `quantity_requested` (el legacy no permite enviar una cantidad distinta a
  la solicitada).

### `transfer_status_history`

```sql
create table transfer_status_history (
  id           uuid primary key default gen_random_uuid(),
  transfer_id  uuid not null references transfers (id) on delete cascade,
  status       text not null,
  actor_id     uuid not null references profiles (id),
  created_at   timestamptz not null default now()
);
```

Una fila por cada cambio de estado (incluida la creación). Solo para
auditoría; no se consulta desde la UI en esta versión.

### RLS

Mismo patrón que `sale_returns` (`0011_devoluciones.sql`): `enable row
level security` + policies `select`/`insert`/`update` con
`org_id = auth_org_id()` en las 3 tablas nuevas.

### `stock_movements`

No requiere un `movement_type` nuevo: se reutiliza `'transferencia'` (ya
existe desde `0006_almacen.sql`), escrito en los mismos momentos en que el
legacy realmente mueve stock (ver máquina de estados abajo) — sigue
apareciendo correctamente en `/movimientos-producto`.

## Máquina de estados

Único RPC `advance_transfer(p_transfer_id, p_actor_id, p_actor_branch_id,
p_next_status)`, con bloqueo de fila (`for update`) y verificación
`where status = <estado_actual_esperado>` (igual patrón optimista que
`createSale`/`transfer_stock`) para que dos acciones concurrentes sobre el
mismo traspaso no se pisen.

| type   | rol de quien actúa (`p_actor_branch_id`)            | estado actual | `p_next_status` válido | efecto en stock |
|--------|------------------------------------------------------|---------------|-------------------------|------------------|
| pedido | `to_branch_id` (quien lo creó / recibirá)             | `en_cola`     | `cancelado`              | ninguno |
| pedido | `from_branch_id` (a quien se le pide)                 | `en_cola`     | `enviando`               | resta `quantity_requested` de `from_branch_id`; fija `quantity_sent` |
| pedido | `from_branch_id`                                      | `en_cola`     | `rechazado`              | ninguno |
| pedido | `to_branch_id`                                        | `enviando`    | `entregado`              | suma `quantity_sent` a `to_branch_id` |
| envio  | (creación, no es una transición de `advance_transfer`) | —            | `enviando` (estado inicial) | resta `quantity_requested` de `from_branch_id` al crear |
| envio  | `to_branch_id` (quien recibe)                         | `enviando`    | `entregado`              | suma `quantity_sent` a `to_branch_id` |

Cualquier combinación no listada es rechazada por el RPC (`raise
exception`) — replica la ausencia de esa rama en el `switch`/array
`estados` del legacy.

`p_actor_branch_id` lo resuelve siempre el server action a partir de
`getProfile()` (nunca del cliente), igual que `branchId` en `createSale` y
`transferBetweenBranches`.

## Lógica pura testeable — `lib/transferStatus.ts`

Mirror en TypeScript de `traspaso_model::estados` (usado tanto para pintar
la etiqueta/botón correcto en la UI como para validar client-side antes de
llamar al server action; el RPC vuelve a validar en SQL, no confía
ciegamente en esta capa):

```ts
export type TransferType = "pedido" | "envio";
export type TransferStatus = "en_cola" | "enviando" | "entregado" | "rechazado" | "cancelado";
export type TransferRole = "origin" | "destination"; // origin = from_branch_id, destination = to_branch_id

export type TransferAction = { nextStatus: TransferStatus; label: string };

export function getTransferView(
  type: TransferType,
  status: TransferStatus,
  role: TransferRole,
): { label: string; actions: TransferAction[] };
```

Tabla completa (label del estado actual + acciones disponibles) portada
directamente de `traspaso_model::estados` (`pedido_salida`, `pedido_entrada`,
`envio_salida`, `envio_entrada`).

## `lib/transferCart.ts` — agrupación del carrito

Pure functions para el carrito de React (mismo espíritu que
`lib/ventasCart.ts`): agrupar líneas `{ productId, code, branchId,
branchName, quantity }` por `branchId` para pintar las tablas "Productos
para Pedir"/"Productos para Enviar" agrupadas, y para construir el payload
(un grupo por sucursal) que el server action convierte en un `transfer` por
grupo.

## UI

### Pestaña "Solicitud/Envío" (`?tab=sol_env`, default)

- Tabla paginada de `product_stock` de la sucursal propia (código, stock,
  columnas Pedido/Envío con botón cada una — reemplaza el botón único
  "Transferir" actual).
- Panel derecho: filtro por código; "Datos adicionales" con aplicación +
  stock por sucursal del producto seleccionado (reutiliza
  `BranchStockPanel`, ya existente en Ventas).
- Clic en Pedido/Envío → modal (sucursal destino si es Pedido / origen si
  es Envío — todas menos la propia; cantidad) → agrega línea al carrito de
  React.
- Debajo: tablas "Productos para Pedir"/"Productos para Enviar" agrupadas
  por sucursal, botón "Borrar" por línea, botón "Pedir Productos"/"Enviar
  Productos" al fondo de cada una → un server action que crea un
  `transfer` + sus `transfer_items` por cada grupo de sucursal (Pedido:
  status inicial `en_cola`, sin tocar stock; Envío: status inicial
  `enviando`, descuenta stock del creador de inmediato, vía un RPC
  `create_transfer` con bloqueo de fila igual que `transfer_stock`).

### Pestañas "Salientes" / "Entrantes" (`?tab=salientes` / `?tab=entrantes`)

- Lista completa (no de a uno) de `transfers` no terminales
  (`status not in ('entregado','rechazado','cancelado')`) para esa
  sucursal, agrupados en dos secciones: Pedidos y Envíos.
- Cada tarjeta: `# id`, fecha, sucursal contraria, estado actual (label de
  `getTransferView`), detalle de productos (código, aplicación, cantidad
  solicitada/enviada; en Entrantes-Pedidos además el stock actual de esa
  sucursal para decidir), y el/los botón(es) de acción según
  `getTransferView(...).actions`.
- Cada acción llama a un server action `advanceTransfer(transferId,
  nextStatus)` → resuelve `actorBranchId` del perfil, llama al RPC
  `advance_transfer`, `revalidatePath("/traspasos")`.

### Navegación

Pestañas como enlaces `?tab=sol_env|salientes|entrantes` (Server Component,
mismo patrón de `searchParams` que ya usa Ventas) — sin librería de tabs
nueva.

## Archivos

- Nuevo: `supabase/migrations/0016_traspasos_workflow.sql`
- Nuevo: `lib/transferStatus.ts` + `lib/transferStatus.test.ts`
- Nuevo: `lib/transferCart.ts` + `lib/transferCart.test.ts`
- Reescribir: `app/(dashboard)/traspasos/page.tsx` (3 pestañas)
- Reescribir: `app/(dashboard)/traspasos/actions.ts` (`createTransfer`,
  `advanceTransfer`; se elimina `transferBetweenBranches`)
- Nuevo: `components/traspasos/SolicitudEnvioTab.tsx` (tabla + carrito +
  modal de cantidad/sucursal)
- Nuevo: `components/traspasos/SalientesEntrantesTab.tsx` (tarjetas por
  traspaso)
- Eliminar: `components/traspasos/TransferBetweenBranchesButton.tsx`
- Modificar: `lib/features.ts`, `lib/rbac.ts` si hiciera falta ajustar la
  descripción del feature (el permiso `traspasos:create` ya existe, no
  cambia)

## Testing

- `lib/transferStatus.test.ts`: las 6 transiciones legales de la tabla de
  arriba (una por fila), más casos ilegales representativos (rol
  equivocado, estado terminal, tipo equivocado) devolviendo `actions: []`.
- `lib/transferCart.test.ts`: agrupación por sucursal, con líneas de
  distintas sucursales mezcladas en el mismo carrito.
- Sin tests de integración contra Supabase (igual que el resto del
  proyecto) — el RPC se prueba manualmente en el servidor de desarrollo.
