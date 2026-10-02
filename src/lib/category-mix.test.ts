import { describe, expect, it } from "vitest";
import { buildCategoryMix, type CategoryMixItem } from "@/lib/category-mix";

// M1: the category mix, pinned before any UI consumes it. Expected values are
// worked out from the rates below, not read off the implementation. Fixtures
// are synthetic.
//
// Rates are USD-denominated divisors (as in asset-trends.test.ts): EUR = 2 means
// 200 EUR → 100 USD; PLN = 4 means 100 USD → 400 PLN.
const RATES: Record<"PLN" | "USD" | "EUR", number> = { USD: 1, EUR: 2, PLN: 4 };

const CASH = { category_id: "cat-cash", category_name: "Cash", category_order: 1, is_liability: false };
const STOCKS = { category_id: "cat-stocks", category_name: "Stocks", category_order: 2, is_liability: false };
const CRYPTO = { category_id: "cat-crypto", category_name: "Crypto", category_order: 3, is_liability: false };
const LOAN = { category_id: "cat-loan", category_name: "Loan", category_order: 9, is_liability: true };

function item(
  snapshot: number,
  category: typeof CASH,
  amount: number,
  currency: "USD" | "EUR" | "PLN" = "USD",
): CategoryMixItem {
  return {
    snapshotId: `snap-${snapshot}`,
    snapshotDate: `2026-0${snapshot}-01T00:00:00Z`,
    ...category,
    original_amount: amount,
    original_currency: currency,
  };
}

function shareSum(share: Record<string, number> | null): number {
  return Object.values(share ?? {}).reduce((a, b) => a + b, 0);
}

