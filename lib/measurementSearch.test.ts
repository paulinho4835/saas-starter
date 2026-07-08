import { describe, expect, it } from "vitest";
import { toleranceRange, closestMatch, type MeasurementRow } from "./measurementSearch";

function row(externalMm: number, internalMm: number): MeasurementRow {
  return { externalMm, internalMm, heightMm: null, flangeMm: null, stopMm: null };
}

describe("toleranceRange", () => {
  it("returns a symmetric ±3mm range", () => {
    expect(toleranceRange(54.3)).toEqual([51.3, 57.3]);
  });

  it("handles zero", () => {
    expect(toleranceRange(0)).toEqual([-3, 3]);
  });

  it("handles negative input without special-casing", () => {
    expect(toleranceRange(-2)).toEqual([-5, 1]);
  });
});

describe("closestMatch", () => {
  it("returns index -1 (no jump) when no target measurement is set", () => {
    expect(closestMatch([row(45, 32)], {}, 75)).toEqual({ page: 1, index: -1, matchingIndices: [] });
  });

  it("returns index -1 for an empty result set", () => {
    expect(closestMatch([], { externalMm: 45 }, 75)).toEqual({ page: 1, index: -1, matchingIndices: [] });
  });

  it("jumps to the page and row of an exact match and stops scanning", () => {
    const rows = [row(45, 31), row(45, 32), row(45, 33)];
    expect(closestMatch(rows, { externalMm: 45, internalMm: 32 }, 1)).toEqual({
      page: 2,
      index: 1,
      matchingIndices: [1],
    });
  });

  it("lands on the row with the smallest cumulative difference when there is no exact match", () => {
    // objetivo externalMm=45 internalMm=32: la fila 1 (45,31) difiere en 1,
    // la fila 2 (45,34) difiere en 2 — debe preferir la fila 1 (páginas de 1).
    const rows = [row(40, 20), row(45, 31), row(45, 34)];
    expect(closestMatch(rows, { externalMm: 45, internalMm: 32 }, 1)).toEqual({
      page: 2,
      index: 1,
      matchingIndices: [1],
    });
  });

  it("only updates on a strict improvement, so the first best row wins ties", () => {
    const rows = [row(45, 31), row(45, 33)]; // ambas difieren en 1 de internalMm=32
    expect(closestMatch(rows, { externalMm: 45, internalMm: 32 }, 1)).toEqual({
      page: 1,
      index: 0,
      matchingIndices: [0],
    });
  });

  it("computes the page from the global index and pageSize", () => {
    const rows = [row(10, 10), row(20, 20), row(45, 32)];
    expect(closestMatch(rows, { externalMm: 45, internalMm: 32 }, 2)).toEqual({
      page: 2,
      index: 2,
      matchingIndices: [2],
    });
  });

  it("penalizes a null measurement in an active dimension (does not pick it)", () => {
    const rows = [
      { externalMm: 45, internalMm: null, heightMm: null, flangeMm: null, stopMm: null },
      row(45, 32),
    ];
    expect(closestMatch(rows, { externalMm: 45, internalMm: 32 }, 1)).toEqual({
      page: 2,
      index: 1,
      matchingIndices: [1],
    });
  });

  it("highlights every row sharing the exact same active-dimension values, not just the closest one", () => {
    // Dos productos distintos con las mismas ME/MI (45/32) pero distinta
    // altura (no buscada) — el legacy resalta ambos, no solo el primero
    // encontrado (public: estilo_adicional se aplica por fila, no una vez).
    const rows = [
      { externalMm: 45, internalMm: 32, heightMm: 4, flangeMm: null, stopMm: null },
      { externalMm: 45, internalMm: 32, heightMm: 6, flangeMm: null, stopMm: null },
      { externalMm: 45, internalMm: 31, heightMm: 4, flangeMm: null, stopMm: null },
    ];
    expect(closestMatch(rows, { externalMm: 45, internalMm: 32 }, 75)).toEqual({
      page: 1,
      index: 0,
      matchingIndices: [0, 1],
    });
  });
});
