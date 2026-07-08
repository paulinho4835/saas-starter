# Rediseño de Productos como réplica del sistema legacy — Diseño

## Objetivo

Rediseñar el módulo Productos (`/productos`, pestaña "Productos") para que
replique el diseño y flujo del sistema PHP legacy "Venta Retenes"
("Registro de Productos"), explorado directamente en el código fuente
(`ComegashetasV2`, Laravel). El sidebar de navegación del SaaS actual **no
se toca** — la réplica aplica solo al contenido de la pestaña Productos.
Las pestañas Marcas/Familias/Procedencias no cambian.

Se implementa primero en local (para revisión visual antes de cualquier
push/deploy). Corregimos los bugs conocidos del legacy en vez de copiarlos
(filtros Familia/Procedencia/Proveedor que no funcionaban, fórmula CF
inconsistente).

## Alcance confirmado

Basado en la exploración del legacy y las decisiones tomadas durante el
brainstorming:

### 1. Layout: formulario inline reemplaza el modal de creación

Card "Registro de Productos" **siempre visible arriba de la tabla**
(reemplaza `ProductFormModal` en modo `create`; el modo `edit` sigue en
modal). Campos, en el mismo orden que el legacy:

- Código (texto, requerido)
- Interno / Externo / Altura / Pestaña / Tope (mm, number, opcionales →
  se normalizan a 0 si vienen vacíos, igual que el legacy)
- Marca (texto libre con autocompletar contra las marcas existentes de la
  org — ver sección 6, auto-creación)
- Familia (texto libre, mismo tratamiento que Marca)
- Procedencia (texto libre, mismo tratamiento que Marca)
- Sucursal (select — a diferencia del legacy, que la fija a la sucursal
  del usuario logueado, nuestra app es multi-sucursal así que se mantiene
  seleccionable; el stock inicial se registra ahí, y las demás sucursales
  arrancan en 0, igual que `registar_stock_producto` del legacy)
- Cantidad / stock inicial (number, requerido)
- Proveedor (select estricto — única excepción a "texto libre", igual que
  el legacy; solo elegible entre proveedores ya creados de la org)
- Costo $ (number, requerido)
- SF % (number, requerido) + SF Bs (readonly, calculado)
- CF Bs (readonly, calculado) + % CF (readonly, calculado — ver fórmula)
- MAY % (number, requerido) + MAY Bs (readonly, calculado)
- Costo Bs (readonly, calculado)
- T. Cambio (readonly, precargado de `organizations.exchange_rate`)
- Aplicación (textarea, opcional)

Botones: "Registrar Producto" (submit) y "Limpiar Campos" (resetea el
formulario sin recargar la tabla).

### 2. Fórmula de precio — regla única, sin inconsistencias

El legacy tenía dos fórmulas distintas para CF según el flujo (una al abrir
el modal de edición, otra al escribir). Fijamos una sola regla, aplicada
tanto en creación como en edición:

```
costo_bs = costo_usd * tasa_cambio
sf_bs    = costo_bs * (1 + sf_pct / 100)
may_bs   = costo_bs * (1 + may_pct / 100)
cf_bs    = sf_bs * 1.13
cf_pct   = (cf_bs / costo_bs - 1) * 100        // solo display, redondeado
```

`cf_pct` y los 4 campos `_bs` son **siempre de solo lectura**, recalculados
en el cliente en cada cambio de `costo_usd`, `sf_pct` o `may_pct` (cambiar
`may_pct` no afecta a CF). Esto reemplaza el `margin_cf_pct` editable que
existe hoy en el schema — pasa a ser una columna derivada/informativa, no
un input de usuario (ver sección 8, cambios de datos).

### 3. Editar — modal, misma fórmula

`ProductFormModal` en modo `edit` se mantiene como modal (igual que hoy y
que el legacy), pero:
- Usa la misma fórmula derivada de la sección 2.
- Marca/Familia/Procedencia pasan a ser inputs de texto libre con
  autocompletar (auto-creación on-the-fly, sección 6), igual que el
  formulario de creación.
- Proveedor sigue siendo select estricto.

### 4. Tabla — filtros por columna, acciones en hover

Columnas (igual que hoy, sin cambios): Familia, Código producto, Marca,
Stock (total global, sección 5), Costo $, CF Bs, SF Bs, MAY Bs, MI, ME,
ALT, PEST, TOPE, Aplicación, Procedencia, acciones.

