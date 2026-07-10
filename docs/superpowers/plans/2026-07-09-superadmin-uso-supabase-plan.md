# Panel de Uso de Supabase en Superadmin — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en `/superadmin` cuánto espacio de DB y de Storage usa el
proyecto Supabase contra los límites del plan Free, calculado con SQL
directo (sin Management API ni PAT).

**Architecture:** Dos funciones Postgres `security definer` exponen
`pg_database_size()` y la suma de tamaños de `storage.objects`; una función
helper en `lib/platformUsage.ts` las invoca vía el cliente `service_role`
existente y las compara contra límites configurables por env var; un nuevo
componente `UsagePanel` las renderiza como barras de progreso en la página
`/superadmin` ya existente.

**Tech Stack:** Next.js App Router (Server Component), Supabase Postgres
(migración SQL + RPC), TypeScript, Vitest, Tailwind (clases `tone` ya
usadas en `components/ui/Badge.tsx`: `emerald`/`amber`/`red`).

## Global Constraints

- Solo dos métricas: tamaño de DB y tamaño de Storage. No egress, no MAU, no
  Edge Functions (spec, sección "Alcance confirmado").
- Sin Management API ni Personal Access Token — todo vía SQL directo contra
  el propio proyecto (spec, sección "Alcance confirmado").
- Sin caché ni cron: se recalcula en cada visita a `/superadmin` (spec,
  sección "Alcance confirmado").
- Las funciones RPC deben ser invocables solo por `service_role` — revocado
  de `anon`/`authenticated`/`public` (spec, sección 1).
- Límites configurables por env var `SUPABASE_FREE_DB_LIMIT_MB` /
  `SUPABASE_FREE_STORAGE_LIMIT_MB`, default `500` / `1024` (spec, sección 2).
- Umbrales de color de la barra: `< 70%` verde (`emerald`), `70–90%`
  amarillo (`amber`), `> 90%` rojo (`red`) (spec, sección 4).
- No se agrega desglose por organización, ni alertas, ni histórico (spec,
  sección "Fuera de alcance").

---

### Task 1: Migración SQL — funciones de uso de plataforma

**Files:**
- Create: `supabase/migrations/0019_platform_usage.sql`

**Interfaces:**
- Produces: función RPC `platform_db_size_bytes()` → `bigint`; función RPC
  `platform_storage_usage_bytes()` → `bigint`. Ambas invocables solo por
  `service_role`, vía `admin.rpc("platform_db_size_bytes")` /
  `admin.rpc("platform_storage_usage_bytes")` desde `@supabase/supabase-js`.

- [ ] **Step 1: Crear el archivo de migración con las dos funciones**

```sql
-- supabase/migrations/0019_platform_usage.sql
-- Panel de uso de Supabase en /superadmin: dos funciones de solo lectura
-- que exponen el tamaño real de DB y Storage (las mismas cifras que
-- Supabase usa para medir el plan Free), invocables solo por service_role.

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

- [ ] **Step 2: Aplicar la migración local**

Run: `npm run db:reset`
Expected: en la salida aparece `Applying migration 0019_platform_usage.sql...`
y termina con `Finished supabase db reset on branch master.` sin errores.

- [ ] **Step 3: Verificar las funciones en la DB local**

Run:
```bash
docker exec supabase_db_productos-sucursales-stock psql -U postgres -d postgres -c "select proname, prosecdef from pg_proc where proname like 'platform_%';"
```
Expected: dos filas, `platform_db_size_bytes` y `platform_storage_usage_bytes`,
ambas con `prosecdef = t` (security definer activo).

- [ ] **Step 4: Verificar que `anon` no puede ejecutar las funciones**

Run:
```bash
docker exec supabase_db_productos-sucursales-stock psql -U postgres -d postgres -c "select has_function_privilege('anon', 'public.platform_db_size_bytes()', 'execute');"
```
Expected: `f` (false) — confirma que el `revoke` aplicó correctamente.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0019_platform_usage.sql
git commit -m "feat: funciones SQL de uso de DB y Storage para superadmin"
```

---

### Task 2: Helper `getPlatformUsage` + tests

**Files:**
- Create: `lib/platformUsage.ts`
- Test: `lib/platformUsage.test.ts`
- Modify: `.env.example` (documentar las dos env vars nuevas)

**Interfaces:**
- Consumes: RPCs `platform_db_size_bytes` / `platform_storage_usage_bytes`
  de Task 1 (mismos nombres, sin argumentos, devuelven `number | null` vía
  supabase-js).
- Produces:
  ```typescript
  export interface PlatformUsage {
    dbBytes: number;
    storageBytes: number;
    dbLimitBytes: number;
    storageLimitBytes: number;
  }
  export function getPlatformUsage(
    admin: SupabaseClient,
  ): Promise<PlatformUsage>
  ```
  Consumido por Task 3 (`app/(dashboard)/superadmin/page.tsx`) y Task 4
  (`components/superadmin/UsagePanel.tsx`, que recibe `PlatformUsage` como
  prop `usage`).

- [ ] **Step 1: Escribir los tests (fallarán porque el archivo no existe)**

