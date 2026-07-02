# Usuarios module + per-user permissions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move team management into a new `/usuarios` page and let the admin
restrict, per individual user, which modules that user can see in the
sidebar — on top of (never beyond) what their role already allows.

**Architecture:** Adds a nullable `allowed_modules jsonb` column to
`profiles` (mirrors the existing `organizations.features` pattern). `null`
means "no override, use the role's whitelist as-is" (current behavior,
zero-impact for existing users). A non-null array is intersected with
`NAV_WHITELIST[role]` inside `canSeeNav`, so it can only narrow access, never
widen it. Team management (`TeamPanel`) moves from `/ajustes` to a new
admin-only `/usuarios` page, gaining a "Permisos" button per user that opens
a checkbox modal. Five reserved module keys from the legacy system
(`traspasos`, `devoluciones`, `reporte_productos`, `reporte_ventas`,
`tasa_cambio`) are addable in the checkbox list even though their pages
don't exist yet — they have no `href`/menu entry until built.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (Postgres),
TypeScript, Zod, Tailwind, Vitest.

## Global Constraints

- Spanish UI copy, no "voseo" ("puedes", not "podés").
- Server actions: validate with Zod, check `profile.role` / `can()` from
  `lib/rbac.ts`, take `org_id` from `getProfile()` — never trust a
  client-supplied `org_id`. Every DB write scoped with
  `.eq("org_id", profile.orgId)`.
- Reuse existing UI primitives (`Button`, `Field`, `Modal`, `Card`,
  `PageHeader`, `fieldInputClass`) — do not introduce new styling
  primitives.
- The override can only **restrict** visibility, never grant a module the
  role/org wouldn't already allow (intersection, not union).
- Admin cannot edit their own permissions (same rule as "cannot deactivate
  your own account" in the existing `setUserActive`).
- Spec: `docs/superpowers/specs/2026-07-01-usuarios-permisos-design.md`

---

## Task 1: Database migration — `allowed_modules` column

**Files:**
- Create: `supabase/migrations/0006_user_module_permissions.sql`

**Interfaces:**
- Consumes: `profiles` table from `supabase/migrations/0001_init.sql`.
- Produces: `profiles.allowed_modules` (nullable `jsonb`), read/written by
  every later task.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Permisos de módulo por usuario (override de visibilidad sobre el rol).
-- Ver docs/superpowers/specs/2026-07-01-usuarios-permisos-design.md
-- ============================================================================

alter table profiles
  add column allowed_modules jsonb null;

comment on column profiles.allowed_modules is
  'null = usa el whitelist de módulos del rol tal cual. Array de FeatureKey/ReservedFeatureKey = restringe la visibilidad de módulos para este usuario, siempre intersectado con lo que su rol y los feature flags de la organización ya permiten.';
```

- [ ] **Step 2: Apply the migration locally and verify**

Run: `npm run db:start` (if not already running), then `npm run db:reset`
Expected: output ends with `Finished supabase db reset` with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_user_module_permissions.sql
git commit -m "feat(db): add allowed_modules column to profiles"
```

---

## Task 2: `lib/features.ts` — reserved modules + assignable list + `usuarios` feature

**Files:**
- Modify: `lib/features.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `FeatureKey` (gains `"usuarios"`), `ReservedFeatureKey`,
  `AssignableModuleKey`, `RESERVED_FEATURES`, `ASSIGNABLE_MODULES` — used by
  `lib/rbac.ts`, `lib/auth.ts`, `lib/guard.ts`, `app/(dashboard)/layout.tsx`,
  `app/(dashboard)/usuarios/actions.ts`, `PermissionsModal`.

- [ ] **Step 1: Replace `lib/features.ts`**

```ts
// Catálogo de módulos toggleables por organización (feature flags / addons).

export type FeatureKey =
  | "dashboard"
  | "clientes"
  | "items"
  | "productos"
  | "proveedores"
  | "ventas"
  | "ajuste_inventario"
  | "movimientos_producto"
  | "usuarios"
  | "ajustes"
  | "auditoria";

export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  href: string;
  /** Núcleo: no se puede apagar desde el panel (dejaría la cuenta inoperable). */
  core?: boolean;
  /** Opt-in: apagado por defecto salvo que se habilite explícitamente. */
  optIn?: boolean;
}

