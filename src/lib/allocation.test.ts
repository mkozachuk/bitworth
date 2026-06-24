import { describe, expect, it } from "vitest";
import type { Currency } from "@/lib/net-worth";
import type { AllocationAsset, ShareAsset } from "@/lib/allocation";
import { assetSharePct, computeAllocation, totalAssetPool } from "@/lib/allocation";

// Pins the allocation math against oracles computed from first principles —
// never by reading the implementation. Percentages run on a 0–100 scale
// end-to-end with NO ×100/÷100 conversion anywhere; a 333.33-class probe guards
// that scaling-bug class.
//
// FP discipline (house style, src/lib/fire.test.ts): `toBe` for provably-exact
// integers and short-circuits (totalSelected of integer values, empty-set
// guards, null returns); `toBeCloseTo(_, 6)` for any division.

// Clean, explicit rates so oracles are unambiguous. convertAmount semantics:
//   inUSD = amount / rates[from]; result = inUSD * rates[to].
// So with these literals: 100 EUR → 100/2 * 1 = 50 USD; 100 PLN → 100/4 * 1 = 25 USD.
const rates: Record<Currency, number> = { USD: 1, EUR: 2, PLN: 4 };

// A complete selected asset; individual tests override only what they exercise.
function asset(overrides: Partial<AllocationAsset> = {}): AllocationAsset {
  return {
    asset_id: "a1",
    name: "Asset 1",
    amount: 100,
    currency: "USD",
    targetPct: 50,
    ...overrides,
  };
}

describe("computeAllocation", () => {
  it("returns a guarded empty result for an empty selected set", () => {
    const r = computeAllocation([], "USD", rates);
    expect(r.slices).toEqual([]);
    expect(r.totalSelected).toBe(0);
    expect(r.declaredSum).toBe(0);
  });

  it("reports 100% real for a single selected asset", () => {
    const r = computeAllocation([asset({ amount: 100, currency: "USD", targetPct: 70 })], "USD", rates);
    expect(r.totalSelected).toBe(100);
    expect(r.slices).toHaveLength(1);
    expect(r.slices[0].value).toBe(100);
    expect(r.slices[0].targetPct).toBe(70); // raw entered target, not normalized
    expect(r.slices[0].realPct).toBeCloseTo(100, 6);
  });

  it("converts each asset into the display currency before computing real shares", () => {
    // A: 100 USD → 100 USD ; B: 100 EUR → 100/2 = 50 USD ; total = 150 USD.
    // realPct A = 100/150*100 = 66.666... ; B = 50/150*100 = 33.333...
    const r = computeAllocation(
      [
        asset({ asset_id: "a", name: "A", amount: 100, currency: "USD", targetPct: 60 }),
        asset({ asset_id: "b", name: "B", amount: 100, currency: "EUR", targetPct: 40 }),
      ],
      "USD",
      rates,
    );
    expect(r.totalSelected).toBeCloseTo(150, 6);
    expect(r.slices[0].value).toBeCloseTo(100, 6);
    expect(r.slices[1].value).toBeCloseTo(50, 6);
    expect(r.slices[0].realPct).toBeCloseTo((100 / 150) * 100, 6);
    expect(r.slices[1].realPct).toBeCloseTo((50 / 150) * 100, 6);
  });

  it("preserves input order so slice i is the same asset in both pies", () => {
    const r = computeAllocation(
      [
        asset({ asset_id: "x", name: "X", amount: 10 }),
        asset({ asset_id: "y", name: "Y", amount: 20 }),
        asset({ asset_id: "z", name: "Z", amount: 30 }),
      ],
      "USD",
      rates,
    );
    expect(r.slices.map((s) => s.asset_id)).toEqual(["x", "y", "z"]);
  });

  it("surfaces a declared-targets sum that is not 100 (non-blocking flag)", () => {
    const r = computeAllocation(
      [asset({ asset_id: "a", targetPct: 50 }), asset({ asset_id: "b", targetPct: 30 })],
      "USD",
      rates,
    );
    expect(r.declaredSum).toBe(80); // raw targets, not clamped to 100
  });

  it("yields null real shares when selected values sum below EPSILON", () => {
    // Both amounts 0 → totalSelected 0 → realPct null, but declaredSum still computed.
    const r = computeAllocation(
      [asset({ asset_id: "a", amount: 0, targetPct: 60 }), asset({ asset_id: "b", amount: 0, targetPct: 40 })],
      "USD",
      rates,
    );
    expect(r.totalSelected).toBe(0);
    expect(r.slices[0].realPct).toBeNull();
    expect(r.slices[1].realPct).toBeNull();
    expect(r.declaredSum).toBe(100);
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // A 33333.33 of a 100000.00 total → realPct 33.33333; a ×100/÷100 bug lands
    // two orders off and fails even a coarse comparison.
    const r = computeAllocation(
      [
        asset({ asset_id: "a", amount: 33_333.33, currency: "USD", targetPct: 33 }),
        asset({ asset_id: "b", amount: 66_666.67, currency: "USD", targetPct: 67 }),
      ],
      "USD",
      rates,
    );
    expect(r.totalSelected).toBeCloseTo(100_000, 6);
    expect(r.slices[0].realPct).toBeCloseTo((33_333.33 / 100_000) * 100, 6);
  });
});

describe("totalAssetPool", () => {
  function shareAsset(overrides: Partial<ShareAsset> = {}): ShareAsset {
    return { amount: 100, currency: "USD", is_liability: false, ...overrides };
  }

  it("sums positive non-liability converted values", () => {
    // 100 USD + (100 EUR → 50 USD) = 150 USD.
    const total = totalAssetPool(
      [shareAsset({ amount: 100, currency: "USD" }), shareAsset({ amount: 100, currency: "EUR" })],
      "USD",
      rates,
    );
    expect(total).toBeCloseTo(150, 6);
  });

  it("excludes liabilities from the pool", () => {
    const total = totalAssetPool(
      [
        shareAsset({ amount: 100, currency: "USD", is_liability: false }),
        shareAsset({ amount: 200, currency: "USD", is_liability: true }),
      ],
      "USD",
      rates,
    );
    expect(total).toBe(100);
  });

  it("excludes non-positive values from the pool", () => {
    const total = totalAssetPool(
      [shareAsset({ amount: 100 }), shareAsset({ amount: 0 }), shareAsset({ amount: -50 })],
      "USD",
      rates,
    );
    expect(total).toBe(100);
  });
});

describe("assetSharePct", () => {
  it("computes a value's share of the pool on a 0–100 scale", () => {
    // 50 / 200 * 100 = 25
    expect(assetSharePct(50, 200)).toBeCloseTo(25, 6);
  });

  it("returns null when the pool sums below EPSILON (no meaningful denominator)", () => {
    expect(assetSharePct(50, 0)).toBeNull();
    expect(assetSharePct(50, 0.005)).toBeNull();
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    expect(assetSharePct(33_333.33, 100_000)).toBeCloseTo((33_333.33 / 100_000) * 100, 6);
  });
});
