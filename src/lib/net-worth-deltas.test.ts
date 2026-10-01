import { describe, expect, it } from "vitest";
import { computeNetWorthDeltas, formatBaselineDate, type DeltaSnapshot } from "@/lib/net-worth-deltas";

// Table tests for the dashboard delta cards. Every case asserts WHICH snapshot
// was chosen as the baseline (by id), not just the resulting number, so a
// selector that picks the wrong end of the list cannot pass on a coincidence.
//
// All amounts are synthetic round numbers. Dates are literal instants; no case
// depends on the wall clock.

function snap(id: string, created_at: string, total_net_worth: number, display_currency = "USD"): DeltaSnapshot {
  return { id, created_at, total_net_worth, display_currency };
}

// (a) The shape of a real history: two July snapshots six minutes apart, a gap
// in the dates, newest at the end of September.
const OWNER_SHAPE: DeltaSnapshot[] = [
  snap("s-0601", "2026-06-01T09:00:00Z", 10000),
  snap("s-0626", "2026-06-26T09:00:00Z", 10400),
  snap("s-0726a", "2026-07-26T17:34:00Z", 10800),
  snap("s-0726b", "2026-07-26T17:40:00Z", 10810),
  snap("s-0830", "2026-08-30T09:00:00Z", 11500),
  snap("s-0927", "2026-09-27T09:00:00Z", 12000),
];

describe("computeNetWorthDeltas — last month", () => {
  it("(a) picks the latest snapshot of an earlier month, not the first one ever", () => {
    const { lastMonth } = computeNetWorthDeltas(OWNER_SHAPE);
    expect(lastMonth?.kind).toBe("delta");
    expect(lastMonth?.baselineId).toBe("s-0830");
    if (lastMonth?.kind !== "delta") throw new Error("expected a delta");
    expect(lastMonth.value).toBe(500); // 12000 - 11500
    expect(lastMonth.pct).toBeCloseTo((500 / 11500) * 100, 10);
    expect(lastMonth.baselineLabel).toBe("Aug 30");
  });

  it("(b) two snapshots in the previous month: the later one wins", () => {
    const { lastMonth } = computeNetWorthDeltas([
      snap("aug-05", "2026-08-05T12:00:00Z", 1000),
      snap("aug-20", "2026-08-20T12:00:00Z", 1100),
      snap("sep-10", "2026-09-10T12:00:00Z", 1210),
    ]);
    expect(lastMonth?.baselineId).toBe("aug-20");
  });

  it("(c) a gap: the baseline is the latest snapshot before the newest's month, even if it is days old", () => {
    const { lastMonth } = computeNetWorthDeltas([
      snap("aug-30", "2026-08-30T12:00:00Z", 1000),
      snap("sep-27", "2026-09-27T12:00:00Z", 1100),
      snap("oct-01", "2026-10-01T12:00:00Z", 1150),
    ]);
    expect(lastMonth?.baselineId).toBe("sep-27");
    if (lastMonth?.kind !== "delta") throw new Error("expected a delta");
    expect(lastMonth.value).toBe(50);
  });

  it("(d) UTC month boundary: 23:30Z on Aug 31 counts as August", () => {
    const { lastMonth } = computeNetWorthDeltas([
      snap("aug-15", "2026-08-15T12:00:00Z", 1000),
      snap("aug-31-late", "2026-08-31T23:30:00Z", 1100),
      snap("sep-15", "2026-09-15T12:00:00Z", 1200),
    ]);
    expect(lastMonth?.baselineId).toBe("aug-31-late");
  });

  it("(d) UTC month boundary: the same instant written with a +02:00 offset is still August", () => {
    // 2026-09-01T01:30+02:00 === 2026-08-31T23:30Z, so it is the newest's own month.
    const { lastMonth } = computeNetWorthDeltas([
      snap("jul-20", "2026-07-20T12:00:00Z", 1000),
      snap("aug-31-early", "2026-08-31T00:00:00Z", 1050),
      snap("aug-31-late", "2026-09-01T01:30:00+02:00", 1100),
    ]);
    expect(lastMonth?.baselineId).toBe("jul-20");
  });
});