// Orden = orden en el menú lateral.
export const FEATURES: FeatureMeta[] = [
  { key: "dashboard", label: "Inicio", href: "/dashboard", core: true },
  { key: "clientes", label: "Clientes", href: "/clientes" },
  { key: "items", label: "Inventario", href: "/items", optIn: true },
  { key: "productos", label: "Productos", href: "/productos", optIn: true },
  { key: "proveedores", label: "Proveedores", href: "/proveedores", optIn: true },
  { key: "ventas", label: "Ventas", href: "/ventas", optIn: true },
  { key: "ajuste_inventario", label: "Ajuste de Inventario", href: "/ajuste-inventario", optIn: true },
  { key: "movimientos_producto", label: "Movimientos de Producto", href: "/movimientos-producto", optIn: true },
  { key: "usuarios", label: "Usuarios", href: "/usuarios", core: true },
  { key: "ajustes", label: "Ajustes", href: "/ajustes", core: true },
  { key: "auditoria", label: "Auditoría", href: "/auditoria", optIn: true },
];

export type Features = Record<FeatureKey, boolean>;

export function normalizeFeatures(raw: unknown): Features {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Features;
  for (const f of FEATURES) {
    if (f.core) {
      out[f.key] = true;
    } else if (f.optIn) {
      out[f.key] = obj[f.key] === true;
    } else {
      out[f.key] = obj[f.key] !== false;
    }
  }
  return out;
}

export function isEnabled(features: Features, key: FeatureKey): boolean {
  return features[key];
}

// ── Módulos "reservados": existían en el sistema legado de referencia pero
// todavía no tienen página construida en este proyecto. No entran en FEATURES
// (no tienen href / entrada de menú); solo existen para que el admin pueda
// dejarlos pre-marcados o desmarcados por usuario desde /usuarios, listos
// para cuando se construyan.
export type ReservedFeatureKey =
  | "traspasos"
  | "devoluciones"
  | "reporte_productos"
  | "reporte_ventas"
  | "tasa_cambio";

export interface ReservedFeatureMeta {
  key: ReservedFeatureKey;
  label: string;
}

export const RESERVED_FEATURES: ReservedFeatureMeta[] = [
  { key: "traspasos", label: "Traspasos" },
  { key: "devoluciones", label: "Devoluciones" },
  { key: "reporte_productos", label: "Reporte Producto" },
  { key: "reporte_ventas", label: "Reporte Ventas" },
  { key: "tasa_cambio", label: "Tasa Cambio" },
];

// Todo lo que puede guardarse en profiles.allowed_modules.
export type AssignableModuleKey = FeatureKey | ReservedFeatureKey;

