import { describe, expect, it } from "vitest";
import type { FireInputs } from "@/lib/fire";
import { computeFireProjection, monthsOfRunway, toRealReturn } from "@/lib/fire";

// Pins the FIRE projection math against oracles computed from first principles
// — never by reading the implementation. The projection runs entirely in REAL
// (today's-dollar) terms: a nominal return + inflation are converted ONCE to a
// real return, and nothing is re-inflated afterward.
//
// FP discipline (house style, src/lib/net-worth.test.ts): `toBe` for
// provably-exact integers (yearsToFi, projection length); `toBeCloseTo(_, 6)`
// for any growth / division / exponentiation result. A 333.33-class probe
// guards against ×100/÷100 scaling regressions.

// A complete, valid baseline; individual tests override only what they exercise.
function inputs(overrides: Partial<FireInputs> = {}): FireInputs {
  return {
    startingPrincipal: 100_000,
    annualIncome: 80_000,
    annualExpenses: 40_000,
    nominalReturn: 0.07,
    inflationRate: 0.03,
    safeWithdrawalRate: 0.04,
    currentAge: 30,
    traditionalRetirementAge: 65,
    ...overrides,
  };
}

describe("toRealReturn", () => {
  it("applies the exact Fisher relation, not the subtraction approximation", () => {
    // (1.07 / 1.03) - 1 = 0.038834951456310... — NOT 0.07 - 0.03 = 0.04
    expect(toRealReturn(0.07, 0.03)).toBeCloseTo(0.038834951456, 6);
  });

  it("is exactly zero when nominal equals inflation (x/x === 1 in IEEE)", () => {
    // (1.05 / 1.05) - 1 = 0
    expect(toRealReturn(0.05, 0.05)).toBe(0);
  });

  it("reduces to the nominal return when inflation is zero", () => {
    // (1.05 / 1.0) - 1 = 0.05
    expect(toRealReturn(0.05, 0)).toBeCloseTo(0.05, 6);
  });
});

