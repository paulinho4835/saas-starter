// Rango de tolerancia para búsqueda de productos por medida física (mm). En
// el mostrador la medida tecleada casi nunca coincide exactamente con la del
// producto (redondeos, distintas formas de anotar la misma pieza), así que
// una coincidencia exacta dejaría fuera productos que sí sirven.
const TOLERANCE_MM = 0.5;

export function toleranceRange(value: number): [number, number] {
  return [value - TOLERANCE_MM, value + TOLERANCE_MM];
}