// Módulos que aparecen como checkbox en el modal de permisos de /usuarios:
// los módulos no-core (los core siempre están disponibles para el rol que
// los ve) + los reservados del sistema legado.
export const ASSIGNABLE_MODULES: { key: AssignableModuleKey; label: string }[] = [
  ...FEATURES.filter((f) => !f.core).map((f) => ({ key: f.key as AssignableModuleKey, label: f.label })),
  ...RESERVED_FEATURES,
];
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/features.ts
git commit -m "feat: add usuarios feature and reserved module keys"
```

---

## Task 3: `lib/rbac.ts` — per-user module override in `canSeeNav`

**Files:**
- Modify: `lib/rbac.ts`
- Create: `lib/rbac.test.ts`

**Interfaces:**
- Consumes: `AssignableModuleKey` from `lib/features.ts` (Task 2).
- Produces: `canSeeNav(role, key, allowedModules?)` — new third parameter,
  consumed by `lib/guard.ts` (Task 4) and `app/(dashboard)/layout.tsx`
  (Task 5).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { canSeeNav } from "./rbac";

describe("canSeeNav", () => {
  it("allows a module in the role's whitelist when there is no override", () => {
    expect(canSeeNav("admin", "productos")).toBe(true);
  });

  it("allows a module in the role's whitelist when the override is null", () => {
    expect(canSeeNav("admin", "productos", null)).toBe(true);
  });

  it("denies a module outside the role's whitelist even if the override includes it", () => {
    expect(canSeeNav("viewer", "ventas", ["ventas"])).toBe(false);
  });

  it("denies a module allowed by the role but excluded by the override", () => {
    expect(canSeeNav("admin", "productos", ["dashboard"])).toBe(false);
  });

  it("allows a module allowed by both the role and the override", () => {
    expect(canSeeNav("member", "productos", ["productos", "dashboard"])).toBe(true);
  });

  it("returns false without a role", () => {
    expect(canSeeNav(undefined, "dashboard")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/rbac.test.ts`
Expected: FAIL — `canSeeNav` does not accept a third argument / some
assertions fail (current implementation ignores overrides entirely).

- [ ] **Step 3: Update `canSeeNav` in `lib/rbac.ts`**

Replace the existing `canSeeNav` function (lines 32-35) with:

```ts
import type { AssignableModuleKey, FeatureKey } from "@/lib/features";

export function canSeeNav(
  role: Role | undefined,
  key: FeatureKey,
  allowedModules?: AssignableModuleKey[] | null,
): boolean {
  if (!role) return false;
  if (!NAV_WHITELIST[role]?.includes(key)) return false;
  if (allowedModules == null) return true;
  return allowedModules.includes(key);
}
```

Also add `"usuarios"` to the admin entry of `NAV_WHITELIST` (top of the
file):

```ts
const NAV_WHITELIST: Record<Role, FeatureKey[]> = {
  admin: [
    "dashboard",
    "clientes",
    "items",
    "productos",
    "proveedores",
    "ventas",
    "ajuste_inventario",
    "movimientos_producto",
    "usuarios",
    "ajustes",
    "auditoria",
  ],
  manager: [
    "dashboard",
    "clientes",
    "items",
    "productos",
    "proveedores",
    "ventas",
    "ajuste_inventario",
  ],
  member: ["dashboard", "clientes", "productos", "proveedores", "ventas"],
  viewer: ["dashboard", "clientes", "productos", "proveedores"],
};
```

`movimientos_producto` is added to the admin row as part of this change (it
was missing before, an existing gap — admin couldn't see that module in the
menu). `manager`/`member`/`viewer` rows are unchanged from before.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/rbac.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/rbac.ts lib/rbac.test.ts
git commit -m "feat: add per-user module override to canSeeNav"
```

---

## Task 4: Thread `allowedModules` through `lib/auth.ts` and `lib/guard.ts`

**Files:**
- Modify: `lib/auth.ts`
- Modify: `lib/guard.ts`

**Interfaces:**
- Consumes: `canSeeNav(role, key, allowedModules?)` from Task 3;
  `AssignableModuleKey` from Task 2.
- Produces: `CurrentProfile.allowedModules: AssignableModuleKey[] | null`,
  consumed by `app/(dashboard)/layout.tsx` (Task 5) and any future
  `requireNavAccess` caller.

- [ ] **Step 1: Replace `lib/auth.ts`**

```ts
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/rbac";
import type { AssignableModuleKey } from "@/lib/features";

export interface CurrentProfile {
  userId: string;
  orgId: string;
  role: Role;
  fullName: string;
  branchId: string | null;
  allowedModules: AssignableModuleKey[] | null;
}

