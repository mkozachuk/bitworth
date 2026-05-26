import { describe, it, expect } from "vitest";
import { computeDelta, getLastMonthSnapshot, getYearStartSnapshot } from "@/lib/delta";

interface SnapshotRow {
  id: string;
  user_id: string;
  total_net_worth: number;
  currency: string;
  snapshot_date: string;
  created_at: string;
}

function makeSnapshot(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "snap-1",
    user_id: "user-1",
    total_net_worth: 1000,
    currency: "PLN",
    snapshot_date: "2024-06-01",
    created_at: "2024-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeDelta", () => {
  it("computes positive percentage and absolute change", () => {
    const from = makeSnapshot({ total_net_worth: 1000, snapshot_date: "2024-01-01" });
    const to = makeSnapshot({ id: "snap-2", total_net_worth: 1200, snapshot_date: "2024-02-01" });

    const result = computeDelta(from, to);

    expect(result.absolute).toBe(200);
    expect(result.percentage).toBeCloseTo(20, 2);
    expect(result.fromSnapshot).toBe(from);
    expect(result.toSnapshot).toBe(to);
  });

  it("computes negative percentage and absolute change", () => {
    const from = makeSnapshot({ total_net_worth: 1000, snapshot_date: "2024-01-01" });
    const to = makeSnapshot({ id: "snap-2", total_net_worth: 800, snapshot_date: "2024-02-01" });

    const result = computeDelta(from, to);

    expect(result.absolute).toBe(-200);
    expect(result.percentage).toBeCloseTo(-20, 2);
  });

  it("returns zero percentage when from value is zero", () => {
    const from = makeSnapshot({ total_net_worth: 0, snapshot_date: "2024-01-01" });
    const to = makeSnapshot({ id: "snap-2", total_net_worth: 500, snapshot_date: "2024-02-01" });

    const result = computeDelta(from, to);

    expect(result.absolute).toBe(500);
    expect(result.percentage).toBe(0);
  });

  it("returns zero when both snapshots have the same value", () => {
    const from = makeSnapshot({ total_net_worth: 1000, snapshot_date: "2024-01-01" });
    const to = makeSnapshot({ id: "snap-2", total_net_worth: 1000, snapshot_date: "2024-02-01" });

    const result = computeDelta(from, to);

    expect(result.absolute).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it("handles large positive change", () => {
    const from = makeSnapshot({ total_net_worth: 100, snapshot_date: "2024-01-01" });
    const to = makeSnapshot({ id: "snap-2", total_net_worth: 600, snapshot_date: "2024-02-01" });

    const result = computeDelta(from, to);

    expect(result.absolute).toBe(500);
    expect(result.percentage).toBeCloseTo(500, 2);
  });

  it("handles negative to positive transition", () => {
    const from = makeSnapshot({ total_net_worth: -500, snapshot_date: "2024-01-01" });
    const to = makeSnapshot({ id: "snap-2", total_net_worth: 200, snapshot_date: "2024-02-01" });

    const result = computeDelta(from, to);

    expect(result.absolute).toBe(700);
    // (700 / 500) * 100 = 140%
    expect(result.percentage).toBeCloseTo(140, 2);
  });

  it("handles positive to negative transition", () => {
    const from = makeSnapshot({ total_net_worth: 500, snapshot_date: "2024-01-01" });
    const to = makeSnapshot({ id: "snap-2", total_net_worth: -300, snapshot_date: "2024-02-01" });

    const result = computeDelta(from, to);

    expect(result.absolute).toBe(-800);
    // (-800 / 500) * 100 = -160%
    expect(result.percentage).toBeCloseTo(-160, 2);
  });

  it("references correct snapshot objects in result", () => {
    const from = makeSnapshot({ id: "from-snap" });
    const to = makeSnapshot({ id: "to-snap" });

    const result = computeDelta(from, to);

    expect(result.fromSnapshot.id).toBe("from-snap");
    expect(result.toSnapshot.id).toBe("to-snap");
  });
});

describe("getLastMonthSnapshot", () => {
  it("returns null when snapshots array is empty", () => {
    const result = getLastMonthSnapshot([]);
    expect(result).toBeNull();
  });

  it("returns null when no snapshot exists for last month", () => {
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
    const snapshots = [
      makeSnapshot({
        snapshot_date: twoMonthsAgo.toISOString().split("T")[0],
        total_net_worth: 1000,
      }),
    ];

    const result = getLastMonthSnapshot(snapshots);
    expect(result).toBeNull();
  });

  it("finds snapshot from last month matching year and month", () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);
    const monthStr = lastMonth.toISOString().split("T")[0];

    const snapshots = [
      makeSnapshot({ id: "older", snapshot_date: "2020-01-15", total_net_worth: 500 }),
      makeSnapshot({ id: "last-month", snapshot_date: monthStr, total_net_worth: 1200 }),
      makeSnapshot({ id: "current-month", snapshot_date: now.toISOString().split("T")[0], total_net_worth: 1500 }),
    ];

    const result = getLastMonthSnapshot(snapshots);
    expect(result).not.toBeNull();
    const r = result as SnapshotRow;
    expect(r.id).toBe("last-month");
  });

  it("returns most recent snapshot when multiple exist for last month", () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const monthStr = lastMonth.toISOString().split("T")[0];
    // Use different snapshot dates so the sort by date works correctly
    const snapshots = [
      makeSnapshot({ id: "early-month", snapshot_date: `${monthStr}T10:00:00Z`, total_net_worth: 1000 }),
      makeSnapshot({ id: "late-month", snapshot_date: `${monthStr}T15:00:00Z`, total_net_worth: 1500 }),
    ];

    const result = getLastMonthSnapshot(snapshots);
    expect(result).not.toBeNull();
    const r = result as SnapshotRow;
    expect(r.id).toBe("late-month");
  });

  it("returns null when snapshot_date is invalid", () => {
    const snapshots = [makeSnapshot({ snapshot_date: "not-a-date" })];

    const result = getLastMonthSnapshot(snapshots);
    // Invalid date results in NaN comparison, which will not match
    expect(result).toBeNull();
  });
});

