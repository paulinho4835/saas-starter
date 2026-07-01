import type { FeatureKey } from "@/lib/features";

// Permisos por rol (espejo de las políticas RLS — la DB es la fuente de verdad).
export type Role = "admin" | "manager" | "member" | "viewer";

// Módulos del menú lateral visibles por rol.
const NAV_WHITELIST: Record<Role, FeatureKey[]> = {
  admin: [
    "dashboard",
    "clientes",
    "items",
    "productos",
    "proveedores",
    "ventas",
    "ajustes",
    "auditoria",
  ],
  manager: ["dashboard", "clientes", "items", "productos", "proveedores", "ventas"],
  member: ["dashboard", "clientes", "productos", "proveedores", "ventas"],
  viewer: ["dashboard", "clientes", "productos", "proveedores"],
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
  | "settings:write"
  | "productos:read"
  | "productos:write"
  | "productos:delete"
  | "productos:import"
  | "catalogos:write"
  | "sucursales:write"
  | "proveedores:read"
  | "proveedores:write"
  | "ventas:create";

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    "clientes:read",
    "clientes:write",
    "clientes:delete",
    "items:write",
    "settings:write",
    "productos:read",
    "productos:write",
    "productos:delete",
    "productos:import",
    "catalogos:write",
    "sucursales:write",
    "proveedores:read",
    "proveedores:write",
    "ventas:create",
  ],
  manager: [
    "clientes:read",
    "clientes:write",
    "items:write",
    "productos:read",
    "productos:write",
    "productos:import",
    "catalogos:write",
    "proveedores:read",
    "proveedores:write",
    "ventas:create",
  ],
  member: [
    "clientes:read",
    "clientes:write",
    "productos:read",
    "proveedores:read",
    "ventas:create",
  ],
  viewer: ["clientes:read", "productos:read", "proveedores:read"],
};

export function can(role: Role | undefined, perm: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(perm) ?? false;
}
