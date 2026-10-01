import type { TrendPoint } from "./asset-trends";
import { contribution, EPSILON } from "./movers";
import type { Currency } from "./net-worth";

/**
 * One snapshot_item flattened with its parent snapshot's date, its category's
 * liability flag and the tag ids recorded on it at save time. `tag_ids` NULL
 * means "not recorded" (every item saved before tags were recorded); it is
 * never read as "no tags".
 */
export interface TagTrendItem {
  snapshotId: string;
  snapshotDate: string; // parent snapshots.created_at (ISO), the X value
  original_amount: number;
  original_currency: string; // cast `as Currency` only at the convertAmount boundary
  is_liability: boolean; // from category.is_liability
  tag_ids: readonly string[] | null;
}

export interface TagTrendSeries {
  tagId: string;
  points: TrendPoint[]; // chronological (ascending by date)
}

/**
 * Build one chronological series per requested tag. A point is the sum of the
 * signed contributions (a liability counts negative) of the snapshot's items
 * whose recorded `tag_ids` contain the tag, each recomputed from
 * `original_amount`/`original_currency` at today's `rates`: the same
 * convert-at-today's-rates rule as `buildAssetTrends`, so a display-currency
 * switch never fabricates movement.
 *
 * - A snapshot whose items ALL have `tag_ids` NULL was saved before tags were
 *   recorded. It contributes no point to any line, so the line breaks there
 *   and nothing is bridged. NULL is never treated as `[]`.
 * - A recorded snapshot gives every requested tag a point, 0 when no item
 *   carried the tag (an empty sum).
 * - An asset with two tags counts in both lines. The lines are separate
 *   series, never a stack, so no double-counted total exists.
 * - Only `tagIds` are built. An id recorded on an item whose tag has since
 *   been deleted is simply never asked for.
 *
 * `indexed` rebases a line to 100 at its first point whose |value| is at least
 * EPSILON (`Math.abs`, as in `buildAssetTrends`, so a liability-heavy tag
 * reads in the natural direction). Earlier zero points index to 0. A line with
 * no such point has `indexed` null throughout.
 */
export function buildTagTrends(
  items: readonly TagTrendItem[],
  tagIds: readonly string[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): TagTrendSeries[] {
  const bySnapshot = new Map<string, { date: string; items: TagTrendItem[] }>();
  for (const item of items) {
    const group = bySnapshot.get(item.snapshotId);
    if (group) group.items.push(item);
    else bySnapshot.set(item.snapshotId, { date: item.snapshotDate, items: [item] });
  }

  const recorded = [...bySnapshot.values()]
    .filter((s) => s.items.some((i) => i.tag_ids !== null))
    .sort((a, b) => a.date.localeCompare(b.date));

  return tagIds.map((tagId) => {
    const valued = recorded.map((s) => ({
      date: s.date,
      value: s.items
        .filter((i) => i.tag_ids?.includes(tagId) === true)
        .reduce(
          (sum, i) =>
            sum + contribution(i.original_amount, i.original_currency, i.is_liability, displayCurrency, rates),
          0,
        ),
    }));
    const base = valued.find((p) => Math.abs(p.value) >= EPSILON);
    const baseline = base ? Math.abs(base.value) : 0;
    return {
      tagId,
      points: valued.map((p) => ({
        date: p.date,
        value: p.value,
        indexed: base ? (p.value / baseline) * 100 : null,
      })),
    };
  });
}
