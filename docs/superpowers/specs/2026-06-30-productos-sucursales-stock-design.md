# Fase 1: Productos + Sucursales + Stock — Diseño

## Contexto

Upgrade del sistema de ventas en PHP (10+ años) de una tienda de retenes
(repuestos automotrices), construido sobre el core `saas-starter`
(Next.js + Supabase + RBAC multi-tenant) ya existente en este repo.

El sistema viejo tiene estos módulos (vistos en capturas): Productos, Usuarios,
Proveedores, Ventas, Ajuste de Inventario, Traspasos, Devoluciones, Reporte
Producto, Reporte Ventas, Movimientos de Producto. Es demasiado grande para un
solo proyecto — se divide en fases independientes, cada una con su propio
diseño + plan + implementación:

1. **Productos + Sucursales + Stock** ← este documento
2. Ventas
3. Usuarios/Permisos (reemplaza el RBAC de roles fijos por permisos
   granulares por usuario, ver «Notas para fases futuras»)
4. Traspasos/Devoluciones
5. Reportes

El sistema viejo no está disponible como código — el diseño se reconstruyó a
partir de capturas de pantalla y de un export real en Excel del catálogo de
productos del cliente (que se usará para la carga masiva).

## Defecto del sistema viejo que se corrige aquí

El sistema viejo guarda una fila de producto **por cada combinación
producto+sucursal** (mismo código repetido con distinto stock por sucursal).
El diseño nuevo separa esto: una fila de producto en `products` (catálogo) +
N filas en `product_stock` (una por sucursal donde tiene inventario).

## Modelo de datos

Todas las tablas siguen el patrón ya establecido en
`supabase/migrations/0001_init.sql`: `org_id` + RLS comparando contra
`auth_org_id()`. El service-role del panel `/superadmin` bypassa RLS como ya
documenta el README.

### Catálogos de apoyo

```sql
branches (sucursales)
  id, org_id, name, active, created_at

product_brands (marcas)
  id, org_id, name, created_at

product_families (familias)
  id, org_id, name, created_at

product_origins (procedencias)
  id, org_id, name, created_at

suppliers (proveedores)
  id, org_id, name, phone, contact_name, notes, created_at
```

Cada uno: `unique(org_id, name)` para evitar duplicados accidentales
(case-insensitive vía índice sobre `lower(name)`).

### `products` (catálogo)

```
id              uuid pk
org_id          uuid not null
code            text not null            -- código de catálogo del proveedor, formato libre
brand_id        uuid not null references product_brands
family_id       uuid not null references product_families
origin_id       uuid references product_origins
supplier_id     uuid references suppliers
internal_mm     numeric                  -- INTERNO
external_mm     numeric                  -- EXTERNO
height_mm       numeric                  -- ALTURA
flange_mm       numeric                  -- PESTAÑA
stop_mm         numeric                  -- TOPE
application     text                     -- APLICACION
cost_usd        numeric                  -- COSTO $ (nullable: import sin costo)
exchange_rate   numeric                  -- T CAMBIO usado al calcular
margin_sf_pct   numeric
margin_cf_pct   numeric
margin_may_pct  numeric
price_sf_bs     numeric not null default 0
price_cf_bs     numeric not null default 0
price_may_bs    numeric not null default 0
created_at      timestamptz
updated_at      timestamptz
```

Índice `unique(org_id, code, brand_id)` — la llave de coincidencia para
carga masiva y para evitar duplicados manuales es **código + marca** (mismo
código con distinta marca = productos distintos, confirmado contra el Excel
real del cliente).

**Cálculo de precio** (función pura, testeable):
```
costo_bs = costo_usd * tipo_cambio
precio_nivel_bs = round(costo_bs * (1 + margin_nivel_pct / 100), 2)
```
Se recalcula en el servidor cada vez que se guarda el producto desde el
formulario (si `cost_usd` está presente). Los productos creados por carga
masiva sin costo guardan los `price_*_bs` directamente desde el Excel
(`cost_usd`/`margin_*_pct` quedan `null` — se pueden completar después
editando el producto, lo que dispara el recálculo).

### `product_stock`

```
id          uuid pk
org_id      uuid not null
product_id  uuid not null references products on delete cascade
branch_id   uuid not null references branches
quantity    integer not null default 0
updated_at  timestamptz
unique(product_id, branch_id)
```

