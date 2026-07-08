// lib/ventasCart.test.ts
import { describe, expect, it } from "vitest";
import { isProductInCart, clampPage, pageWindow, isValidCartQuantity, isValidCartPrice } from "./ventasCart";

describe("isProductInCart", () => {
  it("returns false for an empty cart", () => {
    expect(isProductInCart([], "p1")).toBe(false);
  });

  it("returns true when the product is already in the cart under any tier", () => {
    expect(isProductInCart([{ productId: "p1" }, { productId: "p2" }], "p1")).toBe(true);
  });

  it("returns false when the product is not in the cart", () => {
    expect(isProductInCart([{ productId: "p1" }], "p2")).toBe(false);
  });
});

describe("clampPage", () => {
  it("clamps a page above totalPages down to totalPages", () => {
    expect(clampPage(999, 5)).toBe(5);
  });

  it("clamps a page below 1 up to 1", () => {
    expect(clampPage(0, 5)).toBe(1);
  });

  it("returns 1 when there are no pages", () => {
    expect(clampPage(3, 0)).toBe(1);
  });

  it("passes through a valid page unchanged", () => {
    expect(clampPage(3, 5)).toBe(3);
  });

  it("floors a non-integer page", () => {
    expect(clampPage(2.7, 5)).toBe(2);
  });
});

describe("pageWindow", () => {
  it("lists every page when they all fit without gaps", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("inserts an ellipsis on both sides for a middle page in a large set", () => {
    expect(pageWindow(10, 372)).toEqual([1, "…", 8, 9, 10, 11, 12, "…", 372]);
  });

  it("omits the left ellipsis near the start", () => {
    expect(pageWindow(2, 372)).toEqual([1, 2, 3, 4, "…", 372]);
  });

  it("omits the right ellipsis near the end", () => {
    expect(pageWindow(371, 372)).toEqual([1, "…", 369, 370, 371, 372]);
  });

  it("does not use an ellipsis for a single skipped page (shows the number)", () => {
    expect(pageWindow(4, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("clamps an out-of-range page before building the window", () => {
    expect(pageWindow(999, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns [1] when there are no pages", () => {
    expect(pageWindow(1, 0)).toEqual([1]);
  });
});

describe("isValidCartQuantity", () => {
  it("accepts an integer quantity within stock", () => {
    expect(isValidCartQuantity(3, 5)).toBe(true);
  });

  it("rejects a quantity above stock", () => {
    expect(isValidCartQuantity(6, 5)).toBe(false);
  });

  it("rejects zero or negative quantities", () => {
    expect(isValidCartQuantity(0, 5)).toBe(false);
    expect(isValidCartQuantity(-1, 5)).toBe(false);
  });

  it("rejects non-integer quantities", () => {
    expect(isValidCartQuantity(1.5, 5)).toBe(false);
  });
});

describe("isValidCartPrice", () => {
  it("accepts zero and positive prices", () => {
    expect(isValidCartPrice(0)).toBe(true);
    expect(isValidCartPrice(11.05)).toBe(true);
  });

  it("rejects negative prices", () => {
    expect(isValidCartPrice(-1)).toBe(false);
  });

  it("rejects non-finite prices", () => {
    expect(isValidCartPrice(NaN)).toBe(false);
  });
});
