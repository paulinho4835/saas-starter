import { describe, expect, it } from "vitest";
import { toleranceRange } from "./measurementSearch";

describe("toleranceRange", () => {
  it("returns a symmetric ±0.5mm range", () => {
    expect(toleranceRange(54.3)).toEqual([53.8, 54.8]);
  });

  it("handles zero", () => {
    expect(toleranceRange(0)).toEqual([-0.5, 0.5]);
  });

  it("handles negative input without special-casing", () => {
    expect(toleranceRange(-2)).toEqual([-2.5, -1.5]);
  });
});