## Carga masiva (Excel)

Entrada: archivo `.xlsx`/`.csv` con columnas
`FAMILIA, CODIGO_PRODUCTO, MARCA, STOCK, CF, SF, MAY, MI, ME, ALT, PEST, TOPE, APLICACION`
(formato real confirmado contra el export del cliente). Cada archivo
corresponde a **una sola sucursal**, elegida por el usuario antes de subir.

Flujo:
1. Seleccionar sucursal destino + subir archivo.
2. Parseo y validación fila por fila (server action). Reglas:
   - `FAMILIA`, `CODIGO_PRODUCTO`, `MARCA` obligatorios.
   - `STOCK`, `CF`, `SF`, `MAY` y las medidas deben ser numéricos si vienen
     informados; vacío se trata como `null`/`0` según el campo.
3. **Vista previa** antes de tocar la base de datos: cuenta de filas nuevas /
   a actualizar (match `code + brand`) / con error (con motivo), y detalle
   de las filas con error.
4. Confirmar import:
   - Si `MARCA`/`FAMILIA` no existen en el catálogo de la organización, se
     **autocrean** (confirmado con el usuario — no bloquea la carga de
     cientos de filas).
   - Upsert de `products` por `(org_id, code, brand_id)`.
   - Upsert de `product_stock` para la sucursal elegida — el `STOCK` del
     archivo **reemplaza** (no suma) la cantidad existente en esa sucursal.

## UI

- **`/productos`**: lista con búsqueda (código, familia, marca, aplicación)
  y paginación server-side. Acciones: «Nuevo producto», «Importar Excel».
  Tabs internas para administrar Marcas / Familias / Procedencias (catálogos
  chicos, CRUD simple: nombre + crear/eliminar).
- **`/proveedores`**: CRUD simple (nombre, teléfono, contacto, notas) — módulo
  propio igual que en el sistema viejo.
- **Sucursales**: CRUD simple, vive dentro de **Ajustes** (es configuración
  de la organización, no un atributo de producto).
- **Formulario de producto**: replica los campos de la captura original
  (código, medidas, marca, familia, procedencia, proveedor, costo, % por
  nivel, tipo de cambio) con los precios en Bs calculados en vivo mientras se
  escribe.

## Permisos (Fase 1, temporal)

Se usan los 4 roles fijos ya existentes en `lib/rbac.ts`
(`admin/manager/member/viewer`) — **no** el sistema de checkboxes por usuario
visto en la captura de Usuarios, que es alcance de la Fase 3 (ver abajo).

Nuevos permisos en `lib/rbac.ts`:
`productos:read/write/delete/import`, `catalogos:write` (marcas/familias/
procedencias), `sucursales:write`, `proveedores:read/write`.

| Rol     | productos | catálogos | importar | sucursales | proveedores |
|---------|-----------|-----------|----------|------------|-------------|
| admin   | r/w/delete| w         | sí       | w          | r/w         |
| manager | r/w       | w         | sí       | —          | r/w         |
| member  | r         | —         | —        | —          | r           |
| viewer  | r         | —         | —        | —          | r           |

Nuevo `FeatureKey`: `"productos"`, `"proveedores"` (se suman a
`lib/features.ts` y a `NAV_WHITELIST`).

## Notas para fases futuras

- **Fase 3 (Usuarios/Permisos)** reemplazará la tabla de roles fijos por un
  esquema de permisos granulares por usuario y módulo (como la captura
  «Asignar permisos»): una tabla `user_module_permissions(user_id, module_key,
  can_view, can_write, ...)` que el admin edita por checkboxes. Cuando esto
  se implemente, los permisos `productos:*` definidos aquí migran a ese
  esquema sin cambiar la lógica de negocio (los server actions ya llaman a
  `can(...)`, solo cambia su implementación interna).
- **Fase 2 (Ventas)** consumirá `product_stock` y los tres niveles de precio
  (`price_sf_bs/price_cf_bs/price_may_bs`) directamente.

## Testing

- Tests unitarios (Vitest) para la función pura de cálculo de precio y para
  el parser/dedupe de la carga masiva (con filas de muestra basadas en el
  Excel real).
- QA manual en `npm run dev`: crear producto a mano, importar un Excel de
  prueba, verificar stock por sucursal y recálculo de precio al editar costo.
