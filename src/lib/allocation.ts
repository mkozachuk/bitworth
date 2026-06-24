// Pure allocation math for the Asset Balancer.
//
// No Supabase, no React, no I/O — this module is the single source of
// allocation truth. It is imported on the Astro SSR server (initial render) and
// can be re-run on the React island, so both share one code path. All values
// are raw floats; rounding happens only at the view edge. Percentages are on a
// 0–100 scale end-to-end — there is NO ×100/÷100 conversion at the DB boundary
// (storage is already 0–100), and there must never be one here.
//
// The load-bearing invariant: `computeAllocation` returns ONE ordered slice
// list plus ONE denominator (`totalSelected`), so both pies (declared raw +
// real normalized) and any caller iterate the same list — slice i is the same
// asset, the same color. Re-deriving a second denominator or re-ordering is the
// bug this module exists to prevent.

import { convertAmount, type Currency } from "./net-worth";

// Below this threshold (in the display currency) a summed denominator is treated
// as zero: a real percentage against it would be meaningless, so callers get
// `null` instead. Converted amounts are floats, so an exact `=== 0` comparison
// would mis-classify rounding dust. Mirrors `movers.ts` EPSILON.
export const EPSILON = 1e-2;

/** One selected asset plus its entered target. `currency` is cast `as Currency` at the convertAmount boundary. */
export interface AllocationAsset {
  asset_id: string;
  name: string;
  amount: number;
  currency: string;
  targetPct: number; // raw entered target, 0–100
}

export interface AllocationSlice {
  asset_id: string;
  name: string;
  value: number; // converted into display currency, raw float
  targetPct: number; // raw entered target, 0–100
  realPct: number | null; // value / totalSelected * 100, null if denom ~0
}

export interface AllocationResult {
  slices: AllocationSlice[]; // ordered; index drives the shared color mapping
  totalSelected: number; // sum of slice values (the shared denominator)
  declaredSum: number; // sum of targetPct (for the live ≠100% flag)
}

/** One asset for the "% of all assets" denominator. `currency` is cast `as Currency` at the convertAmount boundary. */
export interface ShareAsset {
  amount: number;
  currency: string;
  is_liability: boolean;
}

/**
 * Compute the structured allocation result both pies and the editor consume.
 *
 * The declared pie renders the raw `targetPct` per slice (so an under/over-100%
 * sum stays visibly honest); the real pie renders `realPct`, normalized to 100%
 * by construction (value ÷ totalSelected × 100). Slice order follows input
 * order so callers can index a single color array.
 *
 * Guarded, not throwing: when the selected values sum below `EPSILON`, every
 * slice's `realPct` is `null` and `totalSelected` carries the (near-zero) sum —
 * matching the `movers.ts` near-zero-denominator convention. Input numbers are
 * assumed already parsed/validated (the API edge validates target ranges).
 */
export function computeAllocation(
  assets: AllocationAsset[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): AllocationResult {
  const valued = assets.map((asset) => ({
    asset,
    value: convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates),
  }));

  const totalSelected = valued.reduce((sum, { value }) => sum + value, 0);
  const declaredSum = assets.reduce((sum, asset) => sum + asset.targetPct, 0);
  const denomUsable = Math.abs(totalSelected) >= EPSILON;

  const slices: AllocationSlice[] = valued.map(({ asset, value }) => ({
    asset_id: asset.asset_id,
    name: asset.name,
    value,
    targetPct: asset.targetPct,
    realPct: denomUsable ? (value / totalSelected) * 100 : null,
  }));

  return { slices, totalSelected, declaredSum };
}

/**
 * Sum of positive non-liability converted values — the denominator for the
 * assets-page "% of all assets" label. Liabilities and non-positive values are
 * excluded so the label reflects share of the (positive) asset pool only.
 */
export function totalAssetPool(
  assets: ShareAsset[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): number {
  let total = 0;
  for (const asset of assets) {
    if (asset.is_liability) continue;
    const converted = convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates);
    if (converted > 0) total += converted;
  }
  return total;
}

/**
 * One row's share of the asset pool, 0–100. Returns `null` when the pool sums
 * below `EPSILON` (no meaningful denominator) so the view edge can render
 * nothing rather than a divide-by-zero artifact.
 */
export function assetSharePct(value: number, totalPool: number): number | null {
  if (Math.abs(totalPool) < EPSILON) return null;
  return (value / totalPool) * 100;
}
