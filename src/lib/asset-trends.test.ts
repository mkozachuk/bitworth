import { describe, expect, it } from "vitest";
import type { TrendItem } from "@/lib/asset-trends";
import { assetColor, buildAssetTrends } from "@/lib/asset-trends";

// Pins the (name, category_id) grouping, the per-line indexed baseline, and the
// signed-contribution math before any UI consumes buildAssetTrends. Expected
// values are derived from first principles (the rates below and the
// contribution formula), not by reading the implementation.
//
// Rates mirror movers.test.ts: USD<->USD short-circuits but EUR carries a real
// conversion (1 EUR = 0.5 USD here): convertAmount(amt, EUR, USD) = amt / 2.
const RATES: Record<"PLN" | "USD" | "EUR", number> = { USD: 1, EUR: 2.0, PLN: 4.0 };

function item(over: Partial<TrendItem>): TrendItem {
  return {
    snapshotId: "s1",
    snapshotDate: "2026-01-01T00:00:00Z",
    name: "Asset",
    category_id: "cat",
    original_amount: 0,
    original_currency: "USD",
    is_liability: false,
    icon: null,
    ...over,
  };
}

describe("buildAssetTrends", () => {
  it("groups items by (name, category_id) into separate series", () => {
    const items = [
      item({ name: "Stocks", snapshotDate: "2026-01-01T00:00:00Z", original_amount: 1000 }),
      item({ name: "Stocks", snapshotDate: "2026-02-01T00:00:00Z", original_amount: 1200 }),
      item({ name: "Cash", category_id: "cash", snapshotDate: "2026-01-01T00:00:00Z", original_amount: 500 }),
    ];

    const series = buildAssetTrends(items, "USD", RATES);

    expect(series).toHaveLength(2);
    const stocks = series.find((s) => s.name === "Stocks");
    const cash = series.find((s) => s.name === "Cash");
    expect(stocks?.points.map((p) => p.value)).toEqual([1000, 1200]);
    expect(cash?.points.map((p) => p.value)).toEqual([500]);
  });

  it("sorts points ascending by snapshotDate regardless of input order", () => {
    const items = [
      item({ snapshotDate: "2026-03-01T00:00:00Z", original_amount: 300 }),
      item({ snapshotDate: "2026-01-01T00:00:00Z", original_amount: 100 }),
      item({ snapshotDate: "2026-02-01T00:00:00Z", original_amount: 200 }),
    ];

    const [series] = buildAssetTrends(items, "USD", RATES);

    expect(series.points.map((p) => p.date)).toEqual([
      "2026-01-01T00:00:00Z",
      "2026-02-01T00:00:00Z",
      "2026-03-01T00:00:00Z",
    ]);
    expect(series.points.map((p) => p.value)).toEqual([100, 200, 300]);
  });

  it("rebases each line to 100 at its OWN first present point (late-appearing asset)", () => {
    // A late-appearing asset's first snapshot is 800; it must read as 100, not
    // relative to some earlier global snapshot it was absent from.
    const items = [
      item({ name: "Late", snapshotDate: "2026-02-01T00:00:00Z", original_amount: 800 }),
      item({ name: "Late", snapshotDate: "2026-03-01T00:00:00Z", original_amount: 1200 }),
    ];

    const [series] = buildAssetTrends(items, "USD", RATES);

    expect(series.points.map((p) => p.indexed)).toEqual([100, 150]);
  });

  it("emits no point for a snapshot where the asset is absent (gap → null hole downstream)", () => {
    // Two snapshots exist globally, but the asset is only present in the first
    // and third. The builder must produce two points, not three — the island
    // maps the absent middle snapshot to null.
    const items = [
      item({ snapshotDate: "2026-01-01T00:00:00Z", original_amount: 100 }),
      item({ snapshotDate: "2026-03-01T00:00:00Z", original_amount: 300 }),
    ];

    const [series] = buildAssetTrends(items, "USD", RATES);

    expect(series.points.map((p) => p.date)).toEqual(["2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"]);
  });

  it("suppresses indexed (null) for a near-zero baseline but keeps the raw value", () => {
    const items = [
      item({ snapshotDate: "2026-01-01T00:00:00Z", original_amount: 0 }),
      item({ snapshotDate: "2026-02-01T00:00:00Z", original_amount: 500 }),
    ];

    const [series] = buildAssetTrends(items, "USD", RATES);

    expect(series.points.map((p) => p.indexed)).toEqual([null, null]);
    expect(series.points.map((p) => p.value)).toEqual([0, 500]);
  });

  it("plots a liability negative in absolute mode and indexes against abs(baseline)", () => {
    // contribution negates liabilities: -500 then -200 (debt paydown).
    // indexed against |−500| = 500: -500/500*100 = -100, -200/500*100 = -40.
    // A shrinking debt thus trends from -100 toward 0 — the natural direction.
    const items = [
      item({ name: "Mortgage", is_liability: true, snapshotDate: "2026-01-01T00:00:00Z", original_amount: 500 }),
      item({ name: "Mortgage", is_liability: true, snapshotDate: "2026-02-01T00:00:00Z", original_amount: 200 }),
    ];

    const [series] = buildAssetTrends(items, "USD", RATES);

    expect(series.is_liability).toBe(true);
    expect(series.points.map((p) => p.value)).toEqual([-500, -200]);
    expect(series.points.map((p) => p.indexed)).toEqual([-100, -40]);
  });

  it("does not fabricate movement when an early holding was recorded in another currency", () => {
    // 200 EUR = 100 USD at today's rate; later 100 USD. The holding is flat in
    // USD terms, so the indexed line must stay at 100 — not move because the
    // currency label changed.
    const items = [
      item({ snapshotDate: "2026-01-01T00:00:00Z", original_amount: 200, original_currency: "EUR" }),
      item({ snapshotDate: "2026-02-01T00:00:00Z", original_amount: 100, original_currency: "USD" }),
    ];

    const [series] = buildAssetTrends(items, "USD", RATES);

    expect(series.points.map((p) => p.value)).toEqual([100, 100]);
    expect(series.points.map((p) => p.indexed)).toEqual([100, 100]);
  });

  it("carries icon and is_liability from the grouped items onto the series", () => {
    const items = [item({ name: "Gold", icon: "🥇", is_liability: false, original_amount: 100 })];

    const [series] = buildAssetTrends(items, "USD", RATES);

    expect(series.icon).toBe("🥇");
    expect(series.is_liability).toBe(false);
    expect(series.category_id).toBe("cat");
  });

  it("returns an empty array for no items without throwing", () => {
    expect(buildAssetTrends([], "USD", RATES)).toEqual([]);
  });
});

describe("assetColor", () => {
  it("is deterministic — same index/total yields the same color", () => {
    expect(assetColor(2, 5)).toBe(assetColor(2, 5));
  });

  it("produces distinct hues for distinct indices in the same total", () => {
    const colors = [0, 1, 2, 3].map((i) => assetColor(i, 4));
    expect(new Set(colors).size).toBe(4);
  });

  it("spaces hues evenly around the wheel", () => {
    expect(assetColor(0, 4)).toBe("hsl(0, 65%, 50%)");
    expect(assetColor(1, 4)).toBe("hsl(90, 65%, 50%)");
    expect(assetColor(2, 4)).toBe("hsl(180, 65%, 50%)");
    expect(assetColor(3, 4)).toBe("hsl(270, 65%, 50%)");
  });

  it("does not divide by zero when total is 0", () => {
    expect(assetColor(0, 0)).toBe("hsl(0, 65%, 50%)");
  });
});
