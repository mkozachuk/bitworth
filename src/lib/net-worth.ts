import type { Database } from "@/lib/database.types";

type AssetRow = Database["public"]["Tables"]["assets"]["Row"];
interface ExchangeRate {
  currency_pair: string;
  rate: number;
}

export type Currency = "PLN" | "USD" | "EUR";

export interface NetWorthResult {
  total: number;
  byCategory: Record<string, number>;
  currency: Currency;
}

function getConversionRate(rates: ExchangeRate[], from: Currency, to: Currency): number {
  if (from === to) return 1;

  const pair1 = `${from}/${to}`;
  const pair2 = `${to}/${from}`;

  const direct = rates.find((r) => r.currency_pair === pair1);
  if (direct) return direct.rate;

  const reverse = rates.find((r) => r.currency_pair === pair2);
  if (reverse) return 1 / reverse.rate;

  // Cross conversion via PLN as intermediate
  const plnToFrom = rates.find((r) => r.currency_pair === `PLN/${from}`);
  const plnToTarget = rates.find((r) => r.currency_pair === `PLN/${to}`);
  if (plnToFrom && plnToTarget) return plnToTarget.rate / plnToFrom.rate;

  const fromToPLN = rates.find((r) => r.currency_pair === `${from}/PLN`);
  const targetToPLN = rates.find((r) => r.currency_pair === `${to}/PLN`);
  if (fromToPLN && targetToPLN) return targetToPLN.rate / fromToPLN.rate;

  // No rate found — return 1 as fallback (no conversion)
  return 1;
}

export function computeNetWorth(
  assets: AssetRow[],
  rates: ExchangeRate[],
  displayCurrency: Currency = "PLN",
): NetWorthResult {
  const byCategory: Record<string, number> = {};

  for (const asset of assets) {
    const rate = getConversionRate(rates, asset.currency as Currency, displayCurrency);
    const convertedAmount = asset.amount * rate;
    const signedAmount = asset.is_liability ? -convertedAmount : convertedAmount;

    const category = asset.category;
    byCategory[category] = (byCategory[category] ?? 0) + signedAmount;
  }

  const total = Object.values(byCategory).reduce((sum, val) => sum + val, 0);

  return { total, byCategory, currency: displayCurrency };
}
