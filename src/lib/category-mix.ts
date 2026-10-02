import { contribution, EPSILON } from "./movers";
import type { Currency } from "./net-worth";

/**
 * One snapshot_item flattened with its parent snapshot's identity and date and
 * the category fields the mix needs. Grouping is by the stable FK
 * `category_id`, never by the category's (renameable) name.
 */
export interface CategoryMixItem {
  snapshotId: string;
  snapshotDate: string; // parent snapshots.created_at (ISO), the X value
  category_id: string;
  category_name: string; // from category.name; display only
  category_order: number; // from category.display_order; series order only
  is_liability: boolean; // from category.is_liability
  original_amount: number;
  original_currency: string; // cast `as Currency` only at the convertAmount boundary
}

export interface CategoryMixCategory {
  id: string;
  name: string;
  isLiability: boolean;
}

export interface CategoryMixRow {
  snapshotId: string;
  date: string;
  /**
   * Signed value per category in the display currency: assets positive, a
   * liability negative (so it stacks below the axis). Every category in the
   * result has a key; one absent from this snapshot is 0.
   */
  absolute: Record<string, number>;
  /**
   * Each ASSET category's percentage of the snapshot's asset total; the keys
   * sum to 100. Liability categories have no key here. `null` when the asset
   * total is below EPSILON (e.g. a snapshot holding only liabilities): there is
   * no mix to show, and nothing is divided by 0.
   */
  share: Record<string, number> | null;
}

export interface CategoryMix {
  /** Asset categories first, then liabilities; each group by display_order, then name, then id. */
  categories: CategoryMixCategory[];
  /** One row per snapshot that has items, ascending by date. */
  rows: CategoryMixRow[];
}

/**
 * Sum each snapshot's items by `category_id`. Every value is recomputed from
 * `original_amount`/`original_currency` at today's `rates` (the convention of
 * `buildAssetTrends`), so a display-currency switch never fabricates movement.
 * Pure: no clock, no I/O, the input is not mutated.
 */
export function buildCategoryMix(
  items: readonly CategoryMixItem[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): CategoryMix {
  const categoryById = new Map<string, CategoryMixCategory & { order: number }>();
  const bySnapshot = new Map<string, { date: string; sums: Map<string, number> }>();

  for (const item of items) {
    if (!categoryById.has(item.category_id)) {
      categoryById.set(item.category_id, {
        id: item.category_id,
        name: item.category_name,
        isLiability: item.is_liability,
        order: item.category_order,
      });
    }
    let snapshot = bySnapshot.get(item.snapshotId);
    if (!snapshot) {
      snapshot = { date: item.snapshotDate, sums: new Map() };
      bySnapshot.set(item.snapshotId, snapshot);
    }
    const value = contribution(item.original_amount, item.original_currency, item.is_liability, displayCurrency, rates);
    snapshot.sums.set(item.category_id, (snapshot.sums.get(item.category_id) ?? 0) + value);
  }

  const categories = [...categoryById.values()]
    .sort(
      (a, b) =>
        Number(a.isLiability) - Number(b.isLiability) ||
        a.order - b.order ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .map(({ id, name, isLiability }) => ({ id, name, isLiability }));
  const assetIds = categories.filter((c) => !c.isLiability).map((c) => c.id);

  const rows = [...bySnapshot.entries()]
    .sort(([idA, a], [idB, b]) => Date.parse(a.date) - Date.parse(b.date) || idA.localeCompare(idB))
    .map(([snapshotId, { date, sums }]): CategoryMixRow => {
      const absolute: Record<string, number> = {};
      for (const c of categories) absolute[c.id] = sums.get(c.id) ?? 0;

      const assetTotal = assetIds.reduce((sum, id) => sum + absolute[id], 0);
      let share: Record<string, number> | null = null;
      if (assetTotal >= EPSILON) {
        share = {};
        for (const id of assetIds) share[id] = (absolute[id] / assetTotal) * 100;
      }
      return { snapshotId, date, absolute, share };
    });

  return { categories, rows };
}
