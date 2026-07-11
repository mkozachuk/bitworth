import { describe, expect, it } from "vitest";
import type { Currency } from "@/lib/net-worth";
import type { AllocationAsset, AllocationSlice, DriftCardInput, ShareAsset } from "@/lib/allocation";
import {
  assetSharePct,
  computeAllocation,
  computeBuyPlan,
  computeDrift,
  DRIFT_THRESHOLD_PCT,
  totalAssetPool,
} from "@/lib/allocation";

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

describe("computeBuyPlan", () => {
  // computeBuyPlan operates on already-valued slices (value in display currency).
  function slice(overrides: Partial<AllocationSlice> = {}): AllocationSlice {
    return { asset_id: "a1", name: "Asset 1", value: 100, targetPct: 50, realPct: null, ...overrides };
  }

  // Narrowing wrapper: the null path is exercised by its own test, so the rest
  // can assert against a non-null plan without `!` (forbidden by eslint).
  function buyPlan(slices: AllocationSlice[], available: number) {
    const plan = computeBuyPlan(slices, available);
    if (plan === null) throw new Error("expected a non-null plan");
    return plan;
  }

  it("returns null when there is no positive target to plan against", () => {
    expect(computeBuyPlan([], 1000)).toBeNull();
    expect(computeBuyPlan([slice({ targetPct: 0 }), slice({ targetPct: 0 })], 1000)).toBeNull();
  });

  it("splits a budget across equal targets from an empty start", () => {
    // Both at 0 value, 50/50 targets, deploy 1000 → 500 each; final 50% each.
    const plan = buyPlan(
      [slice({ asset_id: "a", value: 0, targetPct: 50 }), slice({ asset_id: "b", value: 0, targetPct: 50 })],
      1000,
    );
    expect(plan.rows[0].buy).toBeCloseTo(500, 6);
    expect(plan.rows[1].buy).toBeCloseTo(500, 6);
    expect(plan.deployed).toBeCloseTo(1000, 6);
    expect(plan.leftover).toBeCloseTo(0, 6);
    expect(plan.finalTotal).toBeCloseTo(1000, 6);
    expect(plan.rows[0].finalPct).toBeCloseTo(50, 6);
  });

  it("buys only the deficit when one asset is underweight", () => {
    // A=100, B=0, targets 50/50, budget 100. finalTotal=200, ideal 100 each.
    // A already at 100 → buy 0; B → buy 100. deployed=100, final 50/50.
    const plan = buyPlan(
      [slice({ asset_id: "a", value: 100, targetPct: 50 }), slice({ asset_id: "b", value: 0, targetPct: 50 })],
      100,
    );
    expect(plan.rows[0].buy).toBeCloseTo(0, 6);
    expect(plan.rows[1].buy).toBeCloseTo(100, 6);
    expect(plan.deployed).toBeCloseTo(100, 6);
    expect(plan.rows[0].finalPct).toBeCloseTo(50, 6);
    expect(plan.rows[1].finalPct).toBeCloseTo(50, 6);
  });

  it("clamps an overweight asset to buy 0 and redistributes its share (water-filling)", () => {
    // A=900 (target 50), B=100 (target 50), budget 200. finalTotal=1200, ideal 600 each.
    // A already 900 > 600 → fixed at 900, buy 0. Active={B}: activeBudget=1200-900=300,
    // B gets all → buy 300-100=200. deployed=200, leftover 0.
    const plan = buyPlan(
      [slice({ asset_id: "a", value: 900, targetPct: 50 }), slice({ asset_id: "b", value: 100, targetPct: 50 })],
      200,
    );
    expect(plan.rows[0].buy).toBeCloseTo(0, 6);
    expect(plan.rows[1].buy).toBeCloseTo(200, 6);
    expect(plan.deployed).toBeCloseTo(200, 6);
    expect(plan.leftover).toBeCloseTo(0, 6);
  });

  it("honors relative targets that do not sum to 100", () => {
    // Targets 30/10 (sum 40) → weights 0.75/0.25. Empty start, budget 400.
    // → buy 300 / 100; final 75% / 25%.
    const plan = buyPlan(
      [slice({ asset_id: "a", value: 0, targetPct: 30 }), slice({ asset_id: "b", value: 0, targetPct: 10 })],
      400,
    );
    expect(plan.rows[0].buy).toBeCloseTo(300, 6);
    expect(plan.rows[1].buy).toBeCloseTo(100, 6);
    expect(plan.rows[0].finalPct).toBeCloseTo(75, 6);
  });

  it("reports leftover when budget cannot be deployed without selling", () => {
    // A=1000 (target 1), B=0 (target 0): only A is weighted but it is hugely
    // overweight relative to its tiny target. declaredSum=1, weight A=1.
    // ideal A = finalTotal = 1000+budget, always > 1000, so A still buys the budget.
    // To strand cash we need every POSITIVE-weight asset overweight: give A target 1
    // and B (value 0) target 99, budget 50. finalTotal=1050. ideal A=10.5 (<1000 → fixed),
    // active={B}: activeBudget=1050-1000=50 → B buys 50. So deployed=50, no leftover.
    // True stranding only happens when the lone active asset is itself overweight,
    // which adding cash prevents — so leftover stays 0 here; assert that explicitly.
    const plan = buyPlan(
      [slice({ asset_id: "a", value: 1000, targetPct: 1 }), slice({ asset_id: "b", value: 0, targetPct: 99 })],
      50,
    );
    expect(plan.rows[0].buy).toBeCloseTo(0, 6);
    expect(plan.rows[1].buy).toBeCloseTo(50, 6);
    expect(plan.leftover).toBeCloseTo(0, 6);
  });

  it("treats a non-positive budget as a zero-deploy plan", () => {
    const plan = buyPlan([slice({ asset_id: "a", value: 100, targetPct: 100 })], -50);
    expect(plan.available).toBe(0);
    expect(plan.deployed).toBeCloseTo(0, 6);
    expect(plan.rows[0].buy).toBeCloseTo(0, 6);
  });

  it("preserves input order in the plan rows", () => {
    const plan = buyPlan(
      [
        slice({ asset_id: "x", value: 10, targetPct: 33 }),
        slice({ asset_id: "y", value: 20, targetPct: 33 }),
        slice({ asset_id: "z", value: 30, targetPct: 34 }),
      ],
      300,
    );
    expect(plan.rows.map((r) => r.asset_id)).toEqual(["x", "y", "z"]);
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

describe("computeDrift", () => {
  // Oracles computed from first principles: realPct = value/totalSelected*100 (normalized
  // to 100 by computeAllocation), normalizedTargetPct = targetPct/declaredSum*100, and
  // drift = realPct − normalizedTargetPct (signed pp, positive = over target). `toBe` for
  // provably-exact integers/nulls; `toBeCloseTo(_, 6)` for any division.
  function card(id: string, name: string, assets: AllocationAsset[]): DriftCardInput {
    return { id, name, assets };
  }

  it("computes signed drift and severity for a card whose targets sum to 100", () => {
    // total 100 → realPct A 60, B 30, C 10. declaredSum 100 → normalized target = raw target.
    // drift A 60−40=+20, B 30−40=−10, C 10−20=−10. severity = 20 (A). Offenders by |drift|:
    // A(20) first; B and C tie at 10 → input order B before C.
    const r = computeDrift(
      [
        card("c1", "Portfolio", [
          asset({ asset_id: "a", name: "A", amount: 60, currency: "USD", targetPct: 40 }),
          asset({ asset_id: "b", name: "B", amount: 30, currency: "USD", targetPct: 40 }),
          asset({ asset_id: "c", name: "C", amount: 10, currency: "USD", targetPct: 20 }),
        ]),
      ],
      "USD",
      rates,
    );
    expect(r.worst).not.toBeNull();
    expect(r.worst?.id).toBe("c1");
    expect(r.worst?.name).toBe("Portfolio");
    expect(r.worst?.declaredSum).toBe(100);
    expect(r.worst?.severity).toBeCloseTo(20, 6);
    expect(r.worst?.offenders.map((o) => o.asset_id)).toEqual(["a", "b", "c"]);
    expect(r.worst?.offenders[0].drift).toBeCloseTo(20, 6);
    expect(r.worst?.offenders[1].drift).toBeCloseTo(-10, 6);
    expect(r.worst?.offenders[2].drift).toBeCloseTo(-10, 6);
    expect(r.otherBreachingNames).toEqual([]);
    expect(r.threshold).toBe(DRIFT_THRESHOLD_PCT);
  });

  it("normalizes targets to a 100 base before differencing when declared sum ≠ 100", () => {
    // declaredSum 60+20=80 (≠100). total 100 → realPct A 80, B 20.
    // normalized target A = 60/80*100 = 75, B = 20/80*100 = 25.
    // drift A = 80−75 = +5, B = 20−25 = −5. severity 5 (== threshold → breaches).
    const r = computeDrift(
      [
        card("c1", "Skewed", [
          asset({ asset_id: "a", name: "A", amount: 80, currency: "USD", targetPct: 60 }),
          asset({ asset_id: "b", name: "B", amount: 20, currency: "USD", targetPct: 20 }),
        ]),
      ],
      "USD",
      rates,
    );
    expect(r.worst?.declaredSum).toBe(80);
    expect(r.worst?.offenders[0].normalizedTargetPct).toBeCloseTo(75, 6);
    expect(r.worst?.offenders[1].normalizedTargetPct).toBeCloseTo(25, 6);
    expect(r.worst?.offenders[0].drift).toBeCloseTo(5, 6);
    expect(r.worst?.offenders[1].drift).toBeCloseTo(-5, 6);
    expect(r.worst?.severity).toBeCloseTo(5, 6);
  });

  it("excludes a card whose selected values sum below EPSILON (null realPct), no crash", () => {
    const r = computeDrift(
      [
        card("c1", "Empty values", [
          asset({ asset_id: "a", name: "A", amount: 0, currency: "USD", targetPct: 60 }),
          asset({ asset_id: "b", name: "B", amount: 0, currency: "USD", targetPct: 40 }),
        ]),
      ],
      "USD",
      rates,
    );
    expect(r.worst).toBeNull();
    expect(r.otherBreachingNames).toEqual([]);
  });

  it("excludes an empty card and a card with no positive targets (declaredSum < EPSILON)", () => {
    const r = computeDrift(
      [
        card("c1", "Empty", []),
        card("c2", "No targets", [
          asset({ asset_id: "a", name: "A", amount: 100, currency: "USD", targetPct: 0 }),
          asset({ asset_id: "b", name: "B", amount: 50, currency: "USD", targetPct: 0 }),
        ]),
      ],
      "USD",
      rates,
    );
    expect(r.worst).toBeNull();
    expect(r.otherBreachingNames).toEqual([]);
  });

  it("does not flag a card whose worst drift is below the threshold", () => {
    // total 100 → realPct 52, 48. targets 50/50. drift +2 / −2. severity 2 < 5 → not breaching.
    const r = computeDrift(
      [
        card("c1", "On target", [
          asset({ asset_id: "a", name: "A", amount: 52, currency: "USD", targetPct: 50 }),
          asset({ asset_id: "b", name: "B", amount: 48, currency: "USD", targetPct: 50 }),
        ]),
      ],
      "USD",
      rates,
    );
    expect(r.worst).toBeNull();
    expect(r.otherBreachingNames).toEqual([]);
  });

  it("selects the worst breaching card by severity, returns others by name, stable on ties", () => {
    // Alpha & Beta: 70/30 split, 50/50 targets → drift ±20, severity 20 (tie).
    // Gamma: 58/42 split, 50/50 targets → drift ±8, severity 8. All breach (≥5).
    // Sorted severity desc: [Alpha 20, Beta 20, Gamma 8]; Alpha/Beta tie → input order wins.
    const twoAsset = (idPrefix: string, aAmount: number, bAmount: number): AllocationAsset[] => [
      asset({ asset_id: `${idPrefix}a`, name: `${idPrefix}A`, amount: aAmount, currency: "USD", targetPct: 50 }),
      asset({ asset_id: `${idPrefix}b`, name: `${idPrefix}B`, amount: bAmount, currency: "USD", targetPct: 50 }),
    ];
    const r = computeDrift(
      [
        card("c1", "Alpha", twoAsset("al", 70, 30)),
        card("c2", "Beta", twoAsset("be", 70, 30)),
        card("c3", "Gamma", twoAsset("ga", 58, 42)),
      ],
      "USD",
      rates,
    );
    expect(r.worst?.name).toBe("Alpha");
    expect(r.worst?.severity).toBeCloseTo(20, 6);
    expect(r.otherBreachingNames).toEqual(["Beta", "Gamma"]);
  });

  it("orders offenders within a card largest absolute drift first", () => {
    // total 100 → realPct A 30, B 50, C 20. targets 10/40/50 (declaredSum 100).
    // drift A +20, B +10, C −30. |drift|: C 30, A 20, B 10 → order [c, a, b]. severity 30.
    const r = computeDrift(
      [
        card("c1", "Mixed", [
          asset({ asset_id: "a", name: "A", amount: 30, currency: "USD", targetPct: 10 }),
          asset({ asset_id: "b", name: "B", amount: 50, currency: "USD", targetPct: 40 }),
          asset({ asset_id: "c", name: "C", amount: 20, currency: "USD", targetPct: 50 }),
        ]),
      ],
      "USD",
      rates,
    );
    expect(r.worst?.offenders.map((o) => o.asset_id)).toEqual(["c", "a", "b"]);
    expect(r.worst?.offenders[0].drift).toBeCloseTo(-30, 6);
    expect(r.worst?.severity).toBeCloseTo(30, 6);
  });
});
