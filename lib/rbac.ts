import type { FeatureKey } from "@/lib/features";

// Permisos por rol (espejo de las políticas RLS — la DB es la fuente de verdad).
// Roles genéricos de SaaS multi-tenant. Renómbralos/extiéndelos según tu dominio.
//   admin   → dueño de la organización: ve y gestiona todo.
//   manager → gestiona operación y datos, pero no usuarios ni configuración.
//   member  → opera sus propios datos.
//   viewer  → solo lectura.
export type Role = "admin" | "manager" | "member" | "viewer";

// Módulos del menú lateral visibles por rol.
const NAV_WHITELIST: Record<Role, FeatureKey[]> = {
  admin: ["dashboard", "clientes", "items", "ajustes", "auditoria"],
  manager: ["dashboard", "clientes", "items"],
  member: ["dashboard", "clientes"],
  viewer: ["dashboard", "clientes"],
};

export function canSeeNav(role: Role | undefined, key: FeatureKey): boolean {
  if (!role) return false;
  return NAV_WHITELIST[role]?.includes(key) ?? false;
}

type Permission =
  | "clientes:read"
  | "clientes:write"
  | "clientes:delete"
  | "items:write"
  | "settings:write"; // usuarios, roles, organización

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    "clientes:read",
    "clientes:write",
    "clientes:delete",
    "items:write",
    "settings:write",
  ],
  manager: ["clientes:read", "clientes:write", "items:write"],
  member: ["clientes:read", "clientes:write"],
  viewer: ["clientes:read"],
};

export function can(role: Role | undefined, perm: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(perm) ?? false;
}
