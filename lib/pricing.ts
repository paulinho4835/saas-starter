// Cálculo de precios de producto a partir de costo en USD + tipo de cambio +
// margen SF/MAY. CF ya no es un input independiente: siempre se deriva de
// SF Bs × 1.13 (regla fijada para reemplazar la fórmula inconsistente del
// legacy — ver docs/superpowers/specs/2026-07-08-productos-legacy-replica-design.md).
// Función pura: sin acceso a DB ni a React.
export interface PriceInputs {
  costUsd: number;
  exchangeRate: number;
  marginSfPct: number;
  marginMayPct: number;
}

export interface CalculatedPrices {
  priceSfBs: number;
  priceCfBs: number;
  priceMayBs: number;
  marginCfPct: number;
}

const CF_MULTIPLIER = 1.13;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculatePrices(inputs: PriceInputs): CalculatedPrices {
  const costBs = inputs.costUsd * inputs.exchangeRate;
  const priceSfBs = round2(costBs * (1 + inputs.marginSfPct / 100));
  const priceMayBs = round2(costBs * (1 + inputs.marginMayPct / 100));
  const priceCfBs = round2(priceSfBs * CF_MULTIPLIER);
  const marginCfPct = costBs > 0 ? round2((priceCfBs / costBs - 1) * 100) : 0;
  return { priceSfBs, priceCfBs, priceMayBs, marginCfPct };
}
