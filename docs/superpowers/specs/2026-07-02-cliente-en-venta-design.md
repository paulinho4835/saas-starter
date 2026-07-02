# Cliente (Nombre/NIT) en Ventas + Historial — Design Spec

## Contexto

Hoy el carrito de `/ventas` liga la venta a un cliente vía un dropdown de
clientes ya registrados. Paulo pidió poder **anotar nombre y NIT** del
cliente directo en el mostrador (campos opcionales, no obligatorios) y luego,
dado un NIT o nombre, poder **ver el historial de compras** de ese cliente:
qué productos llevó, en qué fecha, con qué medidas, y a qué precio.

## Decisiones previas (de la fase de preguntas)

1. Nombre/NIT en el carrito **crean o vinculan un cliente automáticamente**:
   si el NIT ya existe en la organización, la venta se liga a ese cliente
   (y se actualiza el nombre si vino distinto); si no existe, se crea un
   cliente nuevo. Sin NIT (solo nombre), siempre se crea un cliente nuevo —
   no hay match por nombre solo (ambiguo, dos personas pueden compartir
   nombre).
2. El **dropdown de cliente se reemplaza** por los 2 campos de texto
   (Nombre, NIT) — más parecido a un mostrador real. Si ambos quedan vacíos,
   la venta queda sin cliente ("mostrador"), igual que hoy.
3. El **historial de compras vive en `/clientes`**, en una ficha de detalle
   por cliente (no en el flujo de venta) — productos, fecha, medidas
   (MI/ME/ALT/PEST/TOPE) y precio de cada línea vendida a ese cliente.
4. `/clientes` gana un **buscador por nombre/NIT** (no existía ningún filtro
   ahí antes) para poder ubicar al cliente cuando solo tenés el NIT en la
   mano.

## Sección 1: Modelo de datos (aprobada)

```sql
alter table customers add column nit text;

-- Dedup por NIT dentro de la organización (case-insensitive). Nulo/vacío no
-- cuenta como duplicado — muchos clientes de mostrador no dan NIT.
create unique index customers_org_nit_idx on customers (org_id, lower(nit))
  where nit is not null and nit <> '';
```

## Sección 2: `createSale` — resolver cliente por nombre/NIT (aprobada)

`app/(dashboard)/ventas/actions.ts` reemplaza el campo `customerId` (uuid del
dropdown) por `customerName`/`customerNit` (texto libre, ambos opcionales).
Antes de crear la venta:

1. Si `customerNit` viene informado: buscar `customers` por
   `(org_id, lower(nit) = lower(customerNit))`.
   - Si existe: usar ese `id`. Si además vino `customerName` y es distinto
     al guardado, actualizar `full_name` (el cliente pudo corregir su
     nombre).
   - Si no existe: crear un cliente nuevo con ese `nit` y el `customerName`
     dado (o `"Cliente sin nombre"` si vino solo el NIT).
2. Si no vino `customerNit` pero sí `customerName`: crear un cliente nuevo
   siempre (sin intento de dedup por nombre).
3. Si ambos vienen vacíos: `customer_id = null`, igual que la venta de
   mostrador de hoy.

La creación/vinculación de cliente **no requiere el permiso `clientes:write`**
por separado — cualquier rol que pueda vender (`ventas:create`) puede
registrar al cliente como parte de la venta, igual que ya podía elegirlo del
dropdown antes sin ese permiso.

## Sección 3: `/clientes/[id]` — ficha de cliente con historial (aprobada)

Página nueva, server component. Muestra:
- Datos del cliente (nombre, NIT, email, teléfono).
- Historial de compras: todas las líneas de `sale_items` de todas las
  `sales` con `customer_id` = este cliente, con join a `products` (código,
  aplicación, medidas MI/ME/ALT/PEST/TOPE) y a `sales` (fecha, `sale_type`),
  ordenado por fecha descendente. Columnas: fecha, código, aplicación,
  medidas, cantidad, precio unitario, tipo de venta.
- Cada fila de `/clientes` (la lista) se vuelve un link a su ficha.

`/clientes` (la lista) gana un campo de búsqueda por nombre o NIT (texto,
filtra `ilike` sobre `full_name` o `nit`) — reutiliza el patrón GET
`searchParams` ya usado en otras páginas antes de la búsqueda dinámica
(no hace falta debounce acá, es una lista que no cambia con cada tecla en
un mostrador real — se busca y se envía).

## Fuera de alcance (YAGNI)

- Historial de compras visible desde el carrito de Ventas mismo (se eligió
  que viva solo en `/clientes/[id]`).
- Fusionar clientes duplicados manualmente (si dos clientes sin NIT
  resultan ser la misma persona, no hay flujo de merge — se corrige a mano
  editando/borrando en `/clientes` si hace falta).
- Autocompletar nombre/NIT mientras se escribe en el carrito (sugerencias
  en vivo) — no pedido, los campos son de texto libre simple.
