// Baseline selection and delta math for the dashboard's "vs Last Month" and
// "vs Jan 1st" cards.
//
// Pure on purpose: it reads no clock. Every boundary is anchored on the newest
// snapshot N, so the same rows give the same answer on the server and in the
// browser, today and next year.
//
// - Last month: the LATEST snapshot whose UTC calendar month is strictly
//   earlier than N's.
// - Jan 1st: the LATEST snapshot taken at or before 1 January 00:00 UTC of N's
//   UTC year.
//
// `total_net_worth` is stored in that snapshot's own `display_currency` and no
// save-time FX rate is kept, so a baseline in another currency cannot be
// compared honestly. That case is reported as its own state, never converted
// and never skipped over to an older same-currency snapshot.

/** The subset of a `snapshots` row the delta needs. */
export interface DeltaSnapshot {
  id: string;
  created_at: string;
  total_net_worth: number;
  display_currency: string;
}

export type SnapshotDelta =
  | {
      kind: "delta";
      baselineId: string;
      baselineCreatedAt: string;
      baselineLabel: string; // UTC date of the baseline, e.g. "Aug 30"
      value: number; // N minus baseline, in N's display currency
      pct: number | null; // null when the baseline total is 0
    }
  | {
      kind: "currency-changed";
      baselineId: string;
      baselineCreatedAt: string;
      baselineCurrency: string;
      currentCurrency: string;
    };

export interface NetWorthDeltas {
  lastMonth: SnapshotDelta | null; // null: no baseline yet
  jan: SnapshotDelta | null; // null: no baseline yet
}

interface Timed<T> {
  row: T;
  ms: number;
}

/** `YYYY-MM` of an instant, in UTC. */
function utcMonthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** Oldest first. Ties on the instant break on id so input order never matters. */
function sortAscending<T extends DeltaSnapshot>(rows: readonly T[]): Timed<T>[] {
  return rows
    .map((row) => ({ row, ms: Date.parse(row.created_at) }))
    .sort((a, b) => a.ms - b.ms || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
}

/** The latest row matching `pred`: the last candidate of an ascending list. */
function latestWhere<T>(sorted: Timed<T>[], pred: (s: Timed<T>) => boolean): T | null {
  const candidates = sorted.filter(pred);
  return candidates.length > 0 ? candidates[candidates.length - 1].row : null;
}

function deltaAgainst(current: DeltaSnapshot, baseline: DeltaSnapshot | null): SnapshotDelta | null {
  if (!baseline) return null;
  if (baseline.display_currency !== current.display_currency) {
    return {
      kind: "currency-changed",
      baselineId: baseline.id,
      baselineCreatedAt: baseline.created_at,
      baselineCurrency: baseline.display_currency,
      currentCurrency: current.display_currency,
    };
  }
  const value = current.total_net_worth - baseline.total_net_worth;
  const pct = baseline.total_net_worth === 0 ? null : (value / Math.abs(baseline.total_net_worth)) * 100;
  return {
    kind: "delta",
    baselineId: baseline.id,
    baselineCreatedAt: baseline.created_at,
    baselineLabel: formatBaselineDate(baseline.created_at, current.created_at),
    value,
    pct,
  };
}

export function computeNetWorthDeltas(snapshots: readonly DeltaSnapshot[]): NetWorthDeltas {
  const sorted = sortAscending(snapshots);
  if (sorted.length === 0) return { lastMonth: null, jan: null };

  const newest = sorted[sorted.length - 1];

  const newestMonth = utcMonthKey(newest.ms);
  const lastMonthBaseline = latestWhere(sorted, (s) => utcMonthKey(s.ms) < newestMonth);

  const yearStartMs = Date.UTC(new Date(newest.ms).getUTCFullYear(), 0, 1);
  const janBaseline = latestWhere(sorted, (s) => s.ms <= yearStartMs);

  return {
    lastMonth: deltaAgainst(newest.row, lastMonthBaseline),
    jan: deltaAgainst(newest.row, janBaseline),
  };
}

/**
 * The baseline's date for the card, in UTC: "Aug 30", or "Dec 28, 2026" when it
 * falls in a different UTC year than the newest snapshot.
 */
export function formatBaselineDate(baselineCreatedAt: string, newestCreatedAt: string): string {
  const baseline = new Date(Date.parse(baselineCreatedAt));
  const sameYear = baseline.getUTCFullYear() === new Date(Date.parse(newestCreatedAt)).getUTCFullYear();
  return baseline.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}
