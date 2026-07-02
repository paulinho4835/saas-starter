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
  | "almacen"
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
  { key: "almacen", label: "Almacén", href: "/almacen", optIn: true },
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
