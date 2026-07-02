# Cliente (Nombre/NIT) en Ventas + Historial — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el dropdown de cliente en `/ventas` por campos de texto Nombre/NIT que crean o vinculan un cliente automáticamente, y agregar una ficha de cliente en `/clientes/[id]` con su historial de compras (producto, fecha, medidas, precio).

**Architecture:** `customers` gana columna `nit` con dedup por `(org_id, lower(nit))`. `createSale` resuelve/crea el cliente server-side antes de insertar la venta. Página nueva `/clientes/[id]` (server component) reconstruye el historial uniendo `sales`+`sale_items`+`products` filtrado por `customer_id`. `/clientes` gana un buscador simple (GET, sin debounce).

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (Postgres + RLS), Zod, Tailwind, Vitest.

## Global Constraints

- Ver spec: `docs/superpowers/specs/2026-07-02-cliente-en-venta-design.md`.
- Español neutro en toda la UI.
- Dedup de cliente **solo por NIT** (nunca por nombre solo).
- Crear/vincular cliente en `createSale` no requiere `clientes:write`, solo `ventas:create` (ya validado).
- `org_id` siempre del perfil verificado server-side.

---

### Task 1: Migración — columna `nit` + dedup

**Files:** Create: `supabase/migrations/0009_cliente_nit.sql`

```sql
alter table customers add column nit text;

create unique index customers_org_nit_idx on customers (org_id, lower(nit))
  where nit is not null and nit <> '';
```

Aplicar: `docker exec -i supabase_db_productos-sucursales-stock psql -U postgres -d postgres < supabase/migrations/0009_cliente_nit.sql`. Commit.

---

### Task 2: `createSale` — resolver/crear cliente por nombre/NIT

**Files:** Modify: `app/(dashboard)/ventas/actions.ts`

- Reemplazar `customerId: z.string().uuid().nullable()` del schema por
  `customerName: z.string().trim().max(120).optional()` y
  `customerNit: z.string().trim().max(30).optional()`.
- Antes del insert de `sales`, resolver `resolvedCustomerId: string | null`:
  1. Si hay `customerNit`: `select id, full_name from customers where org_id = orgId and lower(nit) = lower(customerNit)`. Si existe y `customerName` difiere, `update` el `full_name`. Si no existe, `insert` uno nuevo (`full_name: customerName || "Cliente sin nombre"`, `nit: customerNit`) y usar el `id` devuelto.
  2. Si no hay `customerNit` pero sí `customerName`: `insert` un cliente nuevo sin NIT, usar el `id` devuelto.
  3. Si ninguno: `resolvedCustomerId = null`.
- Usar `resolvedCustomerId` en el insert de `sales.customer_id` (reemplaza el actual `parsed.data.customerId`).
- Quitar la validación previa de "cliente seleccionado no es válido" (ya no aplica, el cliente se resuelve/crea acá, no se recibe un id del cliente a validar).

Verificar tipos (`npx tsc --noEmit` — esperar error en `SalePanel.tsx`, se corrige en Task 3). Commit.

---

### Task 3: `SalePanel.tsx` — Nombre/NIT reemplazan el dropdown

**Files:** Modify: `components/ventas/SalePanel.tsx`

- Quitar el `<select>` de cliente y el prop `customers` (ya no se usa la lista).
- Agregar 2 `<input>` de texto: "Nombre del cliente (opcional)" y "NIT (opcional)", con `useState` propio.
- En `onConfirm`, mandar `customerName`/`customerNit` en el `FormData` en vez de `customerId`.
- El componente `VentasPage` (Task 4) deja de pasar `customers` como prop — quitar el prop de la firma.

Verificar tipos. Commit.

---

### Task 4: `app/(dashboard)/ventas/page.tsx` — dejar de pasar `customers`

**Files:** Modify: `app/(dashboard)/ventas/page.tsx`

- Quitar la query a `customers` (ya no se usa) y el prop `customers` en `<SalePanel />`.

Verificar tipos. Commit.

---

### Task 5: `/clientes/[id]/page.tsx` — ficha con historial

**Files:** Create: `app/(dashboard)/clientes/[id]/page.tsx`

- `requireNavAccess("clientes")`.
- Trae el cliente por `id` (404/`notFound()` si no existe o no es de la org — RLS ya lo filtra, pero verificar `!data` explícito).
- Trae historial: `sale_items` con `select("quantity, unit_price_bs, subtotal_bs, products(code, application, internal_mm, external_mm, height_mm, flange_mm, stop_mm), sales!inner(created_at, sale_type, customer_id)")`, filtrado `sales.customer_id = id`, `order("sales(created_at)", {ascending: false})`.
- Render: datos del cliente arriba (`PageHeader`), tabla del historial abajo (fecha, código, aplicación, medidas, cantidad, precio unitario, tipo de venta) con `EmptyState` si no hay compras.

Verificar tipos. Commit.

---

### Task 6: `/clientes` — link a la ficha + buscador

**Files:** Modify: `app/(dashboard)/clientes/page.tsx`

- Cada `<li>` de la lista pasa a ser un `<Link href={`/clientes/${c.id}`}>` (o envuelve el nombre en un link).
- Agregar `searchParams: Promise<{ q?: string }>`, un `<form method="get">` simple con un input "Buscar por nombre o NIT" (sin debounce, submit normal), que filtra la query con `.or(`full_name.ilike.%${q}%,nit.ilike.%${q}%`)` (usar `escapePostgrestFilterValue`).
- Traer también `nit` en el `select` y mostrarlo en la lista si existe.

Verificar tipos. Commit.

---

### Task 7: Verificación manual

- Hacer una venta con Nombre+NIT nuevos → confirmar que se creó un cliente en `/clientes`.
- Repetir la venta con el mismo NIT → confirmar que NO se duplica el cliente (misma ficha, historial acumulado).
- Entrar a la ficha del cliente → confirmar que el historial muestra producto, fecha, medidas y precio correctos.
- Probar el buscador de `/clientes` por NIT parcial y por nombre.
- Hacer una venta sin nombre ni NIT → confirmar que sigue funcionando como "mostrador" (sin cliente).
