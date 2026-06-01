import type { Currency } from "./exchange-rates";

export type { Currency };

export interface NetWorthAsset {
  amount: number;
  currency: Currency;
  category: { is_liability: boolean };
}

export function convertAmount(
  amount: number,
  fromCurrency: Currency,
  toCurrency: Currency,
  rates: Record<Currency, number>,
): number {
  if (fromCurrency === toCurrency) return amount;
  const inUSD = amount / rates[fromCurrency];
  return inUSD * rates[toCurrency];
}

export function computeNetWorth(
  assets: NetWorthAsset[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): number {
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const asset of assets) {
    const converted = convertAmount(asset.amount, asset.currency, displayCurrency, rates);
    if (asset.category.is_liability) {
      totalLiabilities += converted;
    } else {
      totalAssets += converted;
    }
  }
  return totalAssets - totalLiabilities;
}
