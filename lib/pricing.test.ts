import { describe, expect, it } from "vitest";
import { calculatePrices } from "./pricing";

describe("calculatePrices", () => {
  it("converts cost to Bs and applies SF/MAY margin, deriving CF from SF×1.13", () => {
    const result = calculatePrices({
      costUsd: 10,
      exchangeRate: 8.1,
      marginSfPct: 20,
      marginMayPct: 10,
    });
    // costoBs = 81
    expect(result.priceSfBs).toBeCloseTo(97.2, 2); // 81 * 1.20
    expect(result.priceMayBs).toBeCloseTo(89.1, 2); // 81 * 1.10
    expect(result.priceCfBs).toBeCloseTo(109.84, 2); // round(97.2 * 1.13, 2)
    expect(result.marginCfPct).toBeCloseTo(35.60, 2); // (109.84/81 - 1) * 100
  });

  it("rounds to 2 decimals", () => {
    const result = calculatePrices({
      costUsd: 1,
      exchangeRate: 6.96,
      marginSfPct: 33,
      marginMayPct: 0,
    });
    // costoBs = 6.96, sf = 6.96 * 1.33 = 9.2568 -> 9.26
    expect(result.priceSfBs).toBe(9.26);
    expect(result.priceCfBs).toBe(10.46); // round(9.26 * 1.13, 2)
  });

  it("returns zero prices and zero CF margin when cost is zero", () => {
    const result = calculatePrices({
      costUsd: 0,
      exchangeRate: 8.1,
      marginSfPct: 20,
      marginMayPct: 10,
    });
    expect(result.priceSfBs).toBe(0);
    expect(result.priceCfBs).toBe(0);
    expect(result.priceMayBs).toBe(0);
    expect(result.marginCfPct).toBe(0);
  });

  it("CF is always exactly SF × 1.13, regardless of MAY", () => {
    const result = calculatePrices({
      costUsd: 100,
      exchangeRate: 1,
      marginSfPct: 0,
      marginMayPct: 999,
    });
    expect(result.priceSfBs).toBe(100);
    expect(result.priceCfBs).toBe(113); // 100 * 1.13
    expect(result.marginCfPct).toBe(13);
  });
});
