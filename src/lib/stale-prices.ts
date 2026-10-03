import { priceKeyFor, type PricedFields } from "./priced-holding";

// A priced holding's stored `amount` is only as fresh as its last write
// (src/lib/reprice.ts). `assets.updated_at` is stamped by trigger on every
// update, so it is an honest upper bound on how old that amount can be.

/** A priced holding whose amount was written longer ago than this is stale. */
export const STALE_PRICE_MAX_AGE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

export interface StaleCandidate extends PricedFields {
  updated_at: string;
}

/** Whole days elapsed since `updatedAt` (floored); NaN if it does not parse. */
export function ageInDays(updatedAt: string, now: Date | number): number {
  const nowMs = typeof now === "number" ? now : now.getTime();
  return Math.floor((nowMs - Date.parse(updatedAt)) / MS_PER_DAY);
}

/**
 * The priced holdings (same predicate as the reprice path) whose `updated_at`
 * is strictly older than `maxAgeDays`, oldest first. Exactly `maxAgeDays` old
 * is still fresh. Unpriced rows never count, and neither does a row whose
 * `updated_at` does not parse, because its age cannot be judged.
 */
export function stalePricedAssets<T extends StaleCandidate>(
  assets: readonly T[],
  now: Date | number,
  maxAgeDays: number = STALE_PRICE_MAX_AGE_DAYS,
): T[] {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const limitMs = maxAgeDays * MS_PER_DAY;
  return assets
    .filter((asset) => {
      if (!priceKeyFor(asset)) return false;
      const updatedMs = Date.parse(asset.updated_at);
      if (Number.isNaN(updatedMs)) return false;
      return nowMs - updatedMs > limitMs;
    })
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
}