// Perfil del usuario autenticado (org_id + rol + sucursal). Cacheado por request.
// RLS sigue siendo la fuente de verdad; esto sirve para gates de UI y para
// rellenar org_id/branch_id en inserts (defensa en profundidad).
export const getProfile = cache(async (): Promise<CurrentProfile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role, full_name, branch_id, allowed_modules")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  return {
    userId: user.id,
    orgId: profile.org_id,
    role: profile.role as Role,
    fullName: profile.full_name,
    branchId: profile.branch_id,
    allowedModules: (profile.allowed_modules as AssignableModuleKey[] | null) ?? null,
  };
});
```

- [ ] **Step 2: Replace `lib/guard.ts`**

```ts
import { redirect } from "next/navigation";
import { getOrgFeatures } from "@/lib/superadmin";
import type { FeatureKey } from "@/lib/features";
import { getProfile } from "@/lib/auth";
import { canSeeNav } from "@/lib/rbac";

// Bloquea el acceso directo (por URL) a un módulo apagado para la organización.
// El menú ya lo oculta; esto cierra la puerta de entrar a mano a /items, etc.
export async function requireFeature(key: FeatureKey) {
  const features = await getOrgFeatures();
  if (!features[key]) redirect("/dashboard");
}

// Verifica feature habilitada Y que el rol/override del usuario pueda ver ese módulo.
// Usar en lugar de requireFeature() para módulos con restricción por rol.
export async function requireNavAccess(key: FeatureKey) {
  const [features, profile] = await Promise.all([getOrgFeatures(), getProfile()]);
  if (!features[key] || !canSeeNav(profile?.role, key, profile?.allowedModules)) {
    redirect("/dashboard");
  }
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts lib/guard.ts
git commit -m "feat: thread allowedModules through profile and nav guard"
```

---

## Task 5: Wire the override into the sidebar menu

**Files:**
- Modify: `app/(dashboard)/layout.tsx`
- Modify: `components/Sidebar.tsx`

**Interfaces:**
- Consumes: `canSeeNav` (Task 3), `CurrentProfile` shape is NOT used here
  (layout queries Supabase directly, not via `getProfile()`) — it reads
  `allowed_modules` straight from its own query.

- [ ] **Step 1: Update the profile query and `canSeeNav` call in `app/(dashboard)/layout.tsx`**

Change the `.select(...)` call (around line 26) from:

```ts
    .select(
      "full_name, role, active, terms_accepted_at, terms_accepted_version, organizations(name, features, active)",
    )
```

to:

```ts
    .select(
      "full_name, role, active, terms_accepted_at, terms_accepted_version, allowed_modules, organizations(name, features, active)",
    )
```

Add the import at the top of the file:

```ts
import type { AssignableModuleKey } from "@/lib/features";
```

Replace the `nav` computation block (around line 96-105) from:

```ts
  // Menú = módulos encendidos de la organización Y permitidos para el rol.
  const features = normalizeFeatures(org?.features);
  const role = profile?.role as Role | undefined;

  const nav =
    superadmin && !isPreview
      ? []
      : FEATURES.filter((f) => features[f.key] && canSeeNav(role, f.key)).map(
          (f) => ({ href: f.href, label: f.label }),
        );
```

to:

```ts
  // Menú = módulos encendidos de la organización Y permitidos para el rol Y
  // (si existe) el override de visibilidad del usuario.
  const features = normalizeFeatures(org?.features);
  const role = profile?.role as Role | undefined;
  const allowedModules =
    (profile as { allowed_modules?: AssignableModuleKey[] | null } | null)
      ?.allowed_modules ?? null;

  const nav =
    superadmin && !isPreview
      ? []
      : FEATURES.filter(
          (f) => features[f.key] && canSeeNav(role, f.key, allowedModules),
        ).map((f) => ({ href: f.href, label: f.label }));
```

- [ ] **Step 2: Add a sidebar icon for `/usuarios`**

In `components/Sidebar.tsx`, add `UserCog` to the `lucide-react` import
(line 5-18) and map it in `ICONS` (line 26-35):

```ts
import {
  Home,
  Users,
  Package,
  Settings,
  ShieldCheck,
  Shield,
  Wrench,
  Truck,
  History,
  UserCog,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
```

```ts
const ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/clientes": Users,
  "/items": Package,
  "/productos": Wrench,
  "/proveedores": Truck,
  "/ajuste-inventario": History,
  "/usuarios": UserCog,
  "/ajustes": Settings,
  "/auditoria": ShieldCheck,
};
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/layout.tsx" components/Sidebar.tsx
git commit -m "feat: apply per-user module override to the sidebar menu"
```

---

## Task 6: `/usuarios` page — move team management, add permissions modal

**Files:**
- Create: `app/(dashboard)/usuarios/page.tsx`
- Create: `app/(dashboard)/usuarios/actions.ts`
- Create: `components/usuarios/TeamPanel.tsx`
- Create: `components/usuarios/PermissionsModal.tsx`
- Modify: `app/(dashboard)/ajustes/page.tsx`
- Modify: `app/(dashboard)/ajustes/actions.ts`
- Delete: `components/ajustes/TeamPanel.tsx`

**Interfaces:**
- Consumes: `ASSIGNABLE_MODULES`, `AssignableModuleKey` (Task 2); `getProfile`
  (Task 4); `Modal`, `Button`, `Field`, `FieldLabel`, `fieldInputClass`,
  `Card`, `Badge`, `PageHeader` (existing `components/ui/*`); `toast`
  (`lib/toast`); `confirm` (`lib/confirm`); `inviteOrgUser` (`lib/inviteUser`).
- Produces: `setUserModules(userId, modules)` server action, consumed only by
  `PermissionsModal`.

- [ ] **Step 1: Create `app/(dashboard)/usuarios/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteOrgUser } from "@/lib/inviteUser";
import type { Role } from "@/lib/rbac";
import { ASSIGNABLE_MODULES, type AssignableModuleKey } from "@/lib/features";

const inviteSchema = z.object({
  email: z.string().trim().email("Correo inválido."),
  fullName: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  role: z.enum(["admin", "manager", "member", "viewer"]),
  branchId: z.string().trim().optional(),
});

export type ActionResult = { ok: boolean; error?: string };

// Invita a un nuevo usuario a la organización del admin actual. Usa el cliente
// service-role (createAdminClient) SOLO tras verificar que el llamante es admin
// de su organización; el org_id se toma del perfil, nunca del formulario.
export async function inviteTeamUser(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede invitar usuarios." };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
    branchId: formData.get("branchId") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const admin = createAdminClient();
  const res = await inviteOrgUser(admin, {
    email: parsed.data.email,
    fullName: parsed.data.fullName,
    orgId: profile.orgId,
    role: parsed.data.role as Role,
    branchId: parsed.data.branchId || null,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/usuarios");
  return { ok: true };
}

// Activa/desactiva a un usuario de la organización (soft, reversible). No libera
// el cupo de Supabase; para eso habría que borrar la cuenta de auth.
export async function setUserActive(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede gestionar usuarios." };
  }
  if (userId === profile.userId) {
    return { ok: false, error: "No puedes desactivar tu propia cuenta." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ active })
    .eq("id", userId)
    .eq("org_id", profile.orgId); // candado: solo dentro de su organización
  if (error) {
    console.error("setUserActive:", error.message);
    return { ok: false, error: "No se pudo actualizar el usuario." };
  }

  revalidatePath("/usuarios");
  return { ok: true };
}

// Asigna (o quita) la sucursal fija de un vendedor. Solo el admin, y solo
// dentro de su propia organización.
export async function setUserBranch(
  userId: string,
  branchId: string | null,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede asignar sucursales." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ branch_id: branchId })
    .eq("id", userId)
    .eq("org_id", profile.orgId);
  if (error) {
    console.error("setUserBranch:", error.message);
    return { ok: false, error: "No se pudo actualizar la sucursal del usuario." };
  }

  revalidatePath("/usuarios");
  return { ok: true };
}

const ASSIGNABLE_KEY_SET = new Set(ASSIGNABLE_MODULES.map((m) => m.key));

const modulesSchema = z
  .array(z.string())
  .nullable()
  .refine(
    (arr) => arr === null || arr.every((k) => ASSIGNABLE_KEY_SET.has(k as AssignableModuleKey)),
    { message: "Módulo inválido." },
  );

// Guarda el override de módulos visibles de un usuario. `null` = sin override
// (el usuario vuelve a ver todo lo que su rol permite). El admin no puede
// editar sus propios permisos (evita que se bloquee a sí mismo el acceso).
export async function setUserModules(
  userId: string,
  modules: AssignableModuleKey[] | null,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Solo el administrador puede asignar permisos." };
  }
  if (userId === profile.userId) {
    return { ok: false, error: "No puedes editar tus propios permisos." };
  }

  const parsed = modulesSchema.safeParse(modules);
  if (!parsed.success) {
    return { ok: false, error: "Lista de módulos inválida." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ allowed_modules: parsed.data })
    .eq("id", userId)
    .eq("org_id", profile.orgId);
  if (error) {
    console.error("setUserModules:", error.message);
    return { ok: false, error: "No se pudo actualizar los permisos." };
  }

  revalidatePath("/usuarios");
  return { ok: true };
}
```

- [ ] **Step 2: Create `components/usuarios/PermissionsModal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import { ASSIGNABLE_MODULES, type AssignableModuleKey } from "@/lib/features";
import { setUserModules } from "@/app/(dashboard)/usuarios/actions";
import type { TeamMember } from "@/components/usuarios/TeamPanel";

const ALL_KEYS = ASSIGNABLE_MODULES.map((m) => m.key);

export function PermissionsModal({
  member,
  onClose,
}: {
  member: TeamMember | null;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<AssignableModuleKey>>(
    new Set(ALL_KEYS),
  );
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  // Recarga el set marcado cada vez que se abre el modal para un usuario distinto.
  useEffect(() => {
    if (!member) return;
    setSelected(new Set(member.allowed_modules ?? ALL_KEYS));
  }, [member]);

  function toggle(key: AssignableModuleKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!member) return;
    setSaving(true);
    // Todo marcado = sin override (equivale a null: el usuario vuelve a
    // seguir el whitelist de su rol tal cual).
    const allChecked = selected.size === ALL_KEYS.length;
    const res = await setUserModules(
      member.id,
      allChecked ? null : Array.from(selected),
    );
    setSaving(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar los permisos.", "error");
      return;
    }
    toast("Permisos actualizados.");
    router.refresh();
    onClose();
  }

  return (
    <Modal
      open={!!member}
      onClose={onClose}
      title="Asignar permisos"
      subtitle={member?.full_name}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {ASSIGNABLE_MODULES.map((mod) => (
          <label
            key={mod.key}
            className="flex items-center gap-2 text-sm text-slate-700"
          >
            <input
              type="checkbox"
              checked={selected.has(mod.key)}
              onChange={() => toggle(mod.key)}
              className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
            />
            {mod.label}
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Create `components/usuarios/TeamPanel.tsx`**

Moved from `components/ajustes/TeamPanel.tsx`, with `allowed_modules` added
to `TeamMember`, a "Permisos" button per row, and the modal wired in.

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/lib/toast";
import { confirm } from "@/lib/confirm";
import type { AssignableModuleKey } from "@/lib/features";
import { inviteTeamUser, setUserActive, setUserBranch } from "@/app/(dashboard)/usuarios/actions";
import { PermissionsModal } from "@/components/usuarios/PermissionsModal";

export type TeamMember = {
  id: string;
  full_name: string;
  role: string;
  active: boolean;
  branch_id: string | null;
  allowed_modules: AssignableModuleKey[] | null;
};

type BranchOption = { id: string; name: string };

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  manager: "Gerente",
  member: "Miembro",
  viewer: "Lectura",
};

export function TeamPanel({
  members,
  currentUserId,
  branches,
}: {
  members: TeamMember[];
  currentUserId: string;
  branches: BranchOption[];
}) {
  const [loading, setLoading] = useState(false);
  const [permissionsFor, setPermissionsFor] = useState<TeamMember | null>(null);
  const router = useRouter();

  async function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = e.currentTarget;
    const res = await inviteTeamUser(new FormData(form));
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo invitar.", "error");
      return;
    }
    toast("Invitación enviada por correo.");
    form.reset();
    router.refresh();
  }

  async function onToggle(m: TeamMember) {
    const ok = await confirm({
      title: m.active ? "Desactivar usuario" : "Reactivar usuario",
      message: m.active
        ? `${m.full_name} no podrá ingresar hasta reactivarlo.`
        : `${m.full_name} podrá volver a ingresar.`,
      tone: m.active ? "danger" : "default",
    });
    if (!ok) return;
    const res = await setUserActive(m.id, !m.active);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar.", "error");
      return;
    }
    toast("Usuario actualizado.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="font-semibold text-slate-800">Invitar usuario</h2>
        <p className="mt-1 text-sm text-slate-500">
          Recibirá un correo para definir su contraseña y activar su cuenta.
        </p>
        <form onSubmit={onInvite} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Nombre completo" name="fullName" required />
          <Field label="Correo" name="email" type="email" required />
          <label className="block text-sm">
            <FieldLabel>Rol</FieldLabel>
            <select name="role" className={fieldInputClass} defaultValue="member">
              <option value="admin">Administrador</option>
              <option value="manager">Gerente</option>
              <option value="member">Miembro</option>
              <option value="viewer">Lectura</option>
            </select>
          </label>
          <label className="block text-sm">
            <FieldLabel>Sucursal (opcional)</FieldLabel>
            <select name="branchId" className={fieldInputClass} defaultValue="">
              <option value="">— Sin asignar —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Enviando…" : "Enviar invitación"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <ul className="divide-y divide-slate-200">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">
                  {m.full_name}
                  {m.id === currentUserId && (
                    <span className="ml-2 text-xs text-slate-400">(tú)</span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {ROLE_LABEL[m.role] ?? m.role}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <MemberBranchEditor member={m} branches={branches} />
                {!m.active && <Badge tone="danger">Inactivo</Badge>}
                {m.id !== currentUserId && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setPermissionsFor(m)}
                    >
                      Permisos
                    </Button>
                    <Button
                      size="sm"
                      variant={m.active ? "danger" : "secondary"}
                      onClick={() => onToggle(m)}
                    >
                      {m.active ? "Desactivar" : "Reactivar"}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <PermissionsModal
        member={permissionsFor}
        onClose={() => setPermissionsFor(null)}
      />
    </div>
  );
}

function MemberBranchEditor({
  member,
  branches,
}: {
  member: TeamMember;
  branches: BranchOption[];
}) {
  const [branchId, setBranchId] = useState(member.branch_id ?? "");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save() {
    setSaving(true);
    const res = await setUserBranch(member.id, branchId || null);
    setSaving(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar la sucursal.", "error");
      return;
    }
    toast("Sucursal actualizada.");
    router.refresh();
  }

  const changed = branchId !== (member.branch_id ?? "");

  return (
    <div className="flex items-center gap-2">
      <select
        value={branchId}
        onChange={(e) => setBranchId(e.target.value)}
        className={`${fieldInputClass} w-40`}
      >
        <option value="">— Sin asignar —</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {changed && (
        <Button size="sm" variant="secondary" disabled={saving} onClick={save}>
          Guardar
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Delete `components/ajustes/TeamPanel.tsx`**

```bash
git rm components/ajustes/TeamPanel.tsx
```

- [ ] **Step 5: Create `app/(dashboard)/usuarios/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { TeamPanel, type TeamMember } from "@/components/usuarios/TeamPanel";

// Gestión de equipo + permisos por módulo (solo admin).
export default async function UsuariosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: membersData }, { data: branchesData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, active, branch_id, allowed_modules")
      .eq("org_id", profile.orgId)
      .order("full_name"),
    supabase.from("branches").select("id, name").order("name"),
  ]);
  const members = (membersData ?? []) as TeamMember[];
  const branches = (branchesData ?? []) as { id: string; name: string }[];

  return (
    <div className="space-y-6">
      <PageHeader title="Usuarios" subtitle="Equipo de la organización y permisos" />
      <TeamPanel members={members} currentUserId={profile.userId} branches={branches} />
    </div>
  );
}
```

- [ ] **Step 6: Trim `app/(dashboard)/ajustes/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/PageHeader";
import { SimpleCatalogManager } from "@/components/ui/SimpleCatalogManager";
import { createBranch, deleteBranch } from "@/app/(dashboard)/ajustes/actions";

// Ajustes de la organización: sucursales (solo admin). La gestión de equipo
// y permisos vive en /usuarios.
export default async function AjustesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const { data: branchesData } = await supabase
    .from("branches")
    .select("id, name")
    .order("name");
  const branches = (branchesData ?? []) as { id: string; name: string }[];

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" subtitle="Configuración de la organización" />
      <div>
        <h2 className="mb-3 font-semibold text-slate-800">Sucursales</h2>
        <SimpleCatalogManager
          itemLabel="sucursal"
          emptyLabel="Aún no hay sucursales"
          items={branches}
          canWrite={can(profile.role, "sucursales:write")}
          onCreate={createBranch}
          onDelete={deleteBranch}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Trim `app/(dashboard)/ajustes/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { insertCatalogEntry, deleteCatalogEntry, catalogNameSchema } from "@/lib/catalogs";
import { can } from "@/lib/rbac";

export type ActionResult = { ok: boolean; error?: string };

// Crea una sucursal de la organización.
export async function createBranch(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "sucursales:write")) {
    return { ok: false, error: "No tienes permiso para crear sucursales." };
  }
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("branches", profile.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/ajustes");
  return { ok: true };
}

// Elimina una sucursal de la organización.
export async function deleteBranch(id: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "sucursales:write")) {
    return { ok: false, error: "No tienes permiso para eliminar sucursales." };
  }
  const res = await deleteCatalogEntry("branches", id);
  if (!res.ok) return res;
  revalidatePath("/ajustes");
  return { ok: true };
}
```

- [ ] **Step 8: Verify it typechecks and tests still pass**

Run: `npm run typecheck && npm test`
Expected: no type errors; all test files pass (including the new
`lib/rbac.test.ts`).

- [ ] **Step 9: Manual check**

1. `npm run dev`, log in as the admin test user
   (`admin@gmail.com` / `123`).
2. Confirm "Usuarios" appears in the sidebar (with the new icon) and
   "Ajustes" no longer shows the team list, only Sucursales.
3. On `/usuarios`, invite a second test user with role `member`.
4. Click "Permisos" on that member, uncheck "Productos", save. Confirm the
   toast says "Permisos actualizados."
5. Log in as that member (or use an incognito window) and confirm
   "Productos" no longer appears in their sidebar, while other member-level
   modules still do.
6. Navigate directly to `/productos` as that member and confirm it redirects
   to `/dashboard` (guard, not just hidden menu item).
7. As admin, reopen "Permisos" for that user, re-check "Productos" and every
   other box, save, and confirm the sidebar for that user goes back to the
   full member set.
8. Confirm the admin's own row has no "Permisos" button.

- [ ] **Step 10: Commit**

```bash
git add "app/(dashboard)/usuarios" "app/(dashboard)/ajustes/page.tsx" "app/(dashboard)/ajustes/actions.ts" components/usuarios
git commit -m "feat: add /usuarios page with per-user module permissions"
```
