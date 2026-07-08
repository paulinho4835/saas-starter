// lib/ventasCart.ts
// Reglas puras del carrito de Ventas — sin acceso a DB ni a React, para
// poder testearlas igual que lib/sales.ts. Ver
// docs/superpowers/specs/2026-07-07-ventas-legacy-replica-design.md

export type PriceTier = "cf" | "sf" | "may";

export const PRODUCT_ALREADY_IN_CART_ERROR =
  "El producto ya está agregado en el carrito de ventas.";

// El legacy (Venta Retenes) permite mezclar CF/SF/MAY en una misma venta —
// son 3 carritos paralelos que se registran juntos al confirmar. Lo único
// que prohíbe es agregar el MISMO producto dos veces, sin importar el tier.
export function isProductInCart(
  cart: { productId: string }[],
  productId: string,
): boolean {
  return cart.some((line) => line.productId === productId);
}

// Clampa un número de página al rango válido [1, totalPages] (o 1 si no hay
// páginas). Usado para que un `?page=` inválido en la URL no rompa la query.
export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) return 1;
  if (page < 1) return 1;
  if (page > totalPages) return Math.floor(totalPages);
  return Math.floor(page);
}

// Genera los ítems de paginación con ventana alrededor de la página actual,
// para no renderizar cientos de botones cuando hay muchas páginas. Devuelve
// siempre la primera y la última página, ±`delta` alrededor de la actual, y
// un separador "…" donde se saltan páginas. Ej. (page=10, total=372) →
// [1, "…", 8, 9, 10, 11, 12, "…", 372].
export function pageWindow(
  page: number,
  totalPages: number,
  delta = 2,
): (number | "…")[] {
  if (totalPages < 1) return [1];
  const current = clampPage(page, totalPages);

  // Siempre visibles: primera, última y ±delta alrededor de la actual.
  const pages = new Set<number>([1, totalPages]);
  for (let i = current - delta; i <= current + delta; i++) {
    if (i >= 1 && i <= totalPages) pages.add(i);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  // Al recorrer las páginas visibles ordenadas: si el hueco entre dos es de
  // exactamente una página, se muestra ese número (más útil que "…"); si es
  // mayor, se colapsa en un separador.
  const items: (number | "…")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0) {
      const gap = n - sorted[i - 1];
      if (gap === 2) items.push(sorted[i - 1] + 1);
      else if (gap > 2) items.push("…");
    }
    items.push(n);
  });
  return items;
}

// Validaciones del modal "Cantidad de producto" (AddToCartModal), extraídas
// como funciones puras para poder testearlas sin React Testing Library.
export function isValidCartQuantity(quantity: number, stock: number): boolean {
  return Number.isInteger(quantity) && quantity > 0 && quantity <= stock;
}

export function isValidCartPrice(price: number): boolean {
  return Number.isFinite(price) && price >= 0;
}
