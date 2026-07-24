// Pure savings-goal math: a goal's current value in the display currency, its
// progress against the target, and a discriminated estimated-completion state.
//
// No Supabase, no React, no I/O — this module is the single source of goal truth
// and is imported on the Astro SSR server, so the dashboard card can stay a plain
// function of props. All values are raw floats; rounding happens only at the view
// edge. Percentages are on a 0–100 scale end-to-end — there is NO ×100/÷100
// conversion at the DB boundary, and there must never be one here.
//
// Every function is pure and total: degenerate input (a near-zero target, a
// missing fit, too little comparable history, an unreachable trend) returns a
// guarded value or an explicit state rather than throwing or leaking
// `Infinity`/`NaN`, so callers guard a value instead of a try/catch.
//
// The load-bearing invariant is the ETA's four-state disambiguation.
// `etaToTarget` (trajectory.ts) returns `null` for BOTH "already reached" and
// "crossing in the past", and cannot tell "no history" from "flat trend". Every
// one of those means something different to the user, so `goalEta` decides on
// progress and sample count FIRST and only then consults the fit — a `null` from
// the solver is therefore unambiguously "your trend does not get you there".
//
// Input interfaces declare `currency`/`kind` as plain `string` because that is
// how Supabase types the underlying TEXT columns. The `as Currency` narrowing
// happens INSIDE this module (as `movers.ts` and `allocation.ts` do), so callers
// pass rows straight through without carrying a cast — see
// context/foundation/lessons.md §"Currency cast boundary".

import { EPSILON } from "./allocation";
import { convertAmount, type Currency } from "./net-worth";
import { etaToTarget, type Fit } from "./trajectory";

/** Milliseconds in one day — the sample `t` axis is expressed in days. */
const MS_PER_DAY = 86_400_000;

/** One `assets` row reduced to what a category subtotal needs. */
export interface GoalAsset {
  category_id: string;
  amount: number;
  currency: string; // cast `as Currency` at the convertAmount boundary
}

/** The goal fields that decide which pool a goal measures itself against. */
export interface GoalValueInput {
  kind: string; // 'net_worth' | 'category' (TEXT + CHECK; not a Postgres enum)
  category_id: string | null;
}

/**
 * The goal fields the ETA decision needs. The target arrives ALREADY converted
 * into the display currency because the caller has to compute that same number
 * for `goalProgressPct`'s denominator — converting it twice would be the one
 * place the two could silently disagree.
 */
export interface GoalEtaInput {
  kind: string;
  targetInDisplayCurrency: number;
}

/**
 * Why a goal has (or has not) an estimated completion date. A bare
 * `string | null` would collapse four user-visible outcomes into one.
 */
export type GoalEta =
  | { status: "projected"; date: string } // ISO-8601 instant the trend crosses the target
  | { status: "reached" } // progress >= 100; there is nothing left to project
  | { status: "not_reaching" } // flat, declining, or otherwise never-crossing trend
  | { status: "insufficient_history" } // <2 comparable samples, or a zero-variance t axis
  | { status: "unsupported" }; // category goal — no per-category history exists yet

/**
 * Sum every asset in `categoryId`, each converted into `displayCurrency` at
 * today's rates.
 *
 * Unlike `totalAssetPool` this deliberately does NOT skip liabilities or
 * non-positive converted values: a goal may legitimately name a liability
 * category ("pay the mortgage down to 0"), and filtering would silently
 * under-report the very number the progress bar is drawn from. The sign is left
 * exactly as stored — no liability negation — because the goal's target is
 * entered in the same terms.
 */
export function categorySubtotal(
  assets: GoalAsset[],
  categoryId: string,
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): number {
  let total = 0;
  for (const asset of assets) {
    if (asset.category_id !== categoryId) continue;
    total += convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates);
  }
  return total;
}