describe("getYearStartSnapshot", () => {
  it("returns null when snapshots array is empty", () => {
    const result = getYearStartSnapshot([]);
    expect(result).toBeNull();
  });

  it("returns null when no snapshot exists for year start", () => {
    const snapshots = [makeSnapshot({ snapshot_date: "2022-06-15", total_net_worth: 500 })];

    const result = getYearStartSnapshot(snapshots);
    expect(result).toBeNull();
  });

  it("returns most recent snapshot from current year (last month wins)", () => {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0];

    const snapshots = [
      makeSnapshot({ id: "old-year", snapshot_date: "2022-01-01", total_net_worth: 500 }),
      makeSnapshot({ id: "year-start", snapshot_date: jan1, total_net_worth: 2000 }),
      makeSnapshot({ id: "mid-year", snapshot_date: `${now.getFullYear()}-06-15`, total_net_worth: 2500 }),
    ];

    const result = getYearStartSnapshot(snapshots);
    expect(result).not.toBeNull();
    const r = result as SnapshotRow;
    expect(r.id).toBe("mid-year");
  });

  it("returns most recent snapshot on Jan 1st when multiple exist", () => {
    const now = new Date();
    // Use different snapshot dates on Jan 1st so the sort picks the most recent
    const snapshots = [
      makeSnapshot({ id: "first-jan", snapshot_date: `${now.getFullYear()}-01-01T10:00:00Z`, total_net_worth: 1000 }),
      makeSnapshot({ id: "updated-jan", snapshot_date: `${now.getFullYear()}-01-01T15:00:00Z`, total_net_worth: 3000 }),
    ];

    const result = getYearStartSnapshot(snapshots);
    expect(result).not.toBeNull();
    const r = result as SnapshotRow;
    expect(r.id).toBe("updated-jan");
    expect(r.total_net_worth).toBe(3000);
  });

  it("returns null when only snapshots from other years exist", () => {
    const snapshots = [
      makeSnapshot({ id: "december", snapshot_date: "2022-12-31", total_net_worth: 5000 }),
      makeSnapshot({ id: "jan-snap", snapshot_date: "2022-01-01", total_net_worth: 1000 }),
    ];

    const result = getYearStartSnapshot(snapshots);
    expect(result).toBeNull();
  });

  it("returns null for invalid date string", () => {
    const snapshots = [makeSnapshot({ snapshot_date: "invalid-date" })];

    const result = getYearStartSnapshot(snapshots);
    expect(result).toBeNull();
  });
});
