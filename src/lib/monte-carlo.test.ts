import { describe, expect, it } from "vitest";
import { toRealReturn } from "@/lib/fire";
import type { MonteCarloInputs } from "@/lib/monte-carlo";
import { computeMonteCarlo, mulberry32, nextGaussian, percentile } from "@/lib/monte-carlo";

// Pins the Monte Carlo math against oracles derived from first principles, never
// by reading the implementation. The lower primitives (mulberry32, nextGaussian,
// percentile) are pinned to canonical/hand-computed oracles; computeMonteCarlo is
// then pinned to a parallel reference that re-derives the documented recurrence
// and RNG consumption order (outer loop paths, inner loop years, one Gaussian
// draw per path-year) from those already-verified primitives.
//
// FP discipline (house style): `toBe` for provably-exact integers/fractions;
// `toBeCloseTo(_, 6)` for any growth / division / Gaussian result. A 333.33-class
// probe guards against ×100/÷100 scaling regressions.

// A complete, valid baseline; individual tests override only what they exercise.
function inputs(overrides: Partial<MonteCarloInputs> = {}): MonteCarloInputs {
  return {
    startingPrincipal: 100_000,
    annualIncome: 80_000,
    annualExpenses: 40_000,
    nominalReturn: 0.07,
    inflationRate: 0.03,
    safeWithdrawalRate: 0.04,
    currentAge: 30,
    traditionalRetirementAge: 65,
    returnVolatility: 0.15,
    seed: 42,
    pathCount: 1000,
    ...overrides,
  };
}

describe("mulberry32", () => {
  it("reproduces the canonical sequence for a known seed", () => {
    // Canonical mulberry32(0) outputs (reference algorithm, independent of impl).
    const rng = mulberry32(0);
    expect(rng()).toBeCloseTo(0.266429208685, 6);
    expect(rng()).toBeCloseTo(0.000329745701, 6);
    expect(rng()).toBeCloseTo(0.223272027448, 6);
  });

  it("stays within [0, 1) over many draws", () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 10_000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("is deterministic — same seed yields the same sequence", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
});

describe("nextGaussian", () => {
  it("matches a hand-computed Box–Muller oracle for the first draw", () => {
    const seed = 12345;
    const mean = 0.05;
    const sd = 0.15;
    // Re-derive the transform from the formula, consuming uniforms in the same
    // order: u1 = 1 - rng() (the ln(0) guard), then u2 = rng().
    const ref = mulberry32(seed);
    const u1 = 1 - ref();
    const u2 = ref();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const expected = mean + sd * z0;

    expect(nextGaussian(mulberry32(seed), mean, sd)).toBeCloseTo(expected, 6);
  });

  it("converges to the requested mean and sd over many draws", () => {
    const rng = mulberry32(99);
    const mean = 0.05;
    const sd = 0.15;
    const N = 50_000;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) samples.push(nextGaussian(rng, mean, sd));
    const sampleMean = samples.reduce((a, b) => a + b, 0) / N;
    const sampleVar = samples.reduce((a, b) => a + (b - sampleMean) ** 2, 0) / N;
    const sampleSd = Math.sqrt(sampleVar);
    // Loose tolerances — this is a convergence sanity check, not an exact oracle.
    expect(sampleMean).toBeCloseTo(mean, 2);
    expect(sampleSd).toBeCloseTo(sd, 2);
  });
});

describe("percentile", () => {
  // Type-7 interpolation: rank = p*(N-1), interpolate between floor/ceil.
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns the min at p=0 and the max at p=1", () => {
    expect(percentile(ten, 0)).toBeCloseTo(1, 6);
    expect(percentile(ten, 1)).toBeCloseTo(10, 6);
  });

  it("interpolates the median of an even-length array", () => {
    // rank = 0.5 * 9 = 4.5 → between ten[4]=5 and ten[5]=6 → 5.5
    expect(percentile(ten, 0.5)).toBeCloseTo(5.5, 6);
  });

  it("locks the type-7 interpolation choice for an off-node rank (P10)", () => {
    // rank = 0.1 * 9 = 0.9 → ten[0]=1 + 0.9*(ten[1]-ten[0]) = 1 + 0.9 = 1.9
    expect(percentile(ten, 0.1)).toBeCloseTo(1.9, 6);
    // P90: rank = 0.9 * 9 = 8.1 → ten[8]=9 + 0.1*(ten[9]-ten[8]) = 9.1
    expect(percentile(ten, 0.9)).toBeCloseTo(9.1, 6);
  });

  it("returns the lone value for a single-element array", () => {
    expect(percentile([42], 0.37)).toBe(42);
  });
});

