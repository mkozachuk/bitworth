import { contribution, EPSILON, key } from "./movers";
import type { Currency } from "./net-worth";

/**
 * One snapshot_item flattened with its parent snapshot's date and the category
 * fields needed for the signed contribution. Mirrors `MoverBaselineItem` but
 * carries the snapshot identity/date so the builder can order points in time.
 */
export interface TrendItem {
  snapshotId: string;
  snapshotDate: string; // parent snapshots.created_at (ISO) — the X value
  name: string;
  category_id: string;
  original_amount: number;
  original_currency: string; // cast `as Currency` only at the convertAmount boundary
  is_liability: boolean; // from category.is_liability
  icon: string | null; // from category.icon
}

export interface TrendPoint {
  date: string;
  value: number; // signed contribution in displayCurrency
  indexed: number | null; // rebased to 100 at the line's own first point; null when baseline ~0
}

export interface AssetTrendSeries {
  name: string;
  category_id: string;
  icon: string | null;
  is_liability: boolean;
  points: TrendPoint[]; // chronological (ascending by date)
}

/**
 * Group all-snapshot items by `(name, category_id)` and build a chronological
 * series per asset. Every point's `value` is recomputed from
 * `original_amount`/`original_currency` at today's `rates` (the same
 * convert-at-today's-rates invariant `computeMovers` relies on) so a
 * display-currency switch never fabricates movement.
 *
 * `indexed` rebases each line to 100 at *its own* first present point, so a
 * late-appearing asset still starts at 100. The baseline uses `Math.abs(first)`
 * so a liability (whose `contribution` is negative) reads in the natural
 * direction — a shrinking debt trends upward. A near-zero baseline yields
 * `indexed = null` (mirrors `computeMovers`'s suppressed pct), leaving a hole.
 *
 * Missing snapshots produce no point for that line; the island maps absence to
 * `null` so Recharts breaks the line instead of bridging the gap.
 */
export function buildAssetTrends(
  items: TrendItem[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): AssetTrendSeries[] {
  const groups = new Map<string, TrendItem[]>();
  for (const item of items) {
    const k = key(item.name, item.category_id);
    const group = groups.get(k);
    if (group) {
      group.push(item);
    } else {
      groups.set(k, [item]);
    }
  }

  const series: AssetTrendSeries[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

    const valued = sorted.map((item) => ({
      date: item.snapshotDate,
      value: contribution(item.original_amount, item.original_currency, item.is_liability, displayCurrency, rates),
    }));

    const firstValue = valued[0]?.value ?? 0;
    const baseline = Math.abs(firstValue);
    const points: TrendPoint[] = valued.map((p) => ({
      date: p.date,
      value: p.value,
      indexed: baseline < EPSILON ? null : (p.value / baseline) * 100,
    }));

    const head = sorted[0];
    series.push({
      name: head.name,
      category_id: head.category_id,
      icon: head.icon,
      is_liability: head.is_liability,
      points,
    });
  }

  return series;
}

/**
 * Deterministically map an asset's index to a distinct, theme-legible color so
 * any number of lines stays distinguishable (chosen over cycling the 5 chart
 * CSS vars). Evenly spaces hues around the wheel at a fixed saturation/lightness
 * that reads on both light and dark backgrounds. Pure: same `(index, total)` →
 * same color.
 */
export function assetColor(index: number, total: number): string {
  const span = total > 0 ? total : 1;
  const hue = Math.round((index / span) * 360);
  return `hsl(${hue}, 65%, 50%)`;
}