describe("buildCategoryMix", () => {
  it("sums items by category_id per snapshot, one row per snapshot", () => {
    const mix = buildCategoryMix(
      [item(1, CASH, 100), item(1, CASH, 50), item(1, STOCKS, 350), item(2, CASH, 200)],
      "USD",
      RATES,
    );
    expect(mix.rows.map((r) => r.snapshotId)).toEqual(["snap-1", "snap-2"]);
    expect(mix.rows[0].absolute).toEqual({ "cat-cash": 150, "cat-stocks": 350 });
    expect(mix.rows[0].share).toEqual({ "cat-cash": 30, "cat-stocks": 70 });
  });

  it("groups by the category id, not its name", () => {
    const renamed = { ...CASH, category_id: "cat-cash-2" }; // same name, different FK
    const mix = buildCategoryMix([item(1, CASH, 100), item(1, renamed, 300)], "USD", RATES);
    expect(mix.categories.map((c) => c.id)).toEqual(["cat-cash", "cat-cash-2"]);
    expect(mix.rows[0].absolute).toEqual({ "cat-cash": 100, "cat-cash-2": 300 });
  });

  it("zero-fills a category that appears late and one that disappears", () => {
    // Crypto appears at snapshot 2; Stocks is gone from snapshot 3.
    const mix = buildCategoryMix(
      [
        item(1, CASH, 100),
        item(1, STOCKS, 100),
        item(2, CASH, 100),
        item(2, STOCKS, 100),
        item(2, CRYPTO, 200),
        item(3, CASH, 100),
        item(3, CRYPTO, 300),
      ],
      "USD",
      RATES,
    );
    expect(mix.rows.map((r) => r.absolute)).toEqual([
      { "cat-cash": 100, "cat-stocks": 100, "cat-crypto": 0 },
      { "cat-cash": 100, "cat-stocks": 100, "cat-crypto": 200 },
      { "cat-cash": 100, "cat-stocks": 0, "cat-crypto": 300 },
    ]);
    expect(mix.rows.map((r) => r.share)).toEqual([
      { "cat-cash": 50, "cat-stocks": 50, "cat-crypto": 0 },
      { "cat-cash": 25, "cat-stocks": 25, "cat-crypto": 50 },
      { "cat-cash": 25, "cat-stocks": 0, "cat-crypto": 75 },
    ]);
    // Every row carries every key, so a stacked area never sees undefined.
    for (const row of mix.rows) {
      expect(Object.keys(row.absolute).sort()).toEqual(["cat-cash", "cat-crypto", "cat-stocks"]);
    }
  });

  it("a liability is negative in the absolute view and absent from the share view", () => {
    const mix = buildCategoryMix([item(1, CASH, 300), item(1, STOCKS, 100), item(1, LOAN, 250)], "USD", RATES);
    const [row] = mix.rows;
    expect(row.absolute["cat-loan"]).toBe(-250);
    expect(row.share).not.toBeNull();
    expect(row.share).not.toHaveProperty("cat-loan");
    // The liability does not shrink the denominator: shares are of the 400 of assets.
    expect(row.share).toEqual({ "cat-cash": 75, "cat-stocks": 25 });
    expect(mix.categories.find((c) => c.id === "cat-loan")?.isLiability).toBe(true);
  });

  it("orders asset categories before liabilities, each by display_order", () => {
    const first = { ...LOAN, category_id: "cat-card", category_name: "Card", category_order: 0 };
    const mix = buildCategoryMix(
      [item(1, LOAN, 10), item(1, CRYPTO, 10), item(1, first, 10), item(1, CASH, 10)],
      "USD",
      RATES,
    );
    expect(mix.categories.map((c) => c.id)).toEqual(["cat-cash", "cat-crypto", "cat-card", "cat-loan"]);
  });

  it.each([
    ["two categories, thirds", [item(1, CASH, 100), item(1, STOCKS, 200)]],
    ["three equal categories (1/3 each)", [item(1, CASH, 1), item(1, STOCKS, 1), item(1, CRYPTO, 1)]],
    [
      "awkward amounts in mixed currencies",
      [item(1, CASH, 123.45, "PLN"), item(1, STOCKS, 67.89, "EUR"), item(1, CRYPTO, 0.07)],
    ],
    ["with a liability present", [item(1, CASH, 7), item(1, CRYPTO, 13), item(1, LOAN, 999)]],
    ["one asset category", [item(1, CASH, 42)]],
  ])("shares sum to 100 ± 0.01 per snapshot with assets: %s", (_label, items) => {
    const [row] = buildCategoryMix(items, "USD", RATES).rows;
    expect(row.share).not.toBeNull();
    expect(Math.abs(shareSum(row.share) - 100)).toBeLessThanOrEqual(0.01);
  });

  it("a snapshot holding only liabilities has a null share row and no NaN or Infinity", () => {
    const mix = buildCategoryMix([item(1, CASH, 100), item(2, LOAN, 500)], "USD", RATES);
    const row = mix.rows[1];
    expect(row.share).toBeNull();
    // Its absolute row is real: the liability, and the zero-filled asset.
    expect(row.absolute).toEqual({ "cat-cash": 0, "cat-loan": -500 });
    for (const r of mix.rows) {
      for (const v of [...Object.values(r.absolute), ...Object.values(r.share ?? {})]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("assets summing to 0 (below EPSILON) also give a null share row, never a division by 0", () => {
    const [row] = buildCategoryMix([item(1, CASH, 0), item(1, STOCKS, 0.001)], "USD", RATES).rows;
    expect(row.share).toBeNull();
  });

  it("currency switch: values follow the display currency, shares do not move", () => {
    const items = [item(1, CASH, 200, "EUR"), item(1, STOCKS, 300, "USD"), item(1, LOAN, 400, "PLN")];
    const usd = buildCategoryMix(items, "USD", RATES).rows[0];
    const pln = buildCategoryMix(items, "PLN", RATES).rows[0];
    // 200 EUR = 100 USD = 400 PLN; 300 USD = 1200 PLN; 400 PLN = 100 USD.
    expect(usd.absolute).toEqual({ "cat-cash": 100, "cat-stocks": 300, "cat-loan": -100 });
    expect(pln.absolute).toEqual({ "cat-cash": 400, "cat-stocks": 1200, "cat-loan": -400 });
    expect(usd.share).toEqual({ "cat-cash": 25, "cat-stocks": 75 });
    expect(pln.share).toEqual(usd.share);
  });

  it("currency switch: a holding re-recorded in another currency fabricates no movement", () => {
    // The same 100 USD of cash, recorded as 200 EUR before and 100 USD after.
    const mix = buildCategoryMix([item(1, CASH, 200, "EUR"), item(2, CASH, 100, "USD")], "USD", RATES);
    expect(mix.rows.map((r) => r.absolute["cat-cash"])).toEqual([100, 100]);
  });

  it("unsorted input gives the same result as sorted input and is not mutated", () => {
    const sorted = [
      item(1, CASH, 100),
      item(1, LOAN, 10),
      item(2, STOCKS, 100),
      item(2, CASH, 300),
      item(3, CRYPTO, 50),
    ];
    const shuffled = [sorted[4], sorted[1], sorted[3], sorted[0], sorted[2]];
    const before = JSON.stringify(shuffled);
    const a = buildCategoryMix(sorted, "USD", RATES);
    const b = buildCategoryMix(shuffled, "USD", RATES);
    expect(b).toEqual(a);
    expect(b.rows.map((r) => r.date)).toEqual(["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"]);
    expect(JSON.stringify(shuffled)).toBe(before);
  });

  it("orders rows by instant, not by string, across timezone offsets", () => {
    const a = { ...item(1, CASH, 1), snapshotId: "a", snapshotDate: "2026-01-01T10:00:00+05:00" }; // 05:00Z
    const b = { ...item(1, CASH, 2), snapshotId: "b", snapshotDate: "2026-01-01T06:00:00Z" };
    const mix = buildCategoryMix([b, a], "USD", RATES);
    expect(mix.rows.map((r) => r.snapshotId)).toEqual(["a", "b"]);
  });

  it("no items gives no categories and no rows", () => {
    expect(buildCategoryMix([], "USD", RATES)).toEqual({ categories: [], rows: [] });
  });
});
