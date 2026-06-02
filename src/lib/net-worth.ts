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

/**
 * Returns the user's net worth in `displayCurrency` (assets minus liabilities).
 *
 * TODO(future-refactor): callers that need the breakdown (e.g.
 * NetWorthDisplay.tsx's IIFE at lines 137-149 and the two `.filter().reduce()`
 * calls at 199-202/210-213) re-implement this loop just to expose
 * `totalAssets` and `totalLiabilities` separately. Replace the return type
 * with `{ totalAssets, totalLiabilities, netWorth }` and update callers to
 * consume the breakdown directly. Tracked from the testing-runner-bootstrap
 * impl-review (F8, 2026-06-02).
 */
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
