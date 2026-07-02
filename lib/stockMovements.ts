// lib/stockMovements.ts
// Tipos compartidos del ledger stock_movements. La escritura real vive en cada
// server action que toca stock (createProduct, updateProductStock,
// confirmProductImport, createSale, adjustStock) — este archivo solo evita
// repetir el union type y la etiqueta en español en cada uno de esos sitios.

export type MovementType =
  | "alta_inicial"
  | "importacion"
  | "ajuste_manual"
  | "venta"
  | "transferencia"
  | "devolucion";

export const MOVEMENT_TYPES: MovementType[] = [
  "alta_inicial",
  "importacion",
  "ajuste_manual",
  "venta",
  "transferencia",
  "devolucion",
];

const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  alta_inicial: "Alta inicial",
  importacion: "Importación",
  ajuste_manual: "Ajuste manual",
  venta: "Venta",
  transferencia: "Transferencia",
  devolucion: "Devolución",
};

export function movementTypeLabel(type: MovementType): string {
  return MOVEMENT_TYPE_LABEL[type];
}
