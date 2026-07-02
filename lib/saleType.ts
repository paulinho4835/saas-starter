// Tipo de venta: elegido una vez por venta completa (no por línea), define
// qué columna de precio se usa en TODAS sus líneas y cómo se clasifica para
// el filtro de pago del Dashboard. Ver
// docs/superpowers/specs/2026-07-02-tipos-venta-design.md

export type SaleType =
  | "sin_factura"
  | "con_factura"
  | "sin_factura_qr"
  | "con_factura_qr"
  | "mayorista";

export const SALE_TYPES: SaleType[] = [
  "sin_factura",
  "con_factura",
  "sin_factura_qr",
  "con_factura_qr",
  "mayorista",
];

export const SALE_TYPE_LABEL: Record<SaleType, string> = {
  sin_factura: "Sin Factura",
  con_factura: "Con Factura",
  sin_factura_qr: "Sin Factura QR",
  con_factura_qr: "Con Factura QR",
  mayorista: "Mayorista",
};

const PRICE_TIER_BY_SALE_TYPE: Record<SaleType, "sf" | "cf" | "may"> = {
  sin_factura: "sf",
  sin_factura_qr: "sf",
  con_factura: "cf",
  con_factura_qr: "cf",
  mayorista: "may",
};

export function priceTierForSaleType(type: SaleType): "sf" | "cf" | "may" {
  return PRICE_TIER_BY_SALE_TYPE[type];
}

const QR_TYPES: SaleType[] = ["sin_factura_qr", "con_factura_qr"];

export function paymentMethodForSaleType(type: SaleType): "efectivo" | "qr" {
  return QR_TYPES.includes(type) ? "qr" : "efectivo";
}
