import { describe, expect, it } from "vitest";
import type { NetWorthAsset, NetWorthBreakdown } from "@/lib/net-worth";
import { computeNetWorth } from "@/lib/net-worth";

// Pins the post-refactor behaviour of computeNetWorth against an independent
// oracle. Each test case derives its expected value from first principles
// (rates and formula) — not by reading the implementation.
//
// The fixtures use plain `number` amounts. The `assets.amount` column is
// NUMERIC(18, 2) with no cent scaling in the source; the non-round 333.33-class
// value in the FP probe catches any future ×100/÷100 regression.
//
// Crypto valuation is intentionally NOT asserted: the net worth path does not
// call getPrice(); the `quantity` column is a display label only.

const USD_RATES: Record<"PLN" | "USD" | "EUR", number> = { USD: 1, EUR: 1.0, PLN: 4.0 };

describe("computeNetWorth", () => {
  it("returns the exact oracle for mixed-currency inputs", () => {
    const assets: NetWorthAsset[] = [
      { amount: 1000, currency: "USD", category: { is_liability: false } },
      { amount: 500, currency: "EUR", category: { is_liability: false } },
      { amount: 2000, currency: "PLN", category: { is_liability: false } },
      { amount: 300, currency: "USD", category: { is_liability: true } },
    ];

    // 1000 USD (short-circuit) + 500/1.0*1 + 2000/4.0*1 - 300 = 1000 + 500 + 500 - 300 = 1700
    expect(computeNetWorth(assets, "USD", USD_RATES).netWorth).toBe(1700);
  });

  it("handles non-round rates via the conversion branch", () => {
    const rates: Record<"PLN" | "USD" | "EUR", number> = { USD: 1, EUR: 1.1, PLN: 0.25 };
    const assets: NetWorthAsset[] = [
      { amount: 1000, currency: "USD", category: { is_liability: false } },
      { amount: 500, currency: "EUR", category: { is_liability: false } },
      { amount: 2000, currency: "PLN", category: { is_liability: false } },
      { amount: 300, currency: "USD", category: { is_liability: true } },
    ];

    // 1000 + 500/1.1 + 2000/0.25 - 300 = 1000 + 454.5454... + 8000 - 300 = 9154.545454545454...
    expect(computeNetWorth(assets, "USD", rates).netWorth).toBeCloseTo(9154.545454545454, 6);
  });

  it("flips the sign for liabilities so a liability total is strictly lower than the same amount as an asset", () => {
    const rates: Record<"PLN" | "USD" | "EUR", number> = { USD: 1, EUR: 1.0, PLN: 1.0 };
    const asAsset: NetWorthAsset[] = [{ amount: 500, currency: "USD", category: { is_liability: false } }];
    const asLiability: NetWorthAsset[] = [{ amount: 500, currency: "USD", category: { is_liability: true } }];

    const assetTotal = computeNetWorth(asAsset, "USD", rates).netWorth;
    const liabilityTotal = computeNetWorth(asLiability, "USD", rates).netWorth;

    expect(assetTotal).toBe(500);
    expect(liabilityTotal).toBe(-500);
    expect(assetTotal).toBeGreaterThan(liabilityTotal);
  });
});

// Breakdown fixtures. Oracles are hand-computed from the rates, not read from
// the implementation.
type Rates = Record<"PLN" | "USD" | "EUR", number>;
const NON_ROUND_RATES: Rates = { USD: 1, EUR: 1.1, PLN: 0.25 };
const MIXED: NetWorthAsset[] = [
  { amount: 1000, currency: "USD", category: { is_liability: false } },
  { amount: 500, currency: "EUR", category: { is_liability: false } },
  { amount: 2000, currency: "PLN", category: { is_liability: false } },
  { amount: 300, currency: "USD", category: { is_liability: true } },
];
const ASSETS_ONLY: NetWorthAsset[] = [
  { amount: 1000, currency: "USD", category: { is_liability: false } },
  { amount: 400, currency: "PLN", category: { is_liability: false } },
];
const LIABILITIES_ONLY: NetWorthAsset[] = [
  { amount: 400, currency: "PLN", category: { is_liability: true } },
  { amount: 100, currency: "EUR", category: { is_liability: true } },
];
const MIXED_LIABILITIES: NetWorthAsset[] = [
  { amount: 250, currency: "EUR", category: { is_liability: false } },
  { amount: 800, currency: "PLN", category: { is_liability: true } },
  { amount: 50, currency: "USD", category: { is_liability: true } },
];

