import type { Tables } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";
import { CategoryIcon } from "@/lib/category-icons";
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
  const colorClass = mover.change >= 0 ? "text-gain" : "text-loss";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-foreground flex min-w-0 items-center gap-2 text-sm">
        <CategoryIcon name={mover.icon} />
        <span className="truncate">{mover.name}</span>
      </span>
      <span className={`tnum shrink-0 text-sm font-semibold whitespace-nowrap ${colorClass}`}>
        {formatAmount(mover.change)} {formatPct(mover.pct)}
      </span>
    </div>
  );
}

function MoverColumn({ label, movers }: { label: string; movers: Mover[] }) {
  return (
    <div>
      <h3 className="text-foreground/60 mb-3 text-xs font-bold tracking-[0.12em] uppercase">{label}</h3>
      {movers.length > 0 ? (
        <div className="space-y-2">
          {movers.map((mover) => (
            <MoverRow key={mover.name} mover={mover} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">None</p>
      )}
    </div>
  );
}

export function TopMovers({ assets, baselineItems, hasSnapshot, displayCurrency, rates }: Props) {
  if (!hasSnapshot) {
    return (
      <div className="border-kraft mt-6 rounded-md border-2 border-dashed p-8 text-center">
        <p className="text-foreground/70 text-sm">Save a snapshot to see your top movers.</p>
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
    <div className="bg-card border-border mt-6 rounded-md border p-6">
      <h2 className="text-foreground/60 mb-4 text-xs font-bold tracking-[0.12em] uppercase">Top Movers</h2>

      {hasMovers ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <MoverColumn label="Top Gainers" movers={gainers} />
          <MoverColumn label="Top Losers" movers={losers} />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No changes since your last snapshot.</p>
      )}

      {newAssets.length > 0 && (
        <div className="border-border mt-4 border-t pt-4">
          <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">New since snapshot</p>
          <p className="text-foreground/70 mt-1 text-sm">{newAssets.map((a: NewAsset) => a.name).join(", ")}</p>
        </div>
      )}
    </div>
  );
}
