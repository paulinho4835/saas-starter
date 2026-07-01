// Cálculo de precios de producto a partir de costo en USD + tipo de cambio +
// margen por nivel (SF/CF/MAY). Función pura: sin acceso a DB ni a React.
export interface PriceInputs {
  costUsd: number;
  exchangeRate: number;
  marginSfPct: number;
  marginCfPct: number;
  marginMayPct: number;
}

export interface CalculatedPrices {
  priceSfBs: number;
  priceCfBs: number;
  priceMayBs: number;
}

function priceForMargin(costBs: number, marginPct: number): number {
  return Math.round(costBs * (1 + marginPct / 100) * 100) / 100;
}

export function calculatePrices(inputs: PriceInputs): CalculatedPrices {
  const costBs = inputs.costUsd * inputs.exchangeRate;
  return {
    priceSfBs: priceForMargin(costBs, inputs.marginSfPct),
    priceCfBs: priceForMargin(costBs, inputs.marginCfPct),
    priceMayBs: priceForMargin(costBs, inputs.marginMayPct),
  };
}