```typescript
// lib/platformUsage.test.ts
import { describe, expect, it, vi } from "vitest";
import { getPlatformUsage } from "./platformUsage";

function fakeAdmin(dbBytes: number | null, storageBytes: number | null) {
  return {
    rpc: vi.fn((fnName: string) => {
      if (fnName === "platform_db_size_bytes") {
        return Promise.resolve({ data: dbBytes, error: null });
      }
      if (fnName === "platform_storage_usage_bytes") {
        return Promise.resolve({ data: storageBytes, error: null });
      }
      throw new Error(`unexpected rpc: ${fnName}`);
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getPlatformUsage", () => {
  it("returns db/storage bytes from the RPCs and default limits in bytes", async () => {
    vi.stubEnv("SUPABASE_FREE_DB_LIMIT_MB", "");
    vi.stubEnv("SUPABASE_FREE_STORAGE_LIMIT_MB", "");
    const admin = fakeAdmin(104_857_600, 52_428_800); // 100 MB, 50 MB
    const usage = await getPlatformUsage(admin);
    expect(usage.dbBytes).toBe(104_857_600);
    expect(usage.storageBytes).toBe(52_428_800);
    expect(usage.dbLimitBytes).toBe(500 * 1024 * 1024);
    expect(usage.storageLimitBytes).toBe(1024 * 1024 * 1024);
    vi.unstubAllEnvs();
  });

  it("reads limits from env vars when set", async () => {
    vi.stubEnv("SUPABASE_FREE_DB_LIMIT_MB", "8000");
    vi.stubEnv("SUPABASE_FREE_STORAGE_LIMIT_MB", "100000");
    const admin = fakeAdmin(0, 0);
    const usage = await getPlatformUsage(admin);
    expect(usage.dbLimitBytes).toBe(8000 * 1024 * 1024);
    expect(usage.storageLimitBytes).toBe(100_000 * 1024 * 1024);
    vi.unstubAllEnvs();
  });

  it("treats null RPC results as zero usage", async () => {
    vi.stubEnv("SUPABASE_FREE_DB_LIMIT_MB", "");
    vi.stubEnv("SUPABASE_FREE_STORAGE_LIMIT_MB", "");
    const admin = fakeAdmin(null, null);
    const usage = await getPlatformUsage(admin);
    expect(usage.dbBytes).toBe(0);
    expect(usage.storageBytes).toBe(0);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npx vitest run lib/platformUsage.test.ts`
Expected: FAIL — `Cannot find module './platformUsage'`

- [ ] **Step 3: Implementar el helper**

```typescript
// lib/platformUsage.ts
import type { SupabaseClient } from "@supabase/supabase-js";

const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_DB_LIMIT_MB = 500;
const DEFAULT_STORAGE_LIMIT_MB = 1024;

export interface PlatformUsage {
  dbBytes: number;
  storageBytes: number;
  dbLimitBytes: number;
  storageLimitBytes: number;
}

function limitFromEnv(envVar: string | undefined, defaultMb: number): number {
  const parsed = Number(envVar);
  const mb = envVar && !Number.isNaN(parsed) && parsed > 0 ? parsed : defaultMb;
  return mb * BYTES_PER_MB;
}

export async function getPlatformUsage(
  admin: SupabaseClient,
): Promise<PlatformUsage> {
  const [dbResult, storageResult] = await Promise.all([
    admin.rpc("platform_db_size_bytes"),
    admin.rpc("platform_storage_usage_bytes"),
  ]);

  return {
    dbBytes: dbResult.data ?? 0,
    storageBytes: storageResult.data ?? 0,
    dbLimitBytes: limitFromEnv(process.env.SUPABASE_FREE_DB_LIMIT_MB, DEFAULT_DB_LIMIT_MB),
    storageLimitBytes: limitFromEnv(
      process.env.SUPABASE_FREE_STORAGE_LIMIT_MB,
      DEFAULT_STORAGE_LIMIT_MB,
    ),
  };
}
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `npx vitest run lib/platformUsage.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Documentar las env vars nuevas en `.env.example`**

Agregar, después del bloque `# ── Supabase (obligatorio) ─...` existente:

```
# ── Panel de uso Supabase en /superadmin (opcional) ──────────────────────────
# Límites del plan Free en MB, usados para calcular el % de uso en el panel.
# Default: 500 (DB) / 1024 (Storage) — valores actuales del plan Free.
SUPABASE_FREE_DB_LIMIT_MB=
SUPABASE_FREE_STORAGE_LIMIT_MB=
```

- [ ] **Step 6: Commit**

```bash
git add lib/platformUsage.ts lib/platformUsage.test.ts .env.example
git commit -m "feat: helper getPlatformUsage para medir uso de DB y Storage"
```

---

### Task 3: Componente `UsagePanel`

**Files:**
- Create: `components/superadmin/UsagePanel.tsx`

**Interfaces:**
- Consumes: `PlatformUsage` de Task 2 (`{ dbBytes, storageBytes,
  dbLimitBytes, storageLimitBytes }`), tipo `tone` de
  `components/ui/Badge.tsx` (valores `"success" | "warning" | "danger"` con
  clases `emerald`/`amber`/`red`, mismo patrón, no se importa Badge en sí).
