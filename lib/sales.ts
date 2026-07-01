// lib/sales.ts
// Cálculo de subtotal/total del carrito de venta. Función pura: sin acceso a
// DB ni a React, para poder testearla igual que lib/pricing.ts.
export interface SaleLineInput {
  unitPriceBs: number;
  quantity: number;
}

export function calculateLineSubtotal(line: SaleLineInput): number {
  return Math.round(line.unitPriceBs * line.quantity * 100) / 100;
}

export function calculateSaleTotal(lines: SaleLineInput[]): number {
  const sum = lines.reduce((acc, line) => acc + calculateLineSubtotal(line), 0);
  return Math.round(sum * 100) / 100;
}
