# Almacén — Design Spec

## Contexto

El negocio tiene un depósito central ("Almacén") con más repuestos que la tienda
física. Cuando la tienda se queda sin stock de un producto, el admin va a Almacén,
saca una cantidad y esa cantidad debe descontarse del stock del almacén y sumarse
automáticamente al stock de la sucursal destino, en un solo movimiento.

Este módulo se construye sobre Fase 1 (Productos + Sucursales + Stock), Ventas y
Ajuste de Inventario, todos ya en `master`. Reutiliza el mismo modelo de datos
(`branches`, `product_stock`, `stock_movements`) en vez de crear tablas nuevas.

## Decisiones previas (de la fase de preguntas)

1. Hay **un único almacén** por organización (no varios depósitos).
2. Al transferir, el admin **elige la sucursal destino en el momento** (no es fija
   por perfil de usuario) — sirve si hay más de una tienda.
3. Solo **admin** puede transferir stock de Almacén a una sucursal.
4. La atomicidad de la transferencia (restar en almacén + sumar en destino +
   2 movimientos de historial) se garantiza con una **función de base de datos**
   (transacción SQL atómica), no con pasos secuenciales + rollback manual como
   `adjustStock` — por moverse entre 2 sucursales a la vez, el riesgo de una
   escritura a medias es mayor que un ajuste de una sola sucursal.

## Sección 1: Modelo de datos (aprobada)

**Almacén es una sucursal más**, distinguida con una columna nueva:

```sql
alter table branches add column is_warehouse boolean not null default false;

-- Garantiza como máximo un almacén por organización.
create unique index branches_one_warehouse_per_org_idx
  on branches (org_id) where is_warehouse;
```

No se crean tablas nuevas. `product_stock` (clave `product_id, branch_id`) y
`stock_movements` se reutilizan sin cambios de esquema — el almacén es
simplemente otro `branch_id` con `is_warehouse = true`.

**Selectores de sucursal existentes que deben excluir el almacén** (para que no
se pueda asignar como sucursal de trabajo de un usuario, ni aparezca como
"tienda" en filtros pensados para vender):

| Archivo | Uso actual | Cambio |
|---|---|---|
| `app/(dashboard)/ajustes/page.tsx` | Lista de sucursales para `TeamPanel` (asignar sucursal a usuario) y `SimpleCatalogManager` (alta/baja de sucursales) | Agregar `.eq("is_warehouse", false)` a la query de sucursales para `TeamPanel`. La gestión de sucursales (crear/borrar) puede seguir listando todas — el almacén no se crea/borra desde ahí, se crea en la migración/seed. |
| `app/(dashboard)/productos/page.tsx` | Filtro de sucursal para ver stock de un producto | Agregar `.eq("is_warehouse", false)` — este filtro es para stock de tienda; el stock de almacén se ve en `/almacen`. |
| `app/(dashboard)/ajuste-inventario/page.tsx` | Selector de sucursal para ajuste manual | Agregar `.eq("is_warehouse", false)` — el ajuste manual de almacén, si hace falta alguna vez, es un caso de uso futuro no pedido ahora (YAGNI). |
| `app/(dashboard)/movimientos-producto/page.tsx` | Filtro de sucursal en el historial | **No se excluye** — las transferencias sí deben poder filtrarse por "Almacén" en el historial, es información legítima. |

`lib/catalogs.ts` (`verifyBranchInOrg`) no cambia — sigue validando cualquier
`branchId` de la org, almacén incluido (lo necesita la función de transferencia).

## Sección 2: Transferencia atómica (aprobada)

Función Postgres `transfer_stock`, ejecutada en una sola transacción:

```sql
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

  -- Bloquea la fila de origen para evitar carreras entre 2 transferencias simultáneas.
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
```

- `movement_type` gana un valor nuevo: se actualiza el `check` de
  `stock_movements` a `check (movement_type in ('alta_inicial', 'importacion',
  'ajuste_manual', 'venta', 'transferencia'))`.
- `security invoker` (no `definer`): la función corre con los permisos del rol
  que llama (`authenticated`), así que RLS de `product_stock`/`stock_movements`
  se sigue aplicando igual que en el resto del código — no es una puerta trasera.
- El server action llama a la función vía `supabase.rpc("transfer_stock", {...})`
  después de validar con Zod y `can(profile.role, "almacen:transfer")`, y de
  verificar con `verifyBranchInOrg` que ambas sucursales (origen y destino)
  pertenecen a la org del usuario.
- `p_org_id`/`p_actor_id` siempre vienen del profile verificado server-side,
  nunca del cliente — mismo patrón que `adjustStock`.

## Sección 3: UI y permisos (aprobada)

- **Feature flag** nuevo en `lib/features.ts`: `almacen` (opt-in, como
  `movimientos_producto`), con `href: "/almacen"`.
- **`NAV_WHITELIST`** (`lib/rbac.ts`): entrada `almacen` solo en `admin` (no en
  `manager`, a diferencia de `ajuste_inventario`/`movimientos_producto`).
- **Permiso nuevo**: `"almacen:transfer"` en `Permission`, presente solo en la
  matriz de `admin`.
- **Página `/almacen`** (`app/(dashboard)/almacen/page.tsx`, server component):
  - Busca la sucursal con `is_warehouse = true` de la org (si no existe, 
    `EmptyState` pidiendo crearla — caso borde inicial antes de correr el seed
    de la org).
  - Lista productos con su stock en esa sucursal (mismo `RESULT_SELECT` que
    Ventas, adaptado a `product_stock.branch_id = almacenBranchId`).
  - Filtro dinámico reutilizando el mismo patrón de `VentasFilters.tsx`
    (client component, debounce 300ms, actualiza `searchParams` sin recarga) —
    por Código, Aplicación y Marca.
  - Por fila: cantidad a transferir (input numérico) + selector de sucursal
    destino (todas las `is_warehouse = false` de la org) + botón "Transferir".
- **Server action** `transferStock` en `app/(dashboard)/almacen/actions.ts`:
  Zod-valida `productId`, `toBranchId`, `quantity` (entero positivo), llama
  `verifyBranchInOrg` para `toBranchId`, resuelve el `branchId` del almacén
  server-side (no confía en uno mandado por el cliente), llama al RPC
  `transfer_stock`, y hace `revalidatePath("/almacen")`.
- El historial de transferencias no requiere UI nueva: al insertar en
  `stock_movements` con `movement_type = 'transferencia'`, ya aparecen solas
  en `/movimientos-producto` (que no filtra por tipo de movimiento hoy).

## Fuera de alcance (YAGNI)

- Múltiples almacenes / transferencias entre tiendas (tienda→tienda) — no
  pedido, la única ruta es Almacén→tienda.
- Deshacer una transferencia — igual que Ajuste de Inventario, el ledger es
  inmutable; una transferencia mal hecha se corrige con otra transferencia o
  un ajuste manual en sentido contrario.
- Alertas de "stock bajo en tienda" que sugieran transferir — no pedido.