- Produces: `export function UsagePanel({ usage }: { usage: PlatformUsage })`
  — Server Component, sin estado ni interactividad. Consumido por Task 4
  (`app/(dashboard)/superadmin/page.tsx`).

- [ ] **Step 1: Crear el componente**

```typescript
// components/superadmin/UsagePanel.tsx
import type { PlatformUsage } from "@/lib/platformUsage";
import { Card } from "@/components/ui/Card";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function barColor(pct: number): string {
  if (pct > 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">
          {formatBytes(used)} / {formatBytes(limit)} ({pct.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${barColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function UsagePanel({ usage }: { usage: PlatformUsage }) {
  return (
    <Card className="space-y-4 p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Uso de Supabase (plan Free)
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <UsageBar
          label="Base de datos"
          used={usage.dbBytes}
          limit={usage.dbLimitBytes}
        />
        <UsageBar
          label="Storage"
          used={usage.storageBytes}
          limit={usage.storageLimitBytes}
        />
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verificar que `components/ui/Card.tsx` existe con esa forma**

Run: `cat components/ui/Card.tsx` (o abrir el archivo)
Expected: exporta `Card` como componente que acepta `className` y `children`
vía `React.HTMLAttributes<HTMLDivElement>` (mismo patrón que
`components/ui/Badge.tsx`). Si el nombre real o las props difieren, ajustar
el import y el uso en el Step 1 antes de continuar — no hay tarea de test
para un componente puramente visual, así que esta verificación manual es la
única red de seguridad antes de Task 4.

- [ ] **Step 3: Commit**

```bash
git add components/superadmin/UsagePanel.tsx
git commit -m "feat: componente UsagePanel con barras de progreso DB/Storage"
```

---

### Task 4: Integrar en `/superadmin`

**Files:**
- Modify: `app/(dashboard)/superadmin/page.tsx`

**Interfaces:**
- Consumes: `getPlatformUsage(admin)` de Task 2, `<UsagePanel usage={...} />`
  de Task 3.

- [ ] **Step 1: Agregar el import y la llamada a `getPlatformUsage`**

Editar `app/(dashboard)/superadmin/page.tsx`. El archivo actual es:

```typescript
import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/superadmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewOrgForm } from "@/components/superadmin/NewOrgForm";
import { OrgCard, type OrgRow } from "@/components/superadmin/OrgCard";

// Panel del operador de la plataforma (dueño del SaaS): gestiona TODAS las
// organizaciones. Usa el cliente service-role tras verificar isPlatformAdmin.
export default async function SuperadminPage() {
  if (!(await isPlatformAdmin())) redirect("/dashboard");

  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("id, name, active, features")
    .order("name");
  const orgs = (data ?? []) as OrgRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Superadmin"
        subtitle={`${orgs.length} organizaciones`}
        action={<NewOrgForm />}
      />

      {orgs.length === 0 ? (
        <EmptyState
          title="Aún no hay organizaciones"
          description="Crea la primera para empezar."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {orgs.map((org) => (
            <OrgCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  );
}
```

Reemplazar por:

```typescript
import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/superadmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformUsage } from "@/lib/platformUsage";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewOrgForm } from "@/components/superadmin/NewOrgForm";
import { OrgCard, type OrgRow } from "@/components/superadmin/OrgCard";
import { UsagePanel } from "@/components/superadmin/UsagePanel";

// Panel del operador de la plataforma (dueño del SaaS): gestiona TODAS las
// organizaciones. Usa el cliente service-role tras verificar isPlatformAdmin.
export default async function SuperadminPage() {
  if (!(await isPlatformAdmin())) redirect("/dashboard");

  const admin = createAdminClient();
  const [{ data }, usage] = await Promise.all([
    admin.from("organizations").select("id, name, active, features").order("name"),
    getPlatformUsage(admin),
  ]);
  const orgs = (data ?? []) as OrgRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Superadmin"
        subtitle={`${orgs.length} organizaciones`}
        action={<NewOrgForm />}
      />

      <UsagePanel usage={usage} />

      {orgs.length === 0 ? (
        <EmptyState
          title="Aún no hay organizaciones"
          description="Crea la primera para empezar."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {orgs.map((org) => (
            <OrgCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Levantar el servidor de desarrollo y verificar visualmente**

Run: `npm run dev`, luego navegar a `http://localhost:3000/superadmin`
logueado como usuario en `platform_admins`.
Expected: arriba del listado de organizaciones aparece la card "Uso de
Supabase (plan Free)" con dos barras (Base de datos, Storage), cada una
mostrando `X MB / Y MB (Z%)` y color verde (uso bajo en un entorno local
recién reseteado).

- [ ] **Step 3: Correr la suite completa de tests**

Run: `npx vitest run`
Expected: todos los tests pasan, incluyendo los 3 nuevos de
`lib/platformUsage.test.ts` (Task 2).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/superadmin/page.tsx"
git commit -m "feat: mostrar uso de DB y Storage en el panel de superadmin"
```
