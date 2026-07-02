# Exportar Datos (Respaldo Completo) — Design Spec

## Contexto

Pedido: un apartado para descargar absolutamente toda la información del
sistema, para un eventual respaldo o migración a otra plataforma.

## Decisiones (confirmadas con el usuario)

- **Formato:** un único Excel (.xlsx) con una hoja por tabla de negocio
  (reutiliza la librería `xlsx` ya usada para importar productos).
- **Alcance:** todas las tablas de negocio de la organización — sucursales,
  marcas/familias/procedencias, proveedores, productos, stock, inventario
  (entidad de ejemplo), clientes, ventas, detalle de ventas, devoluciones,
  movimientos de stock y bitácora de auditoría. **No** incluye usuarios/
  perfiles del equipo, ni nada de `auth.users` (contraseñas, tokens) —
  eso nunca debería exportarse.
- **Acceso:** solo admin.

## Diseño

- **Ubicación:** nueva sección "Respaldo de datos" dentro de `/ajustes`
  (página ya admin-only), con un botón de descarga — no amerita un módulo
  ni entrada de menú nueva.
- **Mecanismo:** Route Handler (`GET /ajustes/exportar`), no una server
  action — el navegador necesita descargar un archivo binario directamente
  (`Content-Disposition: attachment`), algo que una server action no puede
  devolver como descarga nativa del navegador.
- **Auth:** los Route Handlers no pasan por el layout del dashboard (que
  hace el guard de sesión/rol para las páginas), así que el handler verifica
  `getProfile()` + `role === "admin"` él mismo y devuelve 403 si no cumple.
- **Aislamiento:** se usa el cliente autenticado normal (no admin/service-role)
  para que RLS filtre automáticamente por la organización del usuario —
  ninguna consulta necesita `.eq("org_id", ...)` manual (aunque para
  `sale_items`, que no tiene columna `org_id` propia, esto es lo único que
  la aísla — ya es el mismo patrón que el resto de la app usa al leerla).
- **Paginación interna:** Supabase corta cada `select` en 1000 filas por
  defecto; el handler pagina con `.range()` hasta agotar cada tabla antes de
  escribir su hoja, para que ventas/movimientos con miles de filas no se
  trunquen silenciosamente.

## Archivos

- Nuevo: `app/(dashboard)/ajustes/exportar/route.ts`
- Modificar: `app/(dashboard)/ajustes/page.tsx` (sección + botón de descarga)

Sin cambios de esquema, sin server actions nuevas.
