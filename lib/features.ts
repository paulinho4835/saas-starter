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
  | "reporte_ventas"
  | "devoluciones"
  | "almacen"
  | "traspasos"
  | "pedidos"
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
  { key: "reporte_ventas", label: "Reporte de Ventas", href: "/reporte-ventas", optIn: true },
  { key: "devoluciones", label: "Devoluciones", href: "/devoluciones", optIn: true },
  { key: "almacen", label: "Almacén", href: "/almacen", optIn: true },
  { key: "traspasos", label: "Traspasos", href: "/traspasos", optIn: true },
  { key: "pedidos", label: "Pedidos", href: "/pedidos", optIn: true },
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

// -- Módulos "reservados": existían en el sistema legado de referencia pero
// todavía no tienen página construida en este proyecto. No entran en FEATURES
// (no tienen href / entrada de menú); solo existen para que el admin pueda
// dejarlos pre-marcados o desmarcados por usuario desde /usuarios, listos
// para cuando se construyan.
export type ReservedFeatureKey = "reporte_productos" | "tasa_cambio";

export interface ReservedFeatureMeta {
  key: ReservedFeatureKey;
  label: string;
}

export const RESERVED_FEATURES: ReservedFeatureMeta[] = [
  { key: "reporte_productos", label: "Reporte Producto" },
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
