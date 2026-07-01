import { describe, expect, it } from "vitest";
import { calculatePrices } from "./pricing";

describe("calculatePrices", () => {
  it("converts cost to Bs and applies each level's margin", () => {
    const result = calculatePrices({
      costUsd: 10,
      exchangeRate: 8.1,
      marginSfPct: 20,
      marginCfPct: 30,
      marginMayPct: 10,
    });
    // costoBs = 81
    expect(result.priceSfBs).toBeCloseTo(97.2, 2); // 81 * 1.20
    expect(result.priceCfBs).toBeCloseTo(105.3, 2); // 81 * 1.30
    expect(result.priceMayBs).toBeCloseTo(89.1, 2); // 81 * 1.10
  });

  it("rounds to 2 decimals", () => {
    const result = calculatePrices({
      costUsd: 1,
      exchangeRate: 6.96,
      marginSfPct: 33,
      marginCfPct: 0,
      marginMayPct: 0,
    });
    // costoBs = 6.96, sf = 6.96 * 1.33 = 9.2568 -> 9.26
    expect(result.priceSfBs).toBe(9.26);
  });

  it("returns zero prices when cost is zero", () => {
    const result = calculatePrices({
      costUsd: 0,
      exchangeRate: 8.1,
      marginSfPct: 20,
      marginCfPct: 30,
      marginMayPct: 10,
    });
    expect(result.priceSfBs).toBe(0);
    expect(result.priceCfBs).toBe(0);
    expect(result.priceMayBs).toBe(0);
  });
});
