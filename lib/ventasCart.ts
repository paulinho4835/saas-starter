// lib/ventasCart.ts
// Reglas puras del carrito de Ventas — sin acceso a DB ni a React, para
// poder testearlas igual que lib/sales.ts. Ver
// docs/superpowers/specs/2026-07-07-ventas-legacy-replica-design.md

import { priceTierForSaleType, type SaleType } from "./saleType";

export type PriceTier = "cf" | "sf" | "may";

const TIER_SALE_LABEL: Record<PriceTier, string> = {
  cf: "Con Factura",
  sf: "Sin Factura",
  may: "Mayorista",
};

// Una venta = un solo tier de precio (CF/SF/MAY), aunque el `saleType`
// pueda variar entre la variante QR y no-QR del mismo tier (mismo precio).
// Devuelve el mensaje de error a mostrar si se intenta agregar un tier
// distinto al del carrito ya iniciado, o null si es compatible.
export function tierMismatchError(
  currentSaleType: SaleType,
  newTier: PriceTier,
): string | null {
  const currentTier = priceTierForSaleType(currentSaleType);
  if (currentTier === newTier) return null;
  return `Esta venta ya tiene productos ${TIER_SALE_LABEL[currentTier]}, no se puede mezclar con ${TIER_SALE_LABEL[newTier]}.`;
}

// Clampa un número de página al rango válido [1, totalPages] (o 1 si no hay
// páginas). Usado para que un `?page=` inválido en la URL no rompa la query.
export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) return 1;
  if (page < 1) return 1;
  if (page > totalPages) return Math.floor(totalPages);
  return Math.floor(page);
}

// Validaciones del modal "Cantidad de producto" (AddToCartModal), extraídas
// como funciones puras para poder testearlas sin React Testing Library.
export function isValidCartQuantity(quantity: number, stock: number): boolean {
  return Number.isInteger(quantity) && quantity > 0 && quantity <= stock;
}

export function isValidCartPrice(price: number): boolean {
  return Number.isFinite(price) && price >= 0;
}