/**
 * The goal's current value in `displayCurrency`.
 *
 * A `category` goal sums that category's assets; every other kind (i.e.
 * `net_worth`, the default) returns the caller's already-computed `netWorth`
 * untouched, so the card can never disagree with the headline figure. A
 * `category` goal with no `category_id` is incoherent at the DB level (a CHECK
 * forbids it) and reads as 0 here rather than throwing.
 */
export function goalCurrentValue(
  goal: GoalValueInput,
  assets: GoalAsset[],
  netWorth: number,
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): number {
  if (goal.kind === "category") {
    return categorySubtotal(assets, goal.category_id ?? "", displayCurrency, rates);
  }
  return netWorth;
}

/**
 * Progress as an UNCAPPED 0–100-scale percentage — 150 means the goal is 50%
 * overshot, and the view edge decides whether to clamp the bar while still
 * showing the true number.
 *
 * A target whose magnitude is below `EPSILON` yields `0` rather than
 * `Infinity`/`NaN`. Guarding here, at the source, is what keeps a garbage
 * `aria-valuenow` off the progress bar even if a future caller forgets the
 * defensive clamp at the view edge.
 */
export function goalProgressPct(current: number, targetInDisplayCurrency: number): number {
  if (Math.abs(targetInDisplayCurrency) < EPSILON) return 0;
  return (current / targetInDisplayCurrency) * 100;
}

/**
 * Decide the goal's estimated-completion state.
 *
 * ORDER IS THE POINT. `etaToTarget` returns `null` for "already reached",
 * "crossed in the past", "flat trend" and "wrong-signed trend" alike, and
 * returns nothing at all when there is no fit to consult. So:
 *
 *   1. a `category` goal is `unsupported` — no per-category history exists yet,
 *      and a net-worth trend would be the wrong series to project from;
 *   2. progress >= 100 is `reached` — checked BEFORE the solver, because that is
 *      the branch `etaToTarget` cannot distinguish;
 *   3. fewer than 2 comparable samples, or a `null` fit (too few points or a
 *      zero-variance `t` axis), is `insufficient_history` — "we cannot say", not
 *      "you never will";
 *   4. only now does a `null` from the solver mean `not_reaching`.
 *
 * `fit`, `lastT`, `originMs` and `comparableCount` describe the ONE fit shared by
 * every goal on the dashboard; `t` is days since the first comparable snapshot,
 * which `originMs` maps back onto the calendar.
 */
export function goalEta(
  goal: GoalEtaInput,
  fit: Fit | null,
  lastT: number,
  originMs: number,
  progressPct: number,
  comparableCount: number,
): GoalEta {
  if (goal.kind === "category") return { status: "unsupported" };
  if (progressPct >= 100) return { status: "reached" };
  if (comparableCount < 2 || fit === null) return { status: "insufficient_history" };

  const etaT = etaToTarget(fit, goal.targetInDisplayCurrency, lastT);
  if (etaT === null) return { status: "not_reaching" };

  return { status: "projected", date: new Date(originMs + etaT * MS_PER_DAY).toISOString() };
}

/**
 * Whether a projected completion lands on or before the user's target date.
 *
 * Returns `null` on all three absent-input paths — no ETA, no target date, or an
 * ETA that is not `projected` — because there is nothing to compare, and a badge
 * that guessed would be worse than no badge.
 *
 * Comparison is on the UTC calendar day alone (`YYYY-MM-DD`, ISO-ordered so
 * lexicographic order IS chronological order): `target_date` is a SQL `DATE` with
 * no time-of-day, so parsing both into instants would make an ETA at noon "behind"
 * a target on the very same day. No rate math, no arithmetic, no timezone.
 */
export function onTrackVerdict(
  eta: GoalEta | null | undefined,
  targetDate: string | null | undefined,
): "on_track" | "behind" | null {
  if (!eta || !targetDate) return null;
  if (eta.status !== "projected") return null;

  const etaDay = eta.date.slice(0, 10);
  const targetDay = targetDate.slice(0, 10);
  return etaDay <= targetDay ? "on_track" : "behind";
}
