import { CurrencyBadge } from "./CurrencyBadge";
import type { Tables } from "@/lib/database.types";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };
type Currency = "USD" | "EUR" | "PLN";

interface Props {
  assets: AssetWithCategory[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: Currency,
  rates: Record<Currency, number>,
): number {
  if (fromCurrency === toCurrency) return amount;
  const inUSD = amount / rates[fromCurrency as Currency];
  return inUSD * rates[toCurrency];
}

export function AssetsSummary({ assets, displayCurrency, rates }: Props) {
  // Accumulate per-currency totals (assets minus liabilities)
  const byCurrency: Record<Currency, { converted: number; original: number }> = {
    USD: { converted: 0, original: 0 },
    EUR: { converted: 0, original: 0 },
    PLN: { converted: 0, original: 0 },
  };

  for (const asset of assets) {
    const currency = asset.currency as Currency;
    if (!(currency in byCurrency)) continue;
    const converted = convertAmount(asset.amount, currency, displayCurrency, rates);
    byCurrency[currency].converted += converted;
    byCurrency[currency].original += asset.amount;
  }

  // Filter to non-zero, sort descending by converted total
  const rows = (Object.keys(byCurrency) as Currency[])
    .map((currency) => ({
      currency,
      converted: byCurrency[currency].converted,
      original: byCurrency[currency].original,
    }))
    .filter((row) => row.converted !== 0)
    .sort((a, b) => b.converted - a.converted);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-xs font-medium tracking-wider text-white/60 uppercase">Assets by Currency</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.currency} className="flex items-center justify-between">
            <CurrencyBadge currency={row.currency} />
            <div className="text-right">
              <span className="text-sm font-semibold text-white">
                {row.converted.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {displayCurrency}
              </span>
              {row.currency !== displayCurrency && (
                <span className="ml-2 text-xs text-white/40">
                  ({row.original.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  {row.currency})
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}