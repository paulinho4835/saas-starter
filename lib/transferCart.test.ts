// lib/transferCart.test.ts
import { describe, expect, it } from "vitest";
import {
  groupCartByBranch,
  isProductInTransferCart,
  isPositiveInteger,
  PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR,
  type TransferCartLine,
} from "./transferCart";

function line(productId: string, branchId: string, branchName: string, quantity = 1): TransferCartLine {
  return { productId, code: `COD-${productId}`, branchId, branchName, quantity };
}

describe("groupCartByBranch", () => {
  it("returns an empty array for an empty cart", () => {
    expect(groupCartByBranch([])).toEqual([]);
  });

  it("groups lines by branchId preserving first-appearance order", () => {
    const cart = [
      line("p1", "b2", "Norte"),
      line("p2", "b1", "Central"),
      line("p3", "b2", "Norte"),
    ];
    const groups = groupCartByBranch(cart);
    expect(groups.map((g) => g.branchId)).toEqual(["b2", "b1"]);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[1].lines).toHaveLength(1);
  });

  it("keeps branchName from the group's first line", () => {
    const cart = [line("p1", "b1", "Central")];
    expect(groupCartByBranch(cart)[0].branchName).toBe("Central");
  });
});

describe("isProductInTransferCart", () => {
  it("returns true when the product is already in the cart, regardless of branch", () => {
    const cart = [line("p1", "b1", "Central")];
    expect(isProductInTransferCart(cart, "p1")).toBe(true);
  });

  it("returns false when the product is not in the cart", () => {
    const cart = [line("p1", "b1", "Central")];
    expect(isProductInTransferCart(cart, "p2")).toBe(false);
  });
});

describe("isPositiveInteger", () => {
  it("accepts positive integers", () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(42)).toBe(true);
  });

  it("rejects zero, negatives and non-integers", () => {
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(-1)).toBe(false);
    expect(isPositiveInteger(1.5)).toBe(false);
  });
});

describe("PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR", () => {
  it("is a non-empty user-facing message", () => {
    expect(PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR.length).toBeGreaterThan(0);
  });
});
