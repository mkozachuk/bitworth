import type { Currency } from "./net-worth";
import { buildContributionSplits, type ContributionSnapshot } from "./contributions";

// Period returns net of contributions (roadmap S-31, C-10). Three figures over
// one period of snapshots, all net of the money the user added or withdrew:
//
//   simple          = (V_n - V_0 - sum F) / V_0
//   Modified Dietz  = (V_n - V_0 - sum F) / (V_0 + sum W_i * F_i),  W_i = (T - D_i) / T
//   TWR             = prod (1 + r_i) - 1,  r_i = (V_i - V_{i-1} - F_i) / (V_{i-1} + F_i / 2)
//
// Interval i is (i-1, i]; its flow F_i is snapshot i's `netContribution`. No
// flow date is stored, so each flow is assumed to sit at the middle of its
// interval: D_i is the midpoint day of (t_{i-1}, t_i] counted from t_0, and T is
// days(t_0, t_n). TWR is the main figure (owner 13.11: all three, TWR main).
//
// Currency: the flows come from `buildContributionSplits` (unchanged), which
// converts each stored contribution to the display currency at today's rates
// through `convertAmount`. Net worth is not re-converted across snapshots; the
// caller passes snapshots of one display currency only.
//
// Unknown is never 0 (PRODUCT.md principle 2). A known run is a maximal
// sequence of consecutive intervals whose flow was recorded. The figures cover
// the latest known run only, and the result says which intervals it covers and
// where the chain broke. A denominator <= 0 or a non-finite result makes that
// figure null; it is never Infinity or NaN.
//
// Pure: no clock, no I/O. Input must be ordered by date.

const MS_PER_DAY = 86_400_000;

export interface PeriodReturns {
  /** Simple return over the run, or null when it is undefined. */
  simple: number | null;
  /** Modified Dietz return over the run (flows at mid-interval), or null. */
  modifiedDietz: number | null;
  /** Time-weighted return over the run (flows at mid-interval), or null. */
  twr: number | null;
  /** First and last snapshot dates of the run; null when there is no run. */
  start: string | null;
  end: string | null;
  /** Intervals in the run. */
  covered: number;
  /** Intervals overall (snapshots - 1). */
  total: number;
  /** End dates of every interval whose contribution was not recorded. */
  breaks: string[];
}

function days(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / MS_PER_DAY;
}

/** A ratio, or null when the denominator is <= 0 or the result is not finite. */
function ratio(num: number, den: number): number | null {
  if (!(den > 0)) return null;
  const r = num / den;
  return Number.isFinite(r) ? r : null;
}

export function computePeriodReturns(
  snapshots: ContributionSnapshot[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): PeriodReturns {
  const total = Math.max(0, snapshots.length - 1);
  const empty: PeriodReturns = {
    simple: null,
    modifiedDietz: null,
    twr: null,
    start: null,
    end: null,
    covered: 0,
    total,
    breaks: [],
  };
  if (snapshots.length < 2) return empty;

  // flows[i - 1] is F_i for interval (i-1, i]; null when not recorded.
  const splits = buildContributionSplits(snapshots, displayCurrency, rates);
  const flows = splits.map((s) => (s.kind === "split" ? s.contribution : null));
  const breaks = splits.filter((s) => s.kind === "unknown").map((s) => s.date);

  // Latest known run: walk back from the last interval to the newest known one,
  // then extend back while flows stay known. Intervals are 1-based (1..total).
  let last = total;
  while (last >= 1 && flows[last - 1] === null) last--;
  if (last < 1) return { ...empty, breaks };
  let first = last;
  while (first > 1 && flows[first - 2] !== null) first--;

  const s0 = snapshots[first - 1];
  const sn = snapshots[last];
  const v0 = s0.totalNetWorth;
  const vn = sn.totalNetWorth;
  const T = days(s0.date, sn.date);

  let sumF = 0;
  let sumWF = 0;
  let growth: number | null = 1;
  for (let i = first; i <= last; i++) {
    const f = flows[i - 1] ?? 0; // known inside the run by construction
    sumF += f;
    const dMid = (days(s0.date, snapshots[i - 1].date) + days(s0.date, snapshots[i].date)) / 2;
    sumWF += ((T - dMid) / T) * f;
    if (growth !== null) {
      const prev = snapshots[i - 1].totalNetWorth;
      const r = ratio(snapshots[i].totalNetWorth - prev - f, prev + f / 2);
      growth = r === null ? null : growth * (1 + r);
    }
  }

  const gain = vn - v0 - sumF;
  const twr = growth === null ? null : Number.isFinite(growth - 1) ? growth - 1 : null;

  return {
    simple: ratio(gain, v0),
    modifiedDietz: T > 0 ? ratio(gain, v0 + sumWF) : null,
    twr,
    start: s0.date,
    end: sn.date,
    covered: last - first + 1,
    total,
    breaks,
  };
}
