// Rango de tolerancia para búsqueda de productos por medida física (mm).
// Valor exacto del legacy (Producto::scopeFiltroProducto en venta_controller):
// whereBetween(valor - 3, valor + 3). Compartido por el filtro de medidas y
// el botón "Equiv" (equivalencias por medidas iguales).
const TOLERANCE_MM = 3;

export function toleranceRange(value: number): [number, number] {
  return [value - TOLERANCE_MM, value + TOLERANCE_MM];
}

export type MeasurementRow = {
  internalMm: number | null;
  externalMm: number | null;
  heightMm: number | null;
  flangeMm: number | null;
  stopMm: number | null;
};

export type MeasurementTargets = Partial<Record<keyof MeasurementRow, number>>;

// Replica exacta de calcular_cercania() del legacy (venta_controller.php).
// Recorre `rows` EN EL ORDEN que ya vienen (ascendente por ME, MI, Alt, Pest,
// Tope, igual que la query) buscando la coincidencia exacta o la de menor
// diferencia acumulada contra los valores buscados en cada medida activa.
// No reordena nada. Devuelve:
//   - `page`: la página (1-indexada, de `pageSize` filas) donde cae la
//     coincidencia, a la que el legacy salta automáticamente.
//   - `index`: la posición global (0-indexada) de esa fila, para hacer el
//     auto-scroll dentro de la página (nro_registro_cercano).
//   - `matchingIndices`: TODAS las filas (no solo `index`) cuyas medidas
//     activas coinciden exactamente con las de la fila en `index` — el
//     legacy resalta con `-intenso` cada fila de la página cuyo valor iguala
//     a `$medidas_cercanas` (los valores de la fila más cercana), sin
//     limitarse a una sola. Con dos productos que comparten exactamente las
//     mismas medidas buscadas, ambos quedan resaltados.
// Si no hay medidas activas o la lista está vacía, `index` es -1 y
// `matchingIndices` está vacío.
export function closestMatch(
  rows: MeasurementRow[],
  targets: MeasurementTargets,
  pageSize: number,
): { page: number; index: number; matchingIndices: number[] } {
  const activeKeys = (Object.keys(targets) as (keyof MeasurementRow)[]).filter(
    (key) => targets[key] != null,
  );
  if (activeKeys.length === 0 || rows.length === 0) {
    return { page: 1, index: -1, matchingIndices: [] };
  }

  let bestIndex = 0;
  let bestDiffSum = Number.POSITIVE_INFINITY;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let allMatch = true;
    let diffSum = 0;
    for (const key of activeKeys) {
      const target = targets[key] as number;
      // PHP coacciona null → 0 en aritmética, así que una medida faltante en
      // una dimensión buscada se penaliza con la distancia completa (igual que
      // el legacy). En la práctica la query ya excluye filas con null en una
      // dimensión activa (gte/lte descartan null), pero lo mantenemos fiel.
      const value = row[key] ?? 0;
      if (value !== target) allMatch = false;
      diffSum += Math.abs(value - target);
    }
    // Primera coincidencia estricta gana los empates (igual que el legacy, que
    // solo actualiza con `diffSum < mejor`). La coincidencia exacta corta la
    // búsqueda de inmediato.
    if (diffSum < bestDiffSum) {
      bestIndex = i;
      bestDiffSum = diffSum;
    }
    if (allMatch) {
      bestIndex = i;
      break;
    }
  }

  const bestRow = rows[bestIndex];
  const matchingIndices = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => activeKeys.every((key) => (row[key] ?? 0) === (bestRow[key] ?? 0)))
    .map(({ i }) => i);

  return { page: Math.floor(bestIndex / pageSize) + 1, index: bestIndex, matchingIndices };
}
