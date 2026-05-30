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

export function NetWorthDisplay({ assets, displayCurrency, rates }: Props) {
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

  const netWorth = totalAssets - totalLiabilities;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wider text-white/60 uppercase">Net Worth</h2>
        <CurrencyBadge currency={displayCurrency} />
      </div>

      <p className={`mb-4 text-4xl font-bold ${netWorth < 0 ? "text-red-300" : "text-white"}`}>
        {netWorth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {displayCurrency}
      </p>

      <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
        <div>
          <p className="text-xs tracking-wider text-white/50 uppercase">Assets</p>
          <p className="mt-1 text-lg font-semibold text-green-300">
            +{totalAssets.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
        <div>
          <p className="text-xs tracking-wider text-white/50 uppercase">Liabilities</p>
          <p className="mt-1 text-lg font-semibold text-red-300">
            -{totalLiabilities.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
      </div>
    </div>
  );
}
