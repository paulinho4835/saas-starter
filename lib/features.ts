// Catálogo de módulos toggleables por organización (feature flags / addons).
// MISMO código para todos los clientes; cada organización enciende/apaga estos
// módulos vía organizations.features (columna jsonb). La fuente de verdad es el jsonb.
//
// Para agregar un módulo nuevo a tu SaaS: añade su clave aquí, dale entrada en
// FEATURES (orden = orden del menú), y permítelo por rol en lib/rbac.ts.

export type FeatureKey =
  | "dashboard"
  | "clientes"
  | "items"
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
  { key: "ajustes", label: "Ajustes", href: "/ajustes", core: true },
  { key: "auditoria", label: "Auditoría", href: "/auditoria", optIn: true },
];

export type Features = Record<FeatureKey, boolean>;

// Si una clave falta en el jsonb (cuenta vieja, módulo nuevo), se asume encendida
// para no romper cuentas existentes al agregar features (salvo las opt-in).
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
