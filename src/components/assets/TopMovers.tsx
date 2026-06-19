import type { Tables } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";
import { categoryEmoji } from "@/lib/category-icons";
import { computeMovers, type Mover, type MoverAsset, type MoverBaselineItem, type NewAsset } from "@/lib/movers";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };
type SnapshotItemWithCategory = Tables<"snapshot_items"> & { category: Tables<"asset_categories"> };

interface Props {
  assets: AssetWithCategory[];
  baselineItems: SnapshotItemWithCategory[];
  hasSnapshot: boolean;
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

/** `+$1,234.56` / `-$1,234.56` in the display-currency idiom shared with NetWorthDisplay's DeltaIndicator. */
function formatAmount(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `(+5.0%)`, or `(—)` when the baseline was near-zero and the percentage is suppressed. */
function formatPct(pct: number | null): string {
  if (pct === null) return "(—)";
  const sign = pct >= 0 ? "+" : "-";
  return `(${sign}${Math.abs(pct).toFixed(1)}%)`;
}

function MoverRow({ mover }: { mover: Mover }) {
  const colorClass = mover.change >= 0 ? "text-green-600 dark:text-green-300" : "text-red-600 dark:text-red-300";
  const emoji = categoryEmoji(mover.icon);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-900 dark:text-white">
        {emoji && <span aria-hidden="true">{emoji}</span>}
        <span className="truncate">{mover.name}</span>
      </span>
      <span className={`shrink-0 text-sm font-semibold whitespace-nowrap ${colorClass}`}>
        {formatAmount(mover.change)} {formatPct(mover.pct)}
      </span>
    </div>
  );
}

function MoverColumn({ label, movers }: { label: string; movers: Mover[] }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-white/60">{label}</h3>
      {movers.length > 0 ? (
        <div className="space-y-2">
          {movers.map((mover) => (
            <MoverRow key={mover.name} mover={mover} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-white/40">None</p>
      )}
    </div>
  );
}

export function TopMovers({ assets, baselineItems, hasSnapshot, displayCurrency, rates }: Props) {
  if (!hasSnapshot) {
    return (
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-8 text-center backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
        <p className="text-zinc-600 dark:text-blue-100/60">Save a snapshot to see your top movers.</p>
      </div>
    );
  }

  const current: MoverAsset[] = assets.map((asset) => ({
    name: asset.name,
    category_id: asset.category_id,
    amount: asset.amount,
    currency: asset.currency,
    is_liability: asset.category.is_liability,
    icon: asset.category.icon,
  }));

  const baseline: MoverBaselineItem[] = baselineItems.map((item) => ({
    name: item.name,
    category_id: item.category_id,
    original_amount: item.original_amount,
    original_currency: item.original_currency,
    is_liability: item.category.is_liability,
  }));

  const { gainers, losers, newAssets } = computeMovers(current, baseline, displayCurrency, rates);
  const hasMovers = gainers.length > 0 || losers.length > 0;

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
      <h2 className="mb-4 text-sm font-medium tracking-wider text-zinc-600 uppercase dark:text-white/60">Top Movers</h2>

      {hasMovers ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <MoverColumn label="Top Gainers" movers={gainers} />
          <MoverColumn label="Top Losers" movers={losers} />
        </div>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-white/40">No changes since your last snapshot.</p>
      )}

      {newAssets.length > 0 && (
        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-white/10">
          <p className="text-xs tracking-wider text-zinc-500 uppercase dark:text-white/50">New since snapshot</p>
          <p className="mt-1 text-sm text-zinc-700 dark:text-white/70">
            {newAssets.map((a: NewAsset) => `${categoryEmoji(a.icon)} ${a.name}`.trim()).join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
