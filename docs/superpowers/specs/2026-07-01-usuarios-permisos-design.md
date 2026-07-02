# Diseño: Módulo Usuarios + permisos por módulo

Fecha: 2026-07-01

## Contexto

Hoy la gestión de equipo vive dentro de `/ajustes` (`TeamPanel`). Los permisos
de acceso a módulos del menú lateral se calculan solo a partir del **rol**
fijo del usuario (`admin`/`manager`/`member`/`viewer`, ver `lib/rbac.ts`
`NAV_WHITELIST`), combinado con los feature flags de la organización
(`lib/features.ts`).

Se pidió, a partir de una captura de un sistema viejo de referencia, poder
elegir por **usuario individual** qué módulos ve, además de su rol.

## Decisiones de alcance (confirmadas con el usuario)

1. **Roles + override por módulo.** Se mantiene el rol como base de permisos
   de escritura/borrado (no se toca `rbac.ts` MATRIX ni RLS). Se agrega un
   override de **visibilidad de módulo** por usuario, que solo puede
   restringir, nunca ampliar, lo que el rol ya permite.
2. **Alcance del override: solo visibilidad de menú/acceso**, no modo
   lectura/escritura por módulo.
3. **Nueva página `/usuarios`** (solo admin), separada de `/ajustes`.
   `/ajustes` queda con Sucursales + config general.
4. **Lista de módulos del checkbox** incluye los módulos existentes
   (`lib/features.ts`) más 5 módulos "reservados" de la captura vieja que
   todavía no tienen página: `traspasos`, `devoluciones`,
   `reporte_productos`, `reporte_ventas`, `tasa_cambio`. Estos solo aparecen
   en el checkbox, sin `href` ni entrada de menú real, hasta que se
   construyan en el futuro.
5. **Sin override = ve todo lo que su rol permite** (comportamiento actual,
   cero impacto para usuarios existentes al desplegar).
6. **Alta de usuario sigue siendo por invitación de correo** (flujo actual:
   nombre, correo, rol, sucursal). No se cambia a usuario+clave manual.

## Modelo de datos

Nueva columna en `profiles`:

```sql
alter table profiles
  add column allowed_modules jsonb null;
```

- `null` → sin override, se usa `NAV_WHITELIST[role]` tal cual (default).
- `jsonb` array de `FeatureKey` (ej. `["dashboard","productos","ventas"]`) →
  restringe la visibilidad a esa lista, **intersectada** con
  `NAV_WHITELIST[role]` y con los feature flags de la organización. El
  override nunca puede otorgar un módulo que el rol o la organización no
  permitan.

Migración: `supabase/migrations/0006_user_module_permissions.sql`.

## `lib/features.ts`

Se agregan 5 `FeatureKey` reservados sin entrada real de menú:

```ts
| "traspasos"
| "devoluciones"
| "reporte_productos"
| "reporte_ventas"
| "tasa_cambio"
```

No se agregan a `FEATURES` (el array que genera el menú lateral), porque no
tienen `href`. Se define un array aparte, p. ej. `RESERVED_FEATURES`, usado
solo para poblar el modal de checkboxes en `/usuarios`. Cuando se construya
alguno de estos módulos en el futuro, se promueve de `RESERVED_FEATURES` a
`FEATURES` (con su `href`) sin tocar el dato ya guardado en
`allowed_modules`.

## `lib/rbac.ts`

`canSeeNav` gana un tercer parámetro opcional:

```ts
export function canSeeNav(
  role: Role | undefined,
  key: FeatureKey,
  allowedModules?: FeatureKey[] | null,
): boolean {
  if (!role) return false;
  if (!NAV_WHITELIST[role]?.includes(key)) return false;
  if (allowedModules == null) return true;
  return allowedModules.includes(key);
}
```

## `lib/guard.ts`

`requireNavAccess` lee `profile.allowedModules` (se agrega al tipo de
`getProfile()` en `lib/auth.ts`) y lo pasa a `canSeeNav`.

## Página `/usuarios`

- Se mueve el `TeamPanel` (formulario de invitación + lista de miembros) de
  `/ajustes` a `/usuarios`. `/ajustes` pierde esa sección.
- Cada fila de la lista de usuarios agrega un botón **"Permisos"** que abre
  un modal (`components/usuarios/PermissionsModal.tsx`) con un checkbox por
  cada entrada de `FEATURES` (no-core) + `RESERVED_FEATURES`, precargado con
  `allowed_modules` del usuario (o todo marcado si es `null`).
- Guardar llama a una nueva server action `setUserModules(userId,
  modules: FeatureKey[])` en `app/(dashboard)/usuarios/actions.ts`, con el
  mismo candado `.eq("org_id", profile.orgId)` que las demás acciones de
  equipo, y bloqueando `profile.role !== "admin"`.
- El admin no puede abrir el modal de permisos sobre su propia fila (mismo
  criterio que "no puedes desactivar tu propia cuenta"), para no bloquearse
  el acceso a `/usuarios`/`/ajustes` a sí mismo.

## Fuera de alcance

- No se construyen las páginas de Traspasos, Devoluciones, Reporte Producto,
  Reporte Ventas, Tasa Cambio (Fase futura).
- No se cambia el modelo de invitación por correo.
- No se agrega modo lectura/escritura por módulo a nivel usuario.
