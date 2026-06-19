import { convertAmount, type Currency } from "./net-worth";

// Below this threshold (in the display currency's minor units) a value is
// treated as zero: it neither counts as a baseline for the percentage nor as a
// real change for the gainer/loser split. Converted amounts are floats, so an
// exact `=== 0` comparison would mis-classify rounding dust.
export const EPSILON = 1e-2;

/** Current-side input: a subset of an `assets` row plus its joined category. */
export interface MoverAsset {
  name: string;
  category_id: string;
  amount: number;
  currency: string; // cast `as Currency` at the convertAmount boundary
  is_liability: boolean;
  icon: string | null; // category.icon, for the row emoji
}

/** Baseline-side input: a `snapshot_items` row plus its joined category. */
export interface MoverBaselineItem {
  name: string;
  category_id: string;
  original_amount: number;
  original_currency: string; // cast `as Currency` at the convertAmount boundary
  is_liability: boolean;
}

export interface Mover {
  name: string;
  icon: string | null;
  change: number; // signed contribution delta, in displayCurrency
  pct: number | null; // null when baseline ~0 (suppressed)
}

export interface NewAsset {
  name: string;
  icon: string | null;
  value: number; // signed contribution
}

export interface MoversResult {
  gainers: Mover[];
  losers: Mover[];
  newAssets: NewAsset[];
}

/** Matching key for pairing a current asset with a baseline item. */
export function key(name: string, categoryId: string): string {
  return `${name} ${categoryId}`;
}

/** Signed net-worth contribution: liabilities count negative, so a shrinking debt reads as a gain. */
export function contribution(
  amount: number,
  currency: string,
  isLiability: boolean,
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): number {
  const converted = convertAmount(amount, currency as Currency, displayCurrency, rates);
  return isLiability ? -converted : converted;
}

/**
 * Diff current assets against the latest snapshot's items to find which moved
 * the most. Both sides are converted at today's `rates` so a display-currency
 * switch since the snapshot does not introduce spurious movement — the delta
 * isolates real holding changes.
 *
 * Matching is on `(name, category_id)` (snapshot_items carry no stable
 * asset_id). A current asset with a baseline match is a mover; with no match it
 * is a new asset; a baseline item with no current match is absent from all three
 * lists.
 */
export function computeMovers(
  current: MoverAsset[],
  baseline: MoverBaselineItem[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
  limit = 3,
): MoversResult {
  const baselineByKey = new Map<string, number>();
  for (const item of baseline) {
    baselineByKey.set(
      key(item.name, item.category_id),
      contribution(item.original_amount, item.original_currency, item.is_liability, displayCurrency, rates),
    );
  }

  const movers: Mover[] = [];
  const newAssets: NewAsset[] = [];

  for (const asset of current) {
    const currentContribution = contribution(asset.amount, asset.currency, asset.is_liability, displayCurrency, rates);
    const baselineContribution = baselineByKey.get(key(asset.name, asset.category_id));

    if (baselineContribution === undefined) {
      newAssets.push({ name: asset.name, icon: asset.icon, value: currentContribution });
    } else {
      const change = currentContribution - baselineContribution;
      const pct = Math.abs(baselineContribution) < EPSILON ? null : (change / Math.abs(baselineContribution)) * 100;
      movers.push({ name: asset.name, icon: asset.icon, change, pct });
    }
  }

  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  const gainers = movers.filter((m) => m.change > EPSILON).slice(0, limit);
  const losers = movers.filter((m) => m.change < -EPSILON).slice(0, limit);

  return { gainers, losers, newAssets };
}
