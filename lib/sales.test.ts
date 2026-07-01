import { describe, expect, it } from "vitest";
import { calculateLineSubtotal, calculateSaleTotal } from "./sales";

describe("calculateLineSubtotal", () => {
  it("multiplies unit price by quantity and rounds to 2 decimals", () => {
    expect(calculateLineSubtotal({ unitPriceBs: 9.8, quantity: 3 })).toBe(29.4);
  });

  it("rounds correctly with fractional cents", () => {
    expect(calculateLineSubtotal({ unitPriceBs: 9.995, quantity: 1 })).toBe(9.99);
  });
});

describe("calculateSaleTotal", () => {
  it("sums subtotals of all lines", () => {
    const total = calculateSaleTotal([
      { unitPriceBs: 11.05, quantity: 2 },
      { unitPriceBs: 5.36, quantity: 1 },
    ]);
    expect(total).toBe(27.46); // 22.10 + 5.36
  });

  it("returns 0 for an empty cart", () => {
    expect(calculateSaleTotal([])).toBe(0);
  });
});
