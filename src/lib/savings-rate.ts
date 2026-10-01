import { convertAmount, type Currency } from "./net-worth";
import { buildContributionSplits, type ContributionSnapshot } from "./contributions";

// Savings rate per interval (roadmap S-24, slice B2):
//
//   rate = net_contribution / income
//
// for the interval that ends at a snapshot. Both inputs are stored on that
// later snapshot, in its own `display_currency`.
//
// Currency: this module follows contributions.ts exactly. The contribution
// comes from `buildContributionSplits` (unchanged), which re-converts the
// stored `net_contribution` from the snapshot's own display currency to the
// caller's current display currency at today's `rates`. `income` is converted
// the same way, with the same call, so both sides of the division share one
// currency and one rate set. A rate is therefore a ratio of two amounts from
// the same snapshot, and a display-currency switch does not change it.
//
// Unknown is never 0. The rate is `null` when the contribution was not recorded,
// or when the income is null or <= 0 (a rate over zero income is undefined). A
// contribution of 0 against a positive income is a real 0%. Rates above 100%
// and below 0% are kept as they are, never clamped, and carry a label.
//
// Pure: no clock, no I/O. Input order does not matter; it is sorted by date
// here, because the split pairs adjacent snapshots.

/** The split's input plus the income recorded on the same snapshot. */
export interface SavingsRateSnapshot extends ContributionSnapshot {
  income: number | null;
}

/** Why a rate needs words next to its number. */
export type RateLabel = "more than earned" | "withdrawal";

/** One interval, anchored on its later snapshot's date. */
export interface IntervalRate {
  date: string;
  /** Contribution in the caller's display currency, or null if not recorded. */
  contribution: number | null;
  /** Income in the caller's display currency, or null if not recorded. */
  income: number | null;
  /** contribution / income as a fraction (0.25 = 25%), or null if unknown. */
  rate: number | null;
  label: RateLabel | null;
}

export interface SavingsRateSummary {
  intervals: IntervalRate[];
  /** The most recent interval, known or not; null with fewer than 2 snapshots. */
  latest: IntervalRate | null;
  /** Mean of the last `averageCount` known rates, or null if none is known. */
  average: number | null;
  averageLabel: RateLabel | null;
  /** How many known intervals the average uses (at most AVERAGE_WINDOW). */
  averageCount: number;
}

/** The average covers at most this many of the most recent known intervals. */
export const AVERAGE_WINDOW = 6;

export function rateLabel(rate: number | null): RateLabel | null {
  if (rate === null) return null;
  if (rate > 1) return "more than earned";
  if (rate < 0) return "withdrawal";
  return null;
}

function byDate(a: SavingsRateSnapshot, b: SavingsRateSnapshot): number {
  return Date.parse(a.date) - Date.parse(b.date);
}

/** One `IntervalRate` per adjacent pair of snapshots, in date order. */
export function buildSavingsRates(
  snapshots: SavingsRateSnapshot[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): IntervalRate[] {
  const sorted = [...snapshots].sort(byDate);
  const splits = buildContributionSplits(sorted, displayCurrency, rates);

  return splits.map((split, i) => {
    // Split i belongs to the pair (sorted[i], sorted[i + 1]); the interval's
    // inputs live on its later snapshot.
    const curr = sorted[i + 1];
    const contribution = split.kind === "split" ? split.contribution : null;
    const income =
      curr.income === null ? null : convertAmount(curr.income, curr.displayCurrency, displayCurrency, rates);

    let rate: number | null = null;
    if (contribution !== null && income !== null && income > 0) {
      const r = contribution / income;
      rate = Number.isFinite(r) ? r : null;
    }
    return { date: split.date, contribution, income, rate, label: rateLabel(rate) };
  });
}

/** The headline card's numbers: the latest interval and the recent known average. */
export function summarizeSavingsRates(
  snapshots: SavingsRateSnapshot[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): SavingsRateSummary {
  const intervals = buildSavingsRates(snapshots, displayCurrency, rates);
  const known = intervals.flatMap((iv) => (iv.rate === null ? [] : [iv.rate]));
  const window = known.slice(-AVERAGE_WINDOW);
  const average = window.length === 0 ? null : window.reduce((sum, r) => sum + r, 0) / window.length;
  return {
    intervals,
    latest: intervals.at(-1) ?? null,
    average,
    averageLabel: rateLabel(average),
    averageCount: window.length,
  };
}
