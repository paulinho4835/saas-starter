import { describe, expect, it } from "vitest";
import { parseImportRows } from "./productImport";

const SAMPLE_MATRIX: unknown[][] = [
  ["", "CATALOGO", "DE", "PRODUCTOS"],
  ["FECHA Y HORA", "30-06-2026 18:26:35"],
  [
    "FAMILIA",
    "CODIGO_PRODUCTO",
    "MARCA",
    "STOCK",
    "CF Bs.",
    "SF Bs.",
    "MAY Bs.",
    "MI",
    "ME",
    "ALT",
    "PEST",
    "TOPE",
    "APLICACION",
  ],
  ["RETEN", "ORC54.30", "HI-TEC", "", 11.99, 9.96, 9.19, 0, 0, 0, 0, 0, ""],
  [
    "RETEN",
    "0305-10-155",
    "LOCAL",
    1,
    5.36,
    4.45,
    4.08,
    0,
    0,
    0,
    0,
    0,
    "No-54-* R/VALVULA MAZDA S26 C/UNO",
  ],
  ["ORING", "ORC35.00", "HI-TEC", 13, 11.34, 10.13, 4.05, 0, 0, 0, 0, 0, ""],
];

describe("parseImportRows", () => {
  it("finds the header row even with metadata rows above it", () => {
    const result = parseImportRows(SAMPLE_MATRIX);
    expect(result.headerRowIndex).toBe(2);
    expect(result.rows).toHaveLength(3);
  });

  it("maps every column to the right field", () => {
    const result = parseImportRows(SAMPLE_MATRIX);
    const row = result.rows[1];
    expect(row.family).toBe("RETEN");
    expect(row.code).toBe("0305-10-155");
    expect(row.brand).toBe("LOCAL");
    expect(row.stock).toBe(1);
    expect(row.priceCfBs).toBe(5.36);
    expect(row.priceSfBs).toBe(4.45);
    expect(row.priceMayBs).toBe(4.08);
    expect(row.application).toBe("No-54-* R/VALVULA MAZDA S26 C/UNO");
    expect(row.error).toBeNull();
  });

  it("treats a missing stock as zero, not an error", () => {
    const result = parseImportRows(SAMPLE_MATRIX);
    expect(result.rows[0].stock).toBe(0);
    expect(result.rows[0].error).toBeNull();
  });

  it("flags rows missing required fields", () => {
    const matrix = [...SAMPLE_MATRIX, ["", "ORC99.00", "HI-TEC", 1, 1, 1, 1]];
    const result = parseImportRows(matrix);
    const last = result.rows[result.rows.length - 1];
    expect(last.error).toMatch(/obligatorios/);
  });

  it("flags rows with a non-numeric value in a numeric column", () => {
    const matrix = [
      ...SAMPLE_MATRIX,
      ["RETEN", "ORC99.00", "HI-TEC", "no-numero", 1, 1, 1],
    ];
    const result = parseImportRows(matrix);
    const last = result.rows[result.rows.length - 1];
    expect(last.error).toMatch(/STOCK/);
  });

  it("returns no rows when no recognizable header is found", () => {
    const result = parseImportRows([
      ["foo", "bar"],
      ["baz", "qux"],
    ]);
    expect(result.headerRowIndex).toBeNull();
    expect(result.rows).toHaveLength(0);
  });
});
