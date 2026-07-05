# Impersonación de organización (superadmin) — Design Spec

## Contexto

El panel `/superadmin` ya permite crear negocios, prender/apagar módulos y
suspender organizaciones. Falta: poder entrar a un negocio y ver/operar sus
pantallas reales (Ventas, Productos, Clientes, etc.) como si fueras su admin,
para soporte, sin que el negocio se entere.

## Decisiones (confirmadas con el usuario)

- **Alcance:** acceso completo (lectura y escritura), igual que loguearse
  como el admin real de esa organización — no un modo de solo lectura.
- **Registro:** cada impersonación queda guardada (quién, a qué organización,
  cuándo empezó/terminó) en una tabla nueva, visible solo para superadmin,
  nunca para el negocio.
- **Invisible para el negocio:** el negocio no recibe ningún aviso/email/
  notificación cuando el superadmin entra a impersonar.

## Por qué "impersonación real" (session swap) y no un modo de vista alterna

Todo el aislamiento multi-tenant de la app se hace con RLS en Postgres,
comparando `auth.uid()` (el usuario realmente autenticado en el JWT) contra
`profiles.org_id`. Esto significa que **ninguna bandera a nivel de aplicación
puede hacer que las queries de una página vean los datos de OTRA
organización** sin cambiar quién está autenticado de verdad — todas las
~20 páginas del dashboard seguirían filtrando por la organización del
superadmin (o ninguna, si no tiene perfil), sin importar qué se le pase por
props. La única forma de reutilizar el 100% de las páginas/RLS ya existentes
sin tocarlas es que el navegador del superadmin quede momentáneamente
autenticado como un usuario real de esa organización (su admin).

## Diseño

### Mecanismo (session swap vía OTP admin-generado)

1. El superadmin hace clic en "Ver como" en la tarjeta de una organización.
2. Server action `startImpersonation(orgId)`:
   - Verifica `isPlatformAdmin()`.
   - Busca (con `createAdminClient()`, service-role) el admin activo de esa
     organización: `profiles` con `org_id = orgId`, `role = 'admin'`,
     `active = true` (el más antiguo). Si no hay ninguno → error.
   - Obtiene su email vía `admin.auth.admin.getUserById(profileId)`.
   - Genera un magic link server-side:
     `admin.auth.admin.generateLink({ type: 'magiclink', email })` — esto NO
     envía ningún correo, solo devuelve un `hashed_token` que el propio
     backend puede canjear.
   - Guarda el `refresh_token` de la sesión ACTUAL del superadmin en una
     cookie httpOnly/secure (`impersonation_return_token`), más el id del
     superadmin y el id/nombre de la organización destino (para el banner),
     antes de reemplazar la sesión.
   - Canjea el `hashed_token` con `supabase.auth.verifyOtp({ type:
     'magiclink', token_hash, email })` usando el cliente ligado a cookies
     — esto reemplaza la sesión del navegador por la del admin de destino.
   - Inserta una fila en `impersonation_log` (service-role).
   - Redirige a `/dashboard`. A partir de acá, CUALQUIER página funciona sin
     cambios: RLS ve al admin real de esa organización.
3. Mientras se impersona, un banner fijo (visible SOLO en el navegador del
   superadmin, porque depende de una cookie que solo existe ahí) muestra
   "Viendo como: {organización} — Salir" en todas las páginas del dashboard.
4. Server action `endImpersonation()`:
   - Marca `ended_at = now()` en la fila abierta de `impersonation_log`.
   - Usa el `refresh_token` guardado para restaurar la sesión del superadmin
     (`supabase.auth.refreshSession({ refresh_token })`), reemplazando de
     nuevo las cookies.
   - Borra las cookies de impersonación.
   - Redirige a `/superadmin`.

### Tabla nueva

```sql
create table impersonation_log (
  id                 uuid primary key default gen_random_uuid(),
  platform_admin_id  uuid not null references auth.users (id) on delete cascade,
  target_org_id      uuid not null references organizations (id) on delete cascade,
  target_profile_id  uuid not null references profiles (id) on delete cascade,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz
);
```

RLS: habilitada, única policy de `select` con `is_platform_admin()` (mismo
helper que ya usan otras tablas). Sin políticas de insert/update para
`authenticated` — las únicas escrituras las hace el service-role client
desde los server actions de impersonación, que bypassa RLS por diseño (mismo
patrón que el resto de `/superadmin`).

### Archivos

- Nuevo: `supabase/migrations/0013_impersonation_log.sql`
- Nuevo: `lib/impersonation.ts` (helpers `startImpersonation`,
  `endImpersonation`, `getImpersonationState()` — lee las cookies para el
  banner)
- Modificar: `app/(dashboard)/superadmin/actions.ts` (o archivo nuevo junto)
  para exponer las server actions
- Modificar: `components/superadmin/OrgCard.tsx` (botón "Ver como")
- Nuevo: `components/ImpersonationBanner.tsx`
- Modificar: `app/(dashboard)/layout.tsx` (renderizar el banner cuando
  corresponda)

## Riesgos / notas

- Esto toca el flujo de autenticación real (intercambio de sesión vía
  cookies). Se prueba con `tsc`/`vitest` como el resto de la sesión, pero el
  swap de sesión en sí (cookies Set-Cookie, expiración, refresh) **necesita
  verificación manual en el navegador** — no es verificable con `curl` solo.
- Si el navegador ya tenía una sesión de superadmin activa en OTRA pestaña,
  esa pestaña también verá la sesión reemplazada (las cookies son por
  dominio, no por pestaña) — es una limitación conocida de este mecanismo,
  no un bug.