describe("computeMonteCarlo", () => {
  it("matches a fixed-seed oracle for successProbability and the P50 terminal band", () => {
    const PATHS = 8;
    const HORIZON = 5;
    const SEED = 123;
    const base = inputs({ pathCount: PATHS, maxYears: HORIZON, seed: SEED });
    const result = computeMonteCarlo(base);

    // Independent oracle: replay the documented recurrence and RNG order using
    // the already-verified primitives.
    const realReturn = toRealReturn(base.nominalReturn, base.inflationRate);
    const fireNumber = base.annualExpenses / base.safeWithdrawalRate;
    const annualSavings = base.annualIncome - base.annualExpenses;
    const rng = mulberry32(SEED);
    const terminal: number[] = [];
    let everReached = 0;
    for (let i = 0; i < PATHS; i++) {
      let balance = base.startingPrincipal;
      let reached = balance >= fireNumber;
      for (let year = 1; year <= HORIZON; year++) {
        const growth = Math.max(0.05, 1 + nextGaussian(rng, realReturn, base.returnVolatility));
        balance = growth * balance + annualSavings;
        if (balance >= fireNumber) reached = true;
      }
      if (reached) everReached++;
      terminal.push(balance);
    }
    const sortedTerminal = [...terminal].sort((a, b) => a - b);

    expect(result.successProbability).toBeCloseTo(everReached / PATHS, 6);
    expect(result.bands[result.bands.length - 1].p50).toBeCloseTo(percentile(sortedTerminal, 0.5), 6);
  });

  it("exposes the FIRE number and horizon, and shapes paths/bands to the horizon", () => {
    const result = computeMonteCarlo(inputs({ pathCount: 16, maxYears: 10 }));
    // fireNumber = 40000 / 0.04 = 1_000_000
    expect(result.fireNumber).toBeCloseTo(1_000_000, 6);
    expect(result.horizonYears).toBe(10);
    expect(result.pathCount).toBe(16);
    expect(result.paths.length).toBe(16);
    // Each path has horizon + 1 entries; year 0 is the starting principal.
    expect(result.paths[0].length).toBe(11);
    expect(result.paths[0][0]).toBe(100_000);
    expect(result.bands.length).toBe(11);
    // Year-0 band is degenerate — every path starts at the same principal.
    expect(result.bands[0]).toEqual({ year: 0, p10: 100_000, p50: 100_000, p90: 100_000 });
  });

  it("widens the percentile fan over the horizon for non-zero volatility", () => {
    const result = computeMonteCarlo(inputs({ pathCount: 1000, maxYears: 30, returnVolatility: 0.15 }));
    const terminalSpread = result.bands[30].p90 - result.bands[30].p10;
    const earlySpread = result.bands[1].p90 - result.bands[1].p10;
    expect(terminalSpread).toBeGreaterThan(earlySpread);
  });

  it("collapses every path onto the deterministic line when volatility is 0", () => {
    const result = computeMonteCarlo(inputs({ pathCount: 50, maxYears: 20, returnVolatility: 0 }));
    // With sd=0 every draw equals the mean, so all paths are identical and each
    // year's band is degenerate (p10 === p50 === p90).
    for (const band of result.bands) {
      expect(band.p10).toBeCloseTo(band.p50, 6);
      expect(band.p50).toBeCloseTo(band.p90, 6);
    }
    // Ever-reached success is therefore all-or-nothing: identical paths either
    // all clear the FIRE number or none do.
    expect([0, 1]).toContain(result.successProbability);
  });

  it("is deterministic — same inputs and seed yield identical output", () => {
    const a = computeMonteCarlo(inputs({ pathCount: 64, maxYears: 15, seed: 2024 }));
    const b = computeMonteCarlo(inputs({ pathCount: 64, maxYears: 15, seed: 2024 }));
    expect(a).toEqual(b);
  });

  it("throws on a non-positive safe withdrawal rate (invalid: divide-by-zero)", () => {
    expect(() => computeMonteCarlo(inputs({ safeWithdrawalRate: 0 }))).toThrow(RangeError);
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // fireNumber = 33333.33 / 0.04 = 833333.25 — a buggy ×100/÷100 lands two
    // orders off and fails even a coarse comparison.
    const result = computeMonteCarlo(inputs({ annualExpenses: 33_333.33, pathCount: 8, maxYears: 5 }));
    expect(result.fireNumber).toBeCloseTo(833_333.25, 6);
  });
});
