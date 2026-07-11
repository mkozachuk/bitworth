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

// A card whose worst per-asset drift meets or exceeds this many percentage points
// is "breaching" and surfaced on the dashboard. Fixed constant for v1 (not a user
// preference) per roadmap S-18. Percentage points, on the same 0–100 scale.
export const DRIFT_THRESHOLD_PCT = 5;

/** One balancer card's drift inputs: identity plus its selected assets (each carrying a raw target). */
export interface DriftCardInput {
  id: string;
  name: string;
  assets: AllocationAsset[];
}

/** One asset's drift within a card: signed pp difference of real weight from its normalized target. */
export interface DriftAsset {
  asset_id: string;
  name: string;
  realPct: number; // already normalized to a 100 base by computeAllocation
  normalizedTargetPct: number; // targetPct / declaredSum * 100 (target on a 100 base)
  drift: number; // realPct − normalizedTargetPct, signed pp (positive = over target)
}

/** A drift-bearing card: its worst-asset severity plus its offenders ordered largest-drift first. */
export interface DriftCard {
  id: string;
  name: string;
  declaredSum: number; // sum of raw targetPct (drives the ≠100 "compared proportionally" note)
  severity: number; // max absolute per-asset drift across drift-bearing slices
  offenders: DriftAsset[]; // ordered by |drift| desc; ties keep input order
}

/** Ranked drift across all of a user's cards, ready for the dashboard alert card to render. */
export interface DriftResult {
  worst: DriftCard | null; // highest-severity breaching card, or null when none breach
  otherBreachingNames: string[]; // names of the remaining breaching cards, severity desc
  threshold: number; // DRIFT_THRESHOLD_PCT, echoed so the view need not re-import it
}

/**
 * Compute per-card, per-asset allocation drift across a user's balancer cards.
 *
 * Reuses `computeAllocation` per card, so it inherits the currency conversion and
 * the `realPct` normalization (value ÷ totalSelected × 100) — it does NOT recompute
 * real percentages. The one thing it adds is normalizing each slice's raw target to
 * a 100 base (`targetPct ÷ declaredSum × 100`) so a declared sum ≠ 100 does not skew
 * the comparison, then differencing: `drift = realPct − normalizedTargetPct`.
 *
 * Guarded, not throwing. A slice whose `realPct` is null (near-zero denominator) or
 * whose normalized target is null (`declaredSum < EPSILON`, i.e. no meaningful targets)
 * carries no drift and is excluded from severity. A card with no drift-bearing slices
 * is dropped entirely — never ranked, never surfaced, never a divide-by-zero.
 *
 * Card severity = max absolute per-asset drift. Cards with severity ≥ threshold are
 * ranked by severity descending (stable, so ties keep input order); the top one is the
 * detailed `worst`, the rest contribute only their names.
 */
