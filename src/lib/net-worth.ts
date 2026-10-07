import type { Currency } from "./exchange-rates";

export type { Currency };

export interface NetWorthAsset {
  amount: number;
  currency: Currency;
  category: { is_liability: boolean };
}

// `fromCurrency: Currency` is a deliberate narrowing boundary. Supabase types
// `Tables<'assets'>['currency']` as `string` (the SQL column is `text`), so
// every call site that reads a row from the DB must `as Currency` to call
// this helper. Broadening the parameter to `string` would push the unsafe
// narrowing into the helper itself; the current shape keeps it visible at the
// call site where the data is known to be one of the three supported values.
// See context/foundation/lessons.md "Currency cast boundary" for the full rule.
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

export interface NetWorthBreakdown {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/**
 * Returns the user's net worth breakdown in `displayCurrency`: the converted
 * sum of non-liability rows, the converted sum of liability rows, and
 * `netWorth = totalAssets - totalLiabilities`, all from one pass.
 */
export function computeNetWorth(
  assets: NetWorthAsset[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): NetWorthBreakdown {
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
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}
