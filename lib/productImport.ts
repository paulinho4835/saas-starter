// Parseo y validación de archivos de carga masiva de productos (Excel/CSV).
// Función pura sobre una matriz de celdas — no toca el sistema de archivos ni
// la base de datos, así se puede testear con datos de muestra reales.

export interface ParsedImportRow {
  rowNumber: number; // número de fila real en el archivo (1-based)
  family: string;
  code: string;
  brand: string;
  stock: number;
  priceCfBs: number | null;
  priceSfBs: number | null;
  priceMayBs: number | null;
  internalMm: number | null;
  externalMm: number | null;
  heightMm: number | null;
  flangeMm: number | null;
  stopMm: number | null;
  application: string | null;
  error: string | null;
}

export interface ParseImportResult {
  rows: ParsedImportRow[];
  headerRowIndex: number | null;
}

type FieldKey =
  | "family"
  | "code"
  | "brand"
  | "stock"
  | "priceCfBs"
  | "priceSfBs"
  | "priceMayBs"
  | "internalMm"
  | "externalMm"
  | "heightMm"
  | "flangeMm"
  | "stopMm"
  | "application";

const HEADER_TO_FIELD: Record<string, FieldKey> = {
  FAMILIA: "family",
  CODIGOPRODUCTO: "code",
  CODIGO: "code",
  MARCA: "brand",
  STOCK: "stock",
  CF: "priceCfBs",
  CFBS: "priceCfBs",
  SF: "priceSfBs",
  SFBS: "priceSfBs",
  MAY: "priceMayBs",
  MAYBS: "priceMayBs",
  MI: "internalMm",
  ME: "externalMm",
  ALT: "heightMm",
  ALTURA: "heightMm",
  PEST: "flangeMm",
  PESTANA: "flangeMm",
  TOPE: "stopMm",
  APLICACION: "application",
};

function normalizeHeader(cell: unknown): string {
  return String(cell ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Z0-9]/g, "");
}

function findHeaderRow(
  matrix: unknown[][],
): { index: number; columns: Partial<Record<FieldKey, number>> } | null {
  const maxScan = Math.min(matrix.length, 10);
  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] ?? [];
    const columns: Partial<Record<FieldKey, number>> = {};
    row.forEach((cell, colIndex) => {
      const field = HEADER_TO_FIELD[normalizeHeader(cell)];
      if (field && columns[field] === undefined) columns[field] = colIndex;
    });
    if (
      columns.family !== undefined &&
      columns.code !== undefined &&
      columns.brand !== undefined
    ) {
      return { index: i, columns };
    }
  }
  return null;
}

function toNumberOrNull(cell: unknown): number | null {
  if (cell === null || cell === undefined || cell === "") return null;
  const n =
    typeof cell === "number" ? cell : Number(String(cell).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function toText(cell: unknown): string {
  return String(cell ?? "").trim();
}

export function parseImportRows(matrix: unknown[][]): ParseImportResult {
  const header = findHeaderRow(matrix);
  if (!header) return { rows: [], headerRowIndex: null };

  const rows: ParsedImportRow[] = [];
  for (let i = header.index + 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    const get = (field: FieldKey) =>
      header.columns[field] !== undefined ? raw[header.columns[field]!] : undefined;

    const family = toText(get("family"));
    const code = toText(get("code"));
    const brand = toText(get("brand"));
    const isBlankRow =
      !family &&
      !code &&
      !brand &&
      raw.every((c) => c === undefined || c === null || c === "");
    if (isBlankRow) continue;

    const stockRaw = toNumberOrNull(get("stock"));
    const priceCfBs = toNumberOrNull(get("priceCfBs"));
    const priceSfBs = toNumberOrNull(get("priceSfBs"));
    const priceMayBs = toNumberOrNull(get("priceMayBs"));
    const internalMm = toNumberOrNull(get("internalMm"));
    const externalMm = toNumberOrNull(get("externalMm"));
    const heightMm = toNumberOrNull(get("heightMm"));
    const flangeMm = toNumberOrNull(get("flangeMm"));
    const stopMm = toNumberOrNull(get("stopMm"));

    const numericFields: Array<[string, number | null]> = [
      ["STOCK", stockRaw],
      ["CF", priceCfBs],
      ["SF", priceSfBs],
      ["MAY", priceMayBs],
      ["MI", internalMm],
      ["ME", externalMm],
      ["ALT", heightMm],
      ["PEST", flangeMm],
      ["TOPE", stopMm],
    ];
    const invalidField = numericFields.find(([, v]) => Number.isNaN(v));

    let error: string | null = null;
    if (!family || !code || !brand) {
      error = "Faltan datos obligatorios (familia, código o marca).";
    } else if (invalidField) {
      error = `Valor numérico inválido en la columna ${invalidField[0]}.`;
    }

    rows.push({
      rowNumber: i + 1,
      family,
      code,
      brand,
      stock: stockRaw ?? 0,
      priceCfBs: Number.isNaN(priceCfBs) ? null : priceCfBs,
      priceSfBs: Number.isNaN(priceSfBs) ? null : priceSfBs,
      priceMayBs: Number.isNaN(priceMayBs) ? null : priceMayBs,
      internalMm: Number.isNaN(internalMm) ? null : internalMm,
      externalMm: Number.isNaN(externalMm) ? null : externalMm,
      heightMm: Number.isNaN(heightMm) ? null : heightMm,
      flangeMm: Number.isNaN(flangeMm) ? null : flangeMm,
      stopMm: Number.isNaN(stopMm) ? null : stopMm,
      application: toText(get("application")) || null,
      error,
    });
  }

  return { rows, headerRowIndex: header.index };
}
