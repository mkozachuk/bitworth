import { describe, expect, it } from "vitest";
import type { MoverAsset, MoverBaselineItem } from "@/lib/movers";
import { computeMovers } from "@/lib/movers";

// Pins the (name, category_id) matching and the signed-contribution math before
// any UI consumes computeMovers. Each expected value is derived from first
// principles (the rates below and the contribution formula), not by reading the
// implementation.
//
// Rates are chosen so USD<->USD short-circuits but EUR carries a real
// conversion (1 EUR = 0.5 USD here): convertAmount(amt, EUR, USD) = amt / 2.

const RATES: Record<"PLN" | "USD" | "EUR", number> = { USD: 1, EUR: 2.0, PLN: 4.0 };

function asset(over: Partial<MoverAsset>): MoverAsset {
  return {
    name: "Asset",
    category_id: "cat",
    amount: 0,
    currency: "USD",
    is_liability: false,
    icon: null,
    ...over,
  };
}

function baselineItem(over: Partial<MoverBaselineItem>): MoverBaselineItem {
  return {
    name: "Asset",
    category_id: "cat",
    original_amount: 0,
    original_currency: "USD",
    is_liability: false,
    ...over,
  };
}

describe("computeMovers", () => {
  it("ranks a plain gainer and a plain loser by absolute amount", () => {
    const current = [
      asset({ name: "Stocks", amount: 1500 }),
      asset({ name: "Cash", category_id: "cash", amount: 400 }),
    ];
    const baseline = [
      baselineItem({ name: "Stocks", original_amount: 1000 }),
      baselineItem({ name: "Cash", category_id: "cash", original_amount: 500 }),
    ];

    const { gainers, losers } = computeMovers(current, baseline, "USD", RATES);

    expect(gainers).toEqual([{ name: "Stocks", icon: null, change: 500, pct: 50 }]);
    expect(losers).toEqual([{ name: "Cash", icon: null, change: -100, pct: -20 }]);
  });

  it("surfaces a shrinking liability as a gainer (sign handling)", () => {
    const current = [asset({ name: "Mortgage", is_liability: true, amount: 200 })];
    const baseline = [baselineItem({ name: "Mortgage", is_liability: true, original_amount: 500 })];

    const { gainers, losers } = computeMovers(current, baseline, "USD", RATES);

    // contribution: -200 - (-500) = +300; pct = 300 / |-500| * 100 = 60
    expect(gainers).toEqual([{ name: "Mortgage", icon: null, change: 300, pct: 60 }]);
    expect(losers).toEqual([]);
  });

  it("surfaces a growing liability as a loser (sign handling)", () => {
    const current = [asset({ name: "Mortgage", is_liability: true, amount: 800 })];
    const baseline = [baselineItem({ name: "Mortgage", is_liability: true, original_amount: 500 })];

    const { gainers, losers } = computeMovers(current, baseline, "USD", RATES);

    // contribution: -800 - (-500) = -300; pct = -300 / |-500| * 100 = -60
    expect(losers).toEqual([{ name: "Mortgage", icon: null, change: -300, pct: -60 }]);
    expect(gainers).toEqual([]);
  });

  it("matches across a currency change and reports the real holding delta", () => {
    // baseline 200 EUR = 100 USD at today's rates; current 150 USD.
    const current = [asset({ name: "Brokerage", amount: 150, currency: "USD" })];
    const baseline = [baselineItem({ name: "Brokerage", original_amount: 200, original_currency: "EUR" })];

    const { gainers, losers } = computeMovers(current, baseline, "USD", RATES);

    // 150 - 100 = +50; pct = 50 / 100 * 100 = 50
    expect(gainers).toEqual([{ name: "Brokerage", icon: null, change: 50, pct: 50 }]);
    expect(losers).toEqual([]);
  });

  it("puts an unmatched current asset in newAssets, never in gainers/losers", () => {
    const current = [asset({ name: "Crypto", amount: 700 })];
    const baseline: MoverBaselineItem[] = [];

    const { gainers, losers, newAssets } = computeMovers(current, baseline, "USD", RATES);

    expect(newAssets).toEqual([{ name: "Crypto", icon: null, value: 700 }]);
    expect(gainers).toEqual([]);
    expect(losers).toEqual([]);
  });

  it("drops a baseline item with no current match from all three lists", () => {
    const current = [asset({ name: "Stocks", amount: 1200 })];
    const baseline = [
      baselineItem({ name: "Stocks", original_amount: 1000 }),
      baselineItem({ name: "Sold", category_id: "sold", original_amount: 9999 }),
    ];

    const { gainers, losers, newAssets } = computeMovers(current, baseline, "USD", RATES);

    expect(gainers).toEqual([{ name: "Stocks", icon: null, change: 200, pct: 20 }]);
    expect(losers).toEqual([]);
    expect(newAssets).toEqual([]);
    expect([...gainers, ...losers].some((m) => m.name === "Sold")).toBe(false);
  });

  it("suppresses pct (null) for a near-zero baseline but still ranks the row by amount", () => {
    const current = [asset({ name: "Fresh", amount: 300 })];
    const baseline = [baselineItem({ name: "Fresh", original_amount: 0 })];

    const { gainers } = computeMovers(current, baseline, "USD", RATES);

    expect(gainers).toEqual([{ name: "Fresh", icon: null, change: 300, pct: null }]);
  });

  it("excludes an unchanged asset (|change| < EPSILON) from both lists", () => {
    const current = [asset({ name: "Flat", amount: 1000 })];
    const baseline = [baselineItem({ name: "Flat", original_amount: 1000 })];

    const { gainers, losers } = computeMovers(current, baseline, "USD", RATES);

    expect(gainers).toEqual([]);
    expect(losers).toEqual([]);
  });

  it("caps each list to the limit and keeps the top by absolute change", () => {
    const current = [
      asset({ name: "G100", category_id: "g1", amount: 1100 }),
      asset({ name: "G200", category_id: "g2", amount: 1200 }),
      asset({ name: "G300", category_id: "g3", amount: 1300 }),
      asset({ name: "G400", category_id: "g4", amount: 1400 }),
      asset({ name: "G500", category_id: "g5", amount: 1500 }),
    ];
    const baseline = [
      baselineItem({ name: "G100", category_id: "g1", original_amount: 1000 }),
      baselineItem({ name: "G200", category_id: "g2", original_amount: 1000 }),
      baselineItem({ name: "G300", category_id: "g3", original_amount: 1000 }),
      baselineItem({ name: "G400", category_id: "g4", original_amount: 1000 }),
      baselineItem({ name: "G500", category_id: "g5", original_amount: 1000 }),
    ];

    const { gainers } = computeMovers(current, baseline, "USD", RATES);

    expect(gainers).toHaveLength(3);
    expect(gainers.map((g) => g.name)).toEqual(["G500", "G400", "G300"]);
  });

  it("returns empty lists for empty current and empty baseline without throwing", () => {
    expect(computeMovers([], [], "USD", RATES)).toEqual({ gainers: [], losers: [], newAssets: [] });
  });
});
