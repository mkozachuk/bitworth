import { CurrencyBadge } from "./CurrencyBadge";
import type { Tables } from "@/lib/database.types";
import { convertAmount, type Currency } from "@/lib/net-worth";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };

interface Props {
  assets: AssetWithCategory[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
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
    <div className="bg-card border-border mt-4 rounded-md border p-4">
      <h3 className="text-foreground/60 mb-3 text-xs font-bold tracking-[0.12em] uppercase">Assets by currency</h3>
      <div className="divide-border/70 divide-y">
        {rows.map((row, i) => (
          <div key={row.currency} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2.5">
              <span className="number-chip" aria-hidden="true">
                {i + 1}
              </span>
              <CurrencyBadge currency={row.currency} />
            </span>
            <span className="tnum text-foreground text-sm font-bold">
              {row.original.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {row.currency}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
