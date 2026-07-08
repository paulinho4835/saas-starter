// lib/transferCart.ts
// Reglas puras del carrito de Traspasos (Pedido/Envío) — sin acceso a DB ni
// a React, mismo espíritu que lib/ventasCart.ts. Ver
// docs/superpowers/specs/2026-07-08-traspasos-workflow-design.md

export type TransferCartLine = {
  productId: string;
  code: string;
  branchId: string;
  branchName: string;
  quantity: number;
};

export type TransferCartGroup = {
  branchId: string;
  branchName: string;
  lines: TransferCartLine[];
};

// El legacy permite en un mismo carrito de Pedido (o de Envío) productos
// dirigidos a varias sucursales distintas; al confirmar crea un traspaso por
// cada sucursal involucrada. Agrupa preservando el orden de primera
// aparición de cada sucursal.
export function groupCartByBranch(cart: TransferCartLine[]): TransferCartGroup[] {
  const order: string[] = [];
  const byBranch = new Map<string, TransferCartGroup>();
  for (const line of cart) {
    let group = byBranch.get(line.branchId);
    if (!group) {
      group = { branchId: line.branchId, branchName: line.branchName, lines: [] };
      byBranch.set(line.branchId, group);
      order.push(line.branchId);
    }
    group.lines.push(line);
  }
  return order.map((id) => byBranch.get(id)!);
}

export const PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR =
  "El producto ya está agregado en este carrito.";

// El legacy (mostrar_modal_cantidad) solo prohíbe agregar el MISMO producto
// dos veces al carrito de Pedido/Envío, sin importar a qué sucursal —
// pedidoCart y envioCart son carritos separados, así que un producto puede
// estar en ambos a la vez.
export function isProductInTransferCart(cart: TransferCartLine[], productId: string): boolean {
  return cart.some((line) => line.productId === productId);
}

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
