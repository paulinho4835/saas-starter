// lib/ventasCart.test.ts
import { describe, expect, it } from "vitest";
import { tierMismatchError, clampPage, isValidCartQuantity, isValidCartPrice } from "./ventasCart";

describe("tierMismatchError", () => {
  it("returns null when the new tier matches the current sale type's tier", () => {
    expect(tierMismatchError("con_factura", "cf")).toBeNull();
  });

  it("returns null for the QR variant of the same tier", () => {
    expect(tierMismatchError("con_factura_qr", "cf")).toBeNull();
  });

  it("returns an error message when tiers differ", () => {
    expect(tierMismatchError("con_factura", "sf")).toBe(
      "Esta venta ya tiene productos Con Factura, no se puede mezclar con Sin Factura.",
    );
  });

  it("returns an error message comparing mayorista against sin_factura", () => {
    expect(tierMismatchError("mayorista", "sf")).toBe(
      "Esta venta ya tiene productos Mayorista, no se puede mezclar con Sin Factura.",
    );
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