describe("computeNetWorthDeltas — Jan 1st", () => {
  it("(e) several prior-year snapshots: the latest prior-year one, not the oldest", () => {
    const { jan, lastMonth } = computeNetWorthDeltas([
      snap("2026-06", "2026-06-01T12:00:00Z", 1000),
      snap("2026-11", "2026-11-30T12:00:00Z", 1300),
      snap("2026-12", "2026-12-28T12:00:00Z", 1400),
      snap("2027-01a", "2027-01-05T12:00:00Z", 1450),
      snap("2027-01b", "2027-01-20T12:00:00Z", 1500),
    ]);
    expect(jan?.baselineId).toBe("2026-12");
    expect(lastMonth?.baselineId).toBe("2026-12");
    if (jan?.kind !== "delta") throw new Error("expected a delta");
    expect(jan.value).toBe(100);
    expect(jan.baselineLabel).toBe("Dec 28, 2026");
  });

  it("(e) a snapshot exactly at 1 January 00:00 UTC counts as the Jan 1st baseline", () => {
    const { jan } = computeNetWorthDeltas([
      snap("dec-31", "2026-12-31T12:00:00Z", 1000),
      snap("jan-01-midnight", "2027-01-01T00:00:00Z", 1010),
      snap("jan-01-noon", "2027-01-01T12:00:00Z", 1020),
      snap("mar-15", "2027-03-15T12:00:00Z", 1100),
    ]);
    expect(jan?.baselineId).toBe("jan-01-midnight");
  });

  it("no snapshot before the newest's year: no Jan baseline", () => {
    expect(computeNetWorthDeltas(OWNER_SHAPE).jan).toBeNull();
  });
});

describe("computeNetWorthDeltas — states", () => {
  it("(f) currency changed: a distinct state, no number, no skipping back to a same-currency snapshot", () => {
    const { lastMonth } = computeNetWorthDeltas([
      snap("jul-usd", "2026-07-26T12:00:00Z", 1000, "USD"),
      snap("aug-eur", "2026-08-30T12:00:00Z", 900, "EUR"),
      snap("sep-usd", "2026-09-27T12:00:00Z", 1100, "USD"),
    ]);
    expect(lastMonth).toEqual({
      kind: "currency-changed",
      baselineId: "aug-eur",
      baselineCreatedAt: "2026-08-30T12:00:00Z",
      baselineCurrency: "EUR",
      currentCurrency: "USD",
    });
    expect(lastMonth).not.toHaveProperty("value");
  });

  it("(g) zero baseline: absolute delta kept, percentage omitted, no Infinity or NaN", () => {
    const { lastMonth } = computeNetWorthDeltas([
      snap("aug-zero", "2026-08-30T12:00:00Z", 0),
      snap("sep", "2026-09-27T12:00:00Z", 1500),
    ]);
    expect(lastMonth?.baselineId).toBe("aug-zero");
    if (lastMonth?.kind !== "delta") throw new Error("expected a delta");
    expect(lastMonth.value).toBe(1500);
    expect(lastMonth.pct).toBeNull();
  });

  it("a negative baseline: the percentage is taken against its magnitude", () => {
    const { lastMonth } = computeNetWorthDeltas([
      snap("aug-neg", "2026-08-30T12:00:00Z", -1000),
      snap("sep", "2026-09-27T12:00:00Z", -500),
    ]);
    if (lastMonth?.kind !== "delta") throw new Error("expected a delta");
    expect(lastMonth.value).toBe(500);
    expect(lastMonth.pct).toBe(50);
  });

  it("(h) a single snapshot: both baselines null", () => {
    expect(computeNetWorthDeltas([snap("only", "2026-09-27T12:00:00Z", 1000)])).toEqual({
      lastMonth: null,
      jan: null,
    });
  });

  it("no snapshots: both baselines null", () => {
    expect(computeNetWorthDeltas([])).toEqual({ lastMonth: null, jan: null });
  });

  it("(i) unsorted input gives the same result as sorted input", () => {
    const shuffled = [OWNER_SHAPE[3], OWNER_SHAPE[5], OWNER_SHAPE[0], OWNER_SHAPE[4], OWNER_SHAPE[2], OWNER_SHAPE[1]];
    const reversed = [...OWNER_SHAPE].reverse();
    const expected = computeNetWorthDeltas(OWNER_SHAPE);
    expect(computeNetWorthDeltas(shuffled)).toEqual(expected);
    expect(computeNetWorthDeltas(reversed)).toEqual(expected);
    expect(expected.lastMonth?.baselineId).toBe("s-0830");
  });

  it("does not reorder the caller's array", () => {
    const input = [OWNER_SHAPE[5], OWNER_SHAPE[0]];
    computeNetWorthDeltas(input);
    expect(input.map((s) => s.id)).toEqual(["s-0927", "s-0601"]);
  });
});

describe("formatBaselineDate", () => {
  it("formats in UTC and adds the year only across a year boundary", () => {
    expect(formatBaselineDate("2026-08-31T23:30:00Z", "2026-09-15T12:00:00Z")).toBe("Aug 31");
    expect(formatBaselineDate("2026-09-01T01:30:00+02:00", "2026-09-15T12:00:00Z")).toBe("Aug 31");
    expect(formatBaselineDate("2026-12-28T12:00:00Z", "2027-01-20T12:00:00Z")).toBe("Dec 28, 2026");
  });
});
