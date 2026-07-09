# Panel de uso de Supabase en Superadmin — Diseño

## Objetivo

Mostrar en `/superadmin` cuánto espacio de DB y de Storage está usando la app
contra los límites del plan Free de Supabase, para anticipar cuándo hay que
subir de plan.

## Alcance confirmado

- Solo dos métricas: tamaño de base de datos y tamaño de storage (archivos).
  No egress, no MAU, no Edge Functions — descartados explícitamente.
- Sin Management API ni Personal Access Token. Ambas métricas se calculan
  con SQL directo contra el propio proyecto Supabase:
  - DB: `pg_database_size(current_database())`.
  - Storage: `sum((metadata->>'size')::bigint)` sobre `storage.objects`
    (es la misma cifra que Supabase usa para facturar/mostrar en su
    dashboard).
- Sin caché ni cron: se recalcula cada vez que se visita `/superadmin`.
- Solo lectura, sin acciones ni alertas automáticas en esta iteración.

## Arquitectura

### 1. Migración SQL — `supabase/migrations/0019_platform_usage.sql`

Dos funciones `security definer`, schema `public`:

```sql
create or replace function public.platform_db_size_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;

create or replace function public.platform_storage_usage_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)
  from storage.objects;
$$;

revoke execute on function public.platform_db_size_bytes() from public, anon, authenticated;
revoke execute on function public.platform_storage_usage_bytes() from public, anon, authenticated;
grant execute on function public.platform_db_size_bytes() to service_role;
grant execute on function public.platform_storage_usage_bytes() to service_role;
```

`security definer` porque `storage.objects` no es accesible por rol normal;
al ejecutarse con los privilegios del dueño de la función (postgres), la
función sí puede leerla. El `revoke`/`grant` asegura que solo `service_role`
(el cliente admin de `/superadmin`) pueda invocarlas — ni `anon` ni
`authenticated` (usuarios normales de cualquier org) tienen acceso.

### 2. `lib/superadmin.ts` (o archivo nuevo `lib/platformUsage.ts`)

```typescript
export interface PlatformUsage {
  dbBytes: number;
  storageBytes: number;
  dbLimitBytes: number;
  storageLimitBytes: number;
}

export async function getPlatformUsage(
  admin: SupabaseClient,
): Promise<PlatformUsage> {
  const [{ data: dbBytes }, { data: storageBytes }] = await Promise.all([
    admin.rpc("platform_db_size_bytes"),
    admin.rpc("platform_storage_usage_bytes"),
  ]);
  const dbLimitMb = Number(process.env.SUPABASE_FREE_DB_LIMIT_MB ?? 500);
  const storageLimitMb = Number(process.env.SUPABASE_FREE_STORAGE_LIMIT_MB ?? 1024);
  return {
    dbBytes: dbBytes ?? 0,
    storageBytes: storageBytes ?? 0,
    dbLimitBytes: dbLimitMb * 1024 * 1024,
    storageLimitBytes: storageLimitMb * 1024 * 1024,
  };
}
```

Límites configurables vía env var (`SUPABASE_FREE_DB_LIMIT_MB`,
`SUPABASE_FREE_STORAGE_LIMIT_MB`), default 500 MB / 1024 MB (valores
actuales del plan Free de Supabase). Se documentan en `.env.example` como
opcionales.

### 3. `app/(dashboard)/superadmin/page.tsx`

Se agrega la llamada a `getPlatformUsage(admin)` (mismo `admin` ya creado
con `createAdminClient()`) y se renderiza `<UsagePanel usage={usage} />`
arriba del listado de organizaciones existente. No cambia nada del resto
de la página.

### 4. `components/superadmin/UsagePanel.tsx` (nuevo, server component)

Card con dos barras de progreso (DB, Storage), cada una mostrando:
- Label ("Base de datos" / "Storage")
- `usado / límite` en unidad legible (MB o GB según magnitud)
- Barra de progreso con color según % usado:
  - `< 70%` → verde
  - `70–90%` → amarillo
  - `> 90%` → rojo

```typescript
export function UsagePanel({ usage }: { usage: PlatformUsage }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <UsageBar label="Base de datos" used={usage.dbBytes} limit={usage.dbLimitBytes} />
      <UsageBar label="Storage" used={usage.storageBytes} limit={usage.storageLimitBytes} />
    </div>
  );
}
```

`UsageBar` es un sub-componente interno del mismo archivo (no amerita
archivo propio): calcula el %, formatea bytes a MB/GB, y aplica la clase de
color según el umbral.

## Fuera de alcance

- Egress, MAU, Edge Functions — no se miden.
- Management API / Personal Access Token — no se usa.
- Caché, cron, histórico de tendencia — no en esta iteración.
- Alertas (email/webhook) al acercarse al límite — no en esta iteración.
- Desglose por organización de cuánto storage/DB consume cada una — el
  panel es a nivel de plataforma completa, no por org.
