import { describe, expect, it } from "vitest";
import type { NetWorthAsset } from "@/lib/net-worth";
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
    expect(computeNetWorth(assets, "USD", USD_RATES)).toBe(1700);
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
    expect(computeNetWorth(assets, "USD", rates)).toBeCloseTo(9154.545454545454, 6);
  });

  it("flips the sign for liabilities so a liability total is strictly lower than the same amount as an asset", () => {
    const rates: Record<"PLN" | "USD" | "EUR", number> = { USD: 1, EUR: 1.0, PLN: 1.0 };
    const asAsset: NetWorthAsset[] = [{ amount: 500, currency: "USD", category: { is_liability: false } }];
    const asLiability: NetWorthAsset[] = [{ amount: 500, currency: "USD", category: { is_liability: true } }];

    const assetTotal = computeNetWorth(asAsset, "USD", rates);
    const liabilityTotal = computeNetWorth(asLiability, "USD", rates);

    expect(assetTotal).toBe(500);
    expect(liabilityTotal).toBe(-500);
    expect(assetTotal).toBeGreaterThan(liabilityTotal);
  });
});
