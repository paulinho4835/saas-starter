# SaaS Starter (multi-tenant)

Esqueleto reutilizable para construir cualquier SaaS multi-tenant, extraído de un
sistema en producción. Trae resuelto todo lo que **no** depende del dominio:
autenticación, organizaciones (tenants), roles y permisos, feature flags por
organización, panel de superadmin, invitaciones por correo, modo oscuro, design
system, rate limiting, health check y aislamiento por RLS.

Incluye un módulo de ejemplo (**clientes**) que sirve de plantilla para crear las
entidades de tu dominio.

## Stack

Next.js (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind CSS ·
TypeScript · Upstash (rate limiting, opcional) · Cloudflare R2 (archivos, opcional).

## Qué incluye

| Área | Archivos clave |
|------|----------------|
| Multi-tenancy | `lib/auth.ts`, `lib/superadmin.ts`, migración `auth_org_id()` |
| Roles y permisos | `lib/rbac.ts` (`admin`/`manager`/`member`/`viewer`) |
| Feature flags (addons) | `lib/features.ts`, panel en `/superadmin` |
| Auth y onboarding | `app/(auth)/*`, `lib/inviteUser.ts`, `app/auth/callback` |
| Design system | `components/ui/*`, dark mode en `app/globals.css` + `tailwind.config.ts` |
| Seguridad/operación | `lib/ratelimit.ts`, `lib/env.ts`, `app/api/health` |
| Legal | `lib/legal.ts`, `app/(legal)/*`, `components/legal/TermsGate.tsx` |
| Módulo de ejemplo | `app/(dashboard)/clientes/*`, `components/clientes/*` |

## Puesta en marcha

1. **Instalar dependencias**
   ```bash
   npm install
   ```

2. **Crear proyecto en Supabase** y copiar las claves a `.env.local`
   (usa `.env.example` como plantilla).

3. **Aplicar el esquema**: ejecuta `supabase/migrations/0001_init.sql` en el SQL
   Editor del dashboard de Supabase (o `supabase db push` con la CLI).

4. **Crear el primer usuario**: en Supabase → Authentication, crea un usuario;
   luego sigue el patrón de `supabase/seed.sql` para insertar su `profile` y, si
   quieres que sea operador de la plataforma, su fila en `platform_admins`.

5. **Configurar Redirect URLs** en Supabase → Auth → URL Configuration:
   añade `http://localhost:3000/auth/callback` y el de producción. Traduce las
   plantillas de correo "Invite user" y "Reset password" al español.

6. **Arrancar**
   ```bash
   npm run dev
   ```

## Cómo agregar un módulo nuevo (tu dominio)

El módulo **clientes** es la plantilla. Para una entidad nueva (p. ej. `pedidos`):

1. **DB**: crea la tabla con `org_id uuid not null references organizations(id)`
   y replica las 4 políticas RLS de `customers` (select/insert/update/delete con
   `org_id = auth_org_id()`).
2. **Feature flag**: añade la clave a `FeatureKey` y a `FEATURES` en
   `lib/features.ts`, y permítela por rol en `NAV_WHITELIST` (`lib/rbac.ts`).
3. **Permisos**: añade `pedidos:write` etc. a `lib/rbac.ts`.
4. **UI**: copia `app/(dashboard)/clientes/` (page + actions) y
   `components/clientes/` (form + delete) y renombra.
5. **Icono del menú**: añade la entrada en el mapa `ICONS` de `components/Sidebar.tsx`.

## Re-tematizar

Cambia la marca y los colores en un solo lugar:
- **Color**: la paleta `brand` en `tailwind.config.ts`.
- **Nombre/contacto**: `lib/legal.ts` (`PLATFORM_NAME`, `OPERATOR_NAME`, etc.).

El modo oscuro funciona automáticamente: las clases `bg-white`/`text-slate-*`
se invierten vía variables CSS (ver `app/globals.css`); no toques clases una por una.

## Notas

- Los textos legales (`/terminos`, `/privacidad`) son **plantillas**: ajústalos y
  hazlos revisar por un abogado de tu jurisdicción.
- El `service-role` (`lib/supabase/admin.ts`) **bypassa RLS**: úsalo solo en el
  panel `/superadmin` y en server actions que ya verifican autorización. Nunca en
  rutas de una organización.
