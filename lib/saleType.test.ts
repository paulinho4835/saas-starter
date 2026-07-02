import { describe, expect, it } from "vitest";
import { SALE_TYPES, priceTierForSaleType, paymentMethodForSaleType } from "./saleType";

describe("priceTierForSaleType", () => {
  it("maps sin_factura variants to sf", () => {
    expect(priceTierForSaleType("sin_factura")).toBe("sf");
    expect(priceTierForSaleType("sin_factura_qr")).toBe("sf");
  });

  it("maps con_factura variants to cf", () => {
    expect(priceTierForSaleType("con_factura")).toBe("cf");
    expect(priceTierForSaleType("con_factura_qr")).toBe("cf");
  });

  it("maps mayorista to may", () => {
    expect(priceTierForSaleType("mayorista")).toBe("may");
  });

  it("has a mapping for every declared sale type", () => {
    for (const type of SALE_TYPES) {
      expect(["sf", "cf", "may"]).toContain(priceTierForSaleType(type));
    }
  });
});

describe("paymentMethodForSaleType", () => {
  it("classifies efectivo types", () => {
    expect(paymentMethodForSaleType("sin_factura")).toBe("efectivo");
    expect(paymentMethodForSaleType("con_factura")).toBe("efectivo");
    expect(paymentMethodForSaleType("mayorista")).toBe("efectivo");
  });

  it("classifies qr types", () => {
    expect(paymentMethodForSaleType("sin_factura_qr")).toBe("qr");
    expect(paymentMethodForSaleType("con_factura_qr")).toBe("qr");
  });
});
