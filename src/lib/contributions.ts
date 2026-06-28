import { convertAmount, type Currency } from "./net-worth";
import { EPSILON } from "./movers";

// Splits each adjacent snapshot pair's net-worth change into the part the user
// deposited/withdrew (contribution) and the part the market moved (growth):
//
//   growth = totalChange - contribution
//
// Currency assumption (v1): `total_net_worth` is stored per-snapshot already in
// that snapshot's own `display_currency`. We do NOT cross-snapshot re-convert
// net worth — if the display currency changed between the compared pair the
// raw subtraction mixes currencies, the same mixed-currency caveat NetWorthChart
// already surfaces. Only the stored `net_contribution` is re-converted, to the
// caller's current display currency at today's `rates`, matching the movers
// convention (movers.ts). v1 assumes the display currency is stable across the
// compared pair.

/** Minimal snapshot shape this split needs. */
export interface ContributionSnapshot {
  totalNetWorth: number;
  displayCurrency: Currency;
  netContribution: number | null;
  date: string;
}

/**
 * One per-interval result. `kind: "split"` carries the contribution/growth
 * decomposition; `kind: "unknown"` flags an interval whose contribution was not
 * recorded (`net_contribution == null`) so the split cannot be computed.
 */
export type IntervalSplit = { date: string; totalChange: number } & (
  | { kind: "split"; contribution: number; growth: number }
  | { kind: "unknown" }
);

/** Snap float dust near zero to exactly 0 so rounding noise does not read as movement. */
function deadZone(x: number): number {
  return Math.abs(x) < EPSILON ? 0 : x;
}

/**
 * For each adjacent pair `(prev, curr)` in an ordered snapshot list, emit one
 * `IntervalSplit`. The first snapshot has no predecessor, so N snapshots yield
 * N-1 intervals; empty or single-snapshot input yields `[]`.
 */
export function buildContributionSplits(
  snapshots: ContributionSnapshot[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): IntervalSplit[] {
  const results: IntervalSplit[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];

    // Net worth is NOT cross-snapshot re-converted (see header). v1 assumes a
    // stable display currency across the pair.
    const totalChange = deadZone(curr.totalNetWorth - prev.totalNetWorth);

    if (curr.netContribution == null) {
      results.push({ date: curr.date, totalChange, kind: "unknown" });
      continue;
    }

    const contribution = deadZone(convertAmount(curr.netContribution, curr.displayCurrency, displayCurrency, rates));
    const growth = deadZone(totalChange - contribution);

    results.push({ date: curr.date, totalChange, kind: "split", contribution, growth });
  }

  return results;
}