export function computeDrift(
  cards: DriftCardInput[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): DriftResult {
  const driftCards: DriftCard[] = [];

  for (const card of cards) {
    const { slices, declaredSum } = computeAllocation(card.assets, displayCurrency, rates);
    const targetsUsable = declaredSum >= EPSILON;

    const offenders: DriftAsset[] = [];
    for (const slice of slices) {
      const normalizedTargetPct = targetsUsable ? (slice.targetPct / declaredSum) * 100 : null;
      // Either side null → no drift value; excluded from the card's severity and offenders.
      if (slice.realPct === null || normalizedTargetPct === null) continue;
      offenders.push({
        asset_id: slice.asset_id,
        name: slice.name,
        realPct: slice.realPct,
        normalizedTargetPct,
        drift: slice.realPct - normalizedTargetPct,
      });
    }

    if (offenders.length === 0) continue; // degenerate card (null realPct / no targets): drop it

    // Largest absolute drift first; Array.sort is stable, so equal-|drift| slices keep input order.
    offenders.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
    driftCards.push({ id: card.id, name: card.name, declaredSum, severity: Math.abs(offenders[0].drift), offenders });
  }

  // Stable severity-desc rank so tied cards preserve input order.
  const breaching = driftCards.filter((c) => c.severity >= DRIFT_THRESHOLD_PCT).sort((a, b) => b.severity - a.severity);

  return {
    worst: breaching[0] ?? null,
    otherBreachingNames: breaching.slice(1).map((c) => c.name),
    threshold: DRIFT_THRESHOLD_PCT,
  };
}

/** One asset's row in a buy plan: how much to deploy to move toward target. */
export interface BuyPlanRow {
  asset_id: string;
  name: string;
  currentValue: number; // converted into display currency, raw float
  targetPct: number; // raw entered target, 0–100
  buy: number; // amount to buy in display currency, ≥ 0 (buy-only)
  finalValue: number; // currentValue + buy
  finalPct: number; // finalValue / finalTotal × 100 (0 when finalTotal ~0)
}

export interface BuyPlan {
  rows: BuyPlanRow[]; // same order as the input slices
  available: number; // budget the user entered (echoed back)
  deployed: number; // sum of buys actually allocated
  leftover: number; // available − deployed (≥ 0; undeployable cash)
  finalTotal: number; // totalSelected + deployed
}

/**
 * Given the current allocation and a cash budget, compute how much to BUY of
 * each asset to move the portfolio toward its declared targets.
 *
 * Buy-only: you can deploy fresh cash but cannot sell, so an asset already above
 * its target weight is clamped (`buy = 0`) and its budget share flows to the
 * still-underweight assets. This is a water-filling fixpoint — clamp the
 * overweight, redistribute among the rest, repeat until the active set stabilizes.
 *
 * Target weights are normalized by `declaredSum`, not assumed to be 100, so the
 * plan honors the user's *relative* targets whether or not they add up. Returns
 * `null` when there is nothing to plan against (no positive targets) — the caller
 * renders guidance rather than a divide-by-zero artifact.
 */
export function computeBuyPlan(slices: AllocationSlice[], available: number): BuyPlan | null {
  const budget = Math.max(0, available);
  const declaredSum = slices.reduce((sum, s) => sum + Math.max(0, s.targetPct), 0);
  if (declaredSum < EPSILON) return null;

  const totalSelected = slices.reduce((sum, s) => sum + s.value, 0);
  const finalTotal = totalSelected + budget;

  // weight[i] = relative target share (0–1). Negative/blank targets count as 0.
  const weights = slices.map((s) => Math.max(0, s.targetPct) / declaredSum);

  // Water-filling: `fixed[i]` marks an asset clamped at its current value because
  // its ideal final value already sits below what it holds (overweight). The
  // remaining assets share (finalTotal − sum of fixed current values) by weight.
  const fixed = slices.map(() => false);
  const ideal = slices.map(() => 0);

  // Bounded by the asset count: each pass fixes at least one asset or stops.
  for (let pass = 0; pass < slices.length + 1; pass++) {
    let fixedValue = 0;
    let activeWeight = 0;
    for (let i = 0; i < slices.length; i++) {
      if (fixed[i]) fixedValue += slices[i].value;
      else activeWeight += weights[i];
    }

    // No active weight left (every weighted asset is overweight): the rest cannot
    // absorb more without selling. Remaining budget is simply undeployable.
    if (activeWeight < EPSILON) break;

    const activeBudget = finalTotal - fixedValue;
    let movedOne = false;
    for (let i = 0; i < slices.length; i++) {
      if (fixed[i]) continue;
      ideal[i] = activeBudget * (weights[i] / activeWeight);
      if (ideal[i] < slices[i].value) {
        fixed[i] = true;
        movedOne = true;
      }
    }
    if (!movedOne) break;
  }

  const rows: BuyPlanRow[] = slices.map((s, i) => {
    const buy = fixed[i] ? 0 : Math.max(0, ideal[i] - s.value);
    const finalValue = s.value + buy;
    return {
      asset_id: s.asset_id,
      name: s.name,
      currentValue: s.value,
      targetPct: s.targetPct,
      buy,
      finalValue,
      finalPct: finalTotal >= EPSILON ? (finalValue / finalTotal) * 100 : 0,
    };
  });

  const deployed = rows.reduce((sum, r) => sum + r.buy, 0);
  return { rows, available: budget, deployed, leftover: Math.max(0, budget - deployed), finalTotal };
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
