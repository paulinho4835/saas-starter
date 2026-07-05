import type { AssignableModuleKey, FeatureKey } from "@/lib/features";

// Permisos por rol (espejo de las políticas RLS — la DB es la fuente de verdad).
export type Role = "admin" | "manager" | "member" | "viewer";

// Módulos del menú lateral visibles por rol.
const NAV_WHITELIST: Record<Role, FeatureKey[]> = {
  // Orden y contenido = menú pedido por el cliente (replica su sistema
  // anterior). dashboard/clientes/items/almacen/pedidos/ajustes/auditoria
  // siguen existiendo (rutas y features intactas), solo ocultos del nav.
  admin: [
    "productos",
    "usuarios",
    "proveedores",
    "ventas",
    "ajuste_inventario",
    "traspasos",
    "devoluciones",
    "reporte_ventas",
    "movimientos_producto",
  ],
  manager: [
    "productos",
    "proveedores",
    "ventas",
    "ajuste_inventario",
    "traspasos",
    "devoluciones",
    "reporte_ventas",
    "movimientos_producto",
  ],
  member: ["dashboard", "clientes", "productos", "proveedores", "ventas"],
  viewer: ["dashboard", "clientes", "productos", "proveedores"],
};

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
  | "ventas:create"
  | "devoluciones:create"
  | "almacen:transfer"
  | "traspasos:create";

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
    "devoluciones:create",
    "almacen:transfer",
    "traspasos:create",
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
    "devoluciones:create",
    "traspasos:create",
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