describe("computeFireProjection", () => {
  it("derives the FIRE number, savings, and savings rate from the inputs", () => {
    const r = computeFireProjection(inputs());
    // fireNumber = expenses / SWR = 40000 / 0.04 = 1_000_000
    expect(r.fireNumber).toBeCloseTo(1_000_000, 6);
    // annualSavings = income - expenses = 80000 - 40000 = 40000
    expect(r.annualSavings).toBe(40_000);
    // savingsRate = 40000 / 80000 = 0.5
    expect(r.savingsRate).toBeCloseTo(0.5, 6);
    // realReturn = (1.07 / 1.03) - 1
    expect(r.realReturn).toBeCloseTo(0.038834951456, 6);
  });

  it("guards savingsRate against non-positive income (no divide-by-zero)", () => {
    // income 0 → savingsRate 0 (not -Infinity / NaN), savings still expenses-negative
    const r = computeFireProjection(inputs({ annualIncome: 0, annualExpenses: 40_000 }));
    expect(r.savingsRate).toBe(0);
    expect(r.annualSavings).toBe(-40_000);
  });

  it("projects end-of-year-annuity balances and finds the exact FI crossing year", () => {
    // Clean oracle: realReturn = 0.10 (nominal 0.10, inflation 0).
    // principal 100, savings = income - expenses = 200 - 100 = 100/yr.
    // fireNumber = expenses / SWR = 100 / 0.25 = 400.
    //   b0 = 100
    //   b1 = 100*1.1 + 100 = 210
    //   b2 = 210*1.1 + 100 = 331
    //   b3 = 331*1.1 + 100 = 464.1  >= 400  → yearsToFi = 3
    const r = computeFireProjection(
      inputs({
        startingPrincipal: 100,
        annualIncome: 200,
        annualExpenses: 100,
        nominalReturn: 0.1,
        inflationRate: 0,
        safeWithdrawalRate: 0.25,
        currentAge: 40,
        traditionalRetirementAge: 65,
      }),
    );
    expect(r.fireNumber).toBeCloseTo(400, 6);
    expect(r.yearsToFi).toBe(3);
    expect(r.retirementAge).toBe(43);
    // Projection covers the starting point through the crossing point: 4 points.
    expect(r.projection.length).toBe(4);
    expect(r.projection[0]).toEqual({ age: 40, balance: 100 });
    expect(r.projection[1].balance).toBeCloseTo(210, 6);
    expect(r.projection[2].balance).toBeCloseTo(331, 6);
    expect(r.projection[3].balance).toBeCloseTo(464.1, 6);
    expect(r.projection[3].age).toBe(43);
  });

  it("returns yearsToFi 0 when the principal already clears the FIRE number", () => {
    // principal 1_000_000 >= fireNumber (40000/0.04 = 1_000_000) → retire now
    const r = computeFireProjection(inputs({ startingPrincipal: 1_000_000 }));
    expect(r.yearsToFi).toBe(0);
    expect(r.retirementAge).toBe(30);
    expect(r.projection.length).toBe(1);
    expect(r.projection[0]).toEqual({ age: 30, balance: 1_000_000 });
  });

  it("returns null (not a hang/overflow) when FI is unreachable", () => {
    // savings negative (income 30k < expenses 40k) and realReturn 0 → balance
    // only shrinks; never reaches the 1_000_000 FIRE number. Horizon caps the
    // loop at 100 - currentAge = 70 steps → 71 points, yearsToFi null.
    const r = computeFireProjection(
      inputs({ startingPrincipal: 100_000, annualIncome: 30_000, nominalReturn: 0, inflationRate: 0 }),
    );
    expect(r.yearsToFi).toBeNull();
    expect(r.retirementAge).toBeNull();
    expect(r.projection.length).toBe(71); // (100 - 30) + 1
  });

  it("caps the projection at an explicit maxYears even when FI is reachable later", () => {
    // Same r=0.10 scenario whose true crossing is year 3, but maxYears 2 stops
    // the loop first → yearsToFi null, projection = 3 points (n = 0,1,2).
    const r = computeFireProjection(
      inputs({
        startingPrincipal: 100,
        annualIncome: 200,
        annualExpenses: 100,
        nominalReturn: 0.1,
        inflationRate: 0,
        safeWithdrawalRate: 0.25,
        maxYears: 2,
      }),
    );
    expect(r.yearsToFi).toBeNull();
    expect(r.retirementAge).toBeNull();
    expect(r.projection.length).toBe(3);
  });

  it("discounts the FIRE number back to a Coast FIRE number", () => {
    // realReturn 0.05 (nominal 0.05, inflation 0), exponent = 65 - 30 = 35.
    // coastFireNumber = fireNumber / (1.05 ** 35) = 1_000_000 / 1.05**35
    const r = computeFireProjection(inputs({ nominalReturn: 0.05, inflationRate: 0, startingPrincipal: 200_000 }));
    expect(r.coastFireNumber).toBeCloseTo(1_000_000 / 1.05 ** 35, 6);
    // 1_000_000 / 1.05**35 ≈ 181_290 ; principal 200_000 clears it
    expect(r.isCoastFi).toBe(true);
  });

  it("reports not-Coast-FI when the principal is below the Coast number", () => {
    const r = computeFireProjection(inputs({ nominalReturn: 0.05, inflationRate: 0, startingPrincipal: 100_000 }));
    expect(r.coastFireNumber).toBeCloseTo(1_000_000 / 1.05 ** 35, 6);
    expect(r.isCoastFi).toBe(false);
  });

  it("returns a null Coast number once at/past the traditional retirement age", () => {
    const r = computeFireProjection(inputs({ currentAge: 65, traditionalRetirementAge: 65 }));
    expect(r.coastFireNumber).toBeNull();
    expect(r.isCoastFi).toBe(false);
  });

  it("computes a lower Barista number from part-time income", () => {
    // baristaFireNumber = (expenses - baristaIncome) / SWR = (40000 - 20000)/0.04 = 500_000
    const r = computeFireProjection(inputs({ baristaIncome: 20_000, startingPrincipal: 600_000 }));
    expect(r.baristaFireNumber).toBeCloseTo(500_000, 6);
    expect(r.isBaristaFi).toBe(true); // 600_000 >= 500_000
  });

  it("makes the Barista number equal the full FIRE number with no part-time income", () => {
    const r = computeFireProjection(inputs()); // baristaIncome undefined → 0
    expect(r.baristaFireNumber).toBeCloseTo(r.fireNumber, 6);
  });

  it("floors the Barista number at 0 when part-time income exceeds expenses", () => {
    // (40000 - 50000)/0.04 = -250000 → floored to 0; any non-negative principal clears it
    const r = computeFireProjection(inputs({ baristaIncome: 50_000, startingPrincipal: 0 }));
    expect(r.baristaFireNumber).toBe(0);
    expect(r.isBaristaFi).toBe(true);
  });

  it("throws on a non-positive safe withdrawal rate (invalid: divide-by-zero)", () => {
    expect(() => computeFireProjection(inputs({ safeWithdrawalRate: 0 }))).toThrow(RangeError);
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // fireNumber = 33333.33 / 0.04 = 833333.25 — a buggy ×100/÷100 would be
    // off by two orders of magnitude and fail even a coarse comparison.
    const r = computeFireProjection(inputs({ annualExpenses: 33_333.33 }));
    expect(r.fireNumber).toBeCloseTo(833_333.25, 6);
  });
});

describe("monthsOfRunway", () => {
  it("divides net worth by the monthly burn rate", () => {
    // monthly burn = 40000 / 12 = 3333.33... ; 120000 / 3333.33... = 36 months
    expect(monthsOfRunway(120_000, 40_000)).toBeCloseTo(120_000 / (40_000 / 12), 6);
  });

  it("returns null when annual expenses are zero (no meaningful burn rate)", () => {
    expect(monthsOfRunway(120_000, 0)).toBeNull();
  });

  it("returns null when annual expenses are negative", () => {
    expect(monthsOfRunway(120_000, -40_000)).toBeNull();
  });

  it("returns null when annual expenses are non-finite", () => {
    expect(monthsOfRunway(120_000, Number.POSITIVE_INFINITY)).toBeNull();
    expect(monthsOfRunway(120_000, Number.NaN)).toBeNull();
  });

  it("returns 0 months for zero net worth against positive expenses", () => {
    // 0 / (40000/12) = 0
    expect(monthsOfRunway(0, 40_000)).toBe(0);
  });

  it("returns a negative number for an underwater net worth (documented, not clamped)", () => {
    // liabilities exceed assets: -10000 / (40000/12) = -3 months
    expect(monthsOfRunway(-10_000, 40_000)).toBeCloseTo(-3, 6);
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // 33333.33 / (10000/12) = 39.99999... ; a ×100/÷100 bug lands two orders off
    expect(monthsOfRunway(33_333.33, 10_000)).toBeCloseTo(33_333.33 / (10_000 / 12), 6);
  });
});