**Filtros**: se reemplaza el bloque actual (Buscar + selects Marca/
Familia/Procedencia/Proveedor) por una fila de inputs de texto individuales
sobre las columnas Código, Familia, MI, ME, Altura, Pestaña, Tope,
Aplicación, Marca, Procedencia, Proveedor — con botones "Buscar" y
"Limpiar", igual al legacy visualmente. A diferencia del legacy (donde
Familia/Procedencia/Proveedor estaban rotos — comentados en el query real),
**todos los filtros funcionan**.

**Acciones de fila (Editar/Borrar)**: ocultas por defecto, reveladas en un
panel flotante al hacer hover sobre un ícono al final de la fila (flyout
lateral), igual al comportamiento CSS del legacy (`table.css`
`.deslize`/`.hide-content`). Implementado con CSS (`group-hover` de
Tailwind), no JS.

**Paginación**: se mantiene la paginación con ventana + elipsis que ya
existe (no la lista completa de números del legacy).

### 5. Stock — total global (sin cambios)

La columna Stock sigue sumando todas las sucursales, como hoy. No se
replica la limitación del legacy (stock de una sola sucursal fija por
sesión).

### 6. Auto-creación de Marca / Familia / Procedencia

Al guardar un producto (crear o editar), si el nombre escrito en Marca,
Familia o Procedencia no existe todavía como catálogo de la org, se crea
automáticamente (`UPPERCASE`, trim) antes de guardar el producto — mismo
comportamiento que `validar_foranea_producto` del legacy. Proveedor NO
tiene este comportamiento: sigue siendo un select estricto de proveedores
ya existentes en la org.

El autocompletar en el formulario sugiere coincidencias existentes
mientras se escribe (para evitar duplicados por variaciones de
mayúsculas/espacios — la comparación de "existe o no" es case-insensitive
con trim).

### 7. Borrado — soft-delete

"Borrar" deja de ser un `DELETE` de la fila. Se agrega `active boolean not
null default true` a `products`; borrar hace `update(active = false)`.
Todos los listados (tabla de Productos, selects de producto en Ventas/
Traspasos/Ajuste de Inventario/etc.) filtran `active = true`. Esto evita
romper referencias de FK desde ventas/traspasos/movimientos históricos y
permite deshacer un borrado por error (fuera de alcance de este rediseño:
no se agrega una UI de "restaurar", solo la columna y el filtro).

### 8. Exportar Excel ("Catálogo")

Se agregan botones de exportación (equivalentes a "Catálogo Pt1/Pt2" del
legacy, pero sin partir en bloques de 7500 — esa limitación era de
Laravel-Excel/memoria del legacy y no aplica aquí). Un solo botón "Exportar
Excel" que descarga el catálogo completo activo (`active = true`) de la
org con las columnas de la tabla: FAMILIA, CODIGO_PRODUCTO, MARCA, STOCK
(total), COSTO $, CF Bs, SF Bs, MAY Bs, MI, ME, ALT, PEST, TOPE,
APLICACION, PROCEDENCIA. Generado server-side (server action), mismo patrón
que ya existe para "Importar Excel".

## Cambios de datos (resumen)

- `products.active boolean not null default true` (nueva columna,
  migración nueva).
- `products.margin_cf_pct` deja de recibirse como input del usuario — se
  sigue guardando (para no romper el schema/reportes existentes) pero el
  valor persistido pasa a ser siempre el `cf_pct` derivado de la fórmula de
  la sección 2, calculado server-side al guardar (no confiar solo en el
  cliente).
- Todas las queries que listan/buscan productos (`/productos`, `/ventas`,
  selects de producto en Traspasos/Devoluciones/Ajuste de Inventario/
  Reporte Producto) agregan `.eq("active", true)`.
- RLS de `products` no cambia (sigue siendo `org_id = auth_org_id()`); el
  filtro de `active` es a nivel de query de aplicación, no de política.

## Fuera de alcance

- No se toca el sidebar ni la navegación general.
- No se replica la restricción del legacy de "stock de una sola sucursal
  por sesión" (sección 5).
- No se agrega UI de "restaurar producto borrado" (solo la capacidad de
  soft-delete queda lista para eso a futuro).
- No se replica el bug de filtros rotos ni la fórmula CF inconsistente del
  legacy (secciones 2 y 4 corrigen ambos explícitamente).
- Pestañas Marcas/Familias/Procedencias (`SimpleCatalogManager`) no
  cambian — la auto-creación de la sección 6 es adicional, no reemplaza
  esa gestión manual.