describe("computeNetWorth breakdown", () => {
  it("splits a mixed-currency fixture into assets and liabilities", () => {
    // Assets: 1000 + 500/1.0 + 2000/4.0 = 2000. Liabilities: 300.
    const result = computeNetWorth(MIXED, "USD", USD_RATES);
    expect(result).toEqual<NetWorthBreakdown>({ totalAssets: 2000, totalLiabilities: 300, netWorth: 1700 });
  });

  it("splits a mixed-currency fixture with several liabilities and a non-USD display currency", () => {
    // Display EUR, rates USD 1 / EUR 1.0 / PLN 4.0.
    // Assets: 250 EUR (short-circuit) = 250.
    // Liabilities: 800 PLN -> 800/4*1 = 200; 50 USD -> 50/1*1 = 50; total 250.
    const result = computeNetWorth(MIXED_LIABILITIES, "EUR", USD_RATES);
    expect(result.totalAssets).toBe(250);
    expect(result.totalLiabilities).toBe(250);
    expect(result.netWorth).toBe(0);
  });

  it("splits the non-round-rate fixture", () => {
    // Assets: 1000 + 500/1.1 + 2000/0.25 = 9454.545454...; Liabilities: 300.
    const result = computeNetWorth(MIXED, "USD", NON_ROUND_RATES);
    expect(result.totalAssets).toBeCloseTo(9454.545454545454, 6);
    expect(result.totalLiabilities).toBe(300);
  });

  it("returns zero liabilities for an assets-only fixture", () => {
    // 1000 USD + 400 PLN / 4.0 = 1100.
    expect(computeNetWorth(ASSETS_ONLY, "USD", USD_RATES)).toEqual<NetWorthBreakdown>({
      totalAssets: 1100,
      totalLiabilities: 0,
      netWorth: 1100,
    });
  });

  it("returns zero assets and a negative net worth for a liabilities-only fixture", () => {
    // 400 PLN / 4.0 + 100 EUR / 1.0 = 200.
    expect(computeNetWorth(LIABILITIES_ONLY, "USD", USD_RATES)).toEqual<NetWorthBreakdown>({
      totalAssets: 0,
      totalLiabilities: 200,
      netWorth: -200,
    });
  });

  it("returns all zeros for empty input", () => {
    expect(computeNetWorth([], "USD", USD_RATES)).toEqual<NetWorthBreakdown>({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    });
  });
});

describe("computeNetWorth breakdown identity", () => {
  const unitRates: Rates = { USD: 1, EUR: 1.0, PLN: 1.0 };
  const cases: [string, NetWorthAsset[], "USD" | "EUR" | "PLN", Rates][] = [
    ["mixed, round rates", MIXED, "USD", USD_RATES],
    ["mixed, non-round rates", MIXED, "USD", NON_ROUND_RATES],
    ["single asset", [{ amount: 500, currency: "USD", category: { is_liability: false } }], "USD", unitRates],
    ["single liability", [{ amount: 500, currency: "USD", category: { is_liability: true } }], "USD", unitRates],
    ["mixed liabilities, EUR display", MIXED_LIABILITIES, "EUR", USD_RATES],
    ["assets only", ASSETS_ONLY, "USD", USD_RATES],
    ["liabilities only", LIABILITIES_ONLY, "USD", USD_RATES],
    ["empty", [], "USD", USD_RATES],
  ];

  it.each(cases)("netWorth === totalAssets - totalLiabilities exactly (%s)", (_name, assets, currency, rates) => {
    const { totalAssets, totalLiabilities, netWorth } = computeNetWorth(assets, currency, rates);
    expect(netWorth).toBe(totalAssets - totalLiabilities);
  });
});
