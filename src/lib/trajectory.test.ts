import { describe, expect, it } from "vitest";
import type { CagrFit, LinearFit, TrajectorySample } from "@/lib/trajectory";
import { etaToTarget, fitCagr, fitLinear, projectForward, valueAt } from "@/lib/trajectory";

// Narrow a nullable fit without a non-null assertion (forbidden by eslint) and
// fail loudly if a fit that should succeed unexpectedly returned null.
function unwrap<T>(fit: T | null): T {
  if (fit === null) throw new Error("expected a non-null fit");
  return fit;
}

// Pins the trajectory math against oracles computed from first principles — never
// by reading the implementation. Time `t` is days since the first sample; the fit
// is ordinary least squares, in raw value space (linear) or log space (cagr).
//
// FP discipline (house style, src/lib/fire.test.ts): `toBe` for provably-exact
// integers (slope through collinear integer points, step counts, exact endpoints);
// `toBeCloseTo(_, 6)` for any growth / division / log / exp result. A 333.33-class
// probe guards against ×100/÷100 scaling regressions.

// A clean collinear baseline: value = 100 + 10*t, sampled at t = 0,10,20,30.
function linearSamples(
  overrides: Partial<{ slope: number; intercept: number; ts: number[] }> = {},
): TrajectorySample[] {
  const slope = overrides.slope ?? 10;
  const intercept = overrides.intercept ?? 100;
  const ts = overrides.ts ?? [0, 10, 20, 30];
  return ts.map((t) => ({ t, value: intercept + slope * t }));
}

describe("fitLinear", () => {
  it("recovers exact slope and intercept through perfectly collinear integer points", () => {
    // value = 100 + 10*t sampled at 0,10,20,30 → slope 10, intercept 100 exactly.
    const fit = unwrap(fitLinear(linearSamples()));
    expect(fit.model).toBe("linear");
    expect(fit.slope).toBe(10);
    expect(fit.intercept).toBe(100);
  });

  it("fits the least-squares line through a two-point set (slope from the secant)", () => {
    // Two points (0, 50) and (4, 90): slope = (90-50)/(4-0) = 10, intercept = 50.
    const fit = unwrap(
      fitLinear([
        { t: 0, value: 50 },
        { t: 4, value: 90 },
      ]),
    );
    expect(fit.slope).toBeCloseTo(10, 6);
    expect(fit.intercept).toBeCloseTo(50, 6);
  });

  it("returns null on a single point (a line needs at least two)", () => {
    expect(fitLinear([{ t: 0, value: 100 }])).toBeNull();
  });

  it("returns null on an empty sample set", () => {
    expect(fitLinear([])).toBeNull();
  });

  it("returns null when the time axis has zero variance (all-identical t)", () => {
    // Vertical set: the slope denominator Σ(t-t̄)² is 0 → undefined fit.
    expect(
      fitLinear([
        { t: 5, value: 100 },
        { t: 5, value: 200 },
      ]),
    ).toBeNull();
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // value = 333.33 * t sampled at 1,2,3 → slope 333.33, intercept 0. A ×100/÷100
    // bug would land the slope two orders off and fail even a coarse comparison.
    const fit = unwrap(
      fitLinear([
        { t: 1, value: 333.33 },
        { t: 2, value: 666.66 },
        { t: 3, value: 999.99 },
      ]),
    );
    expect(fit.slope).toBeCloseTo(333.33, 6);
    expect(fit.intercept).toBeCloseTo(0, 6);
  });
});

describe("fitCagr", () => {
  it("recovers a known compound rate from exact exponential samples", () => {
    // Build from a known log-line: logIntercept = ln(1000), logSlope = ln(1.001)/day.
    // value_t = 1000 * 1.001**t. OLS in log space must recover both parameters.
    const logIntercept = Math.log(1000);
    const logSlope = Math.log(1.001);
    const samples = [0, 30, 60, 90].map((t) => ({ t, value: 1000 * Math.exp(logSlope * t) }));
    const fit = unwrap(fitCagr(samples));
    expect(fit.model).toBe("cagr");
    expect(fit.logSlope).toBeCloseTo(logSlope, 6);
    expect(fit.logIntercept).toBeCloseTo(logIntercept, 6);
    // And the daily growth factor exp(logSlope) recovers 1.001.
    expect(Math.exp(fit.logSlope)).toBeCloseTo(1.001, 6);
  });

  it("returns null on a single point", () => {
    expect(fitCagr([{ t: 0, value: 1000 }])).toBeNull();
  });

  it("returns null when any sampled value is zero (ln undefined)", () => {
    expect(
      fitCagr([
        { t: 0, value: 1000 },
        { t: 10, value: 0 },
      ]),
    ).toBeNull();
  });

  it("returns null when any sampled value is negative (ln undefined)", () => {
    expect(
      fitCagr([
        { t: 0, value: 1000 },
        { t: 10, value: -500 },
      ]),
    ).toBeNull();
  });

  it("returns null when the time axis has zero variance (all-identical t)", () => {
    expect(
      fitCagr([
        { t: 7, value: 1000 },
        { t: 7, value: 2000 },
      ]),
    ).toBeNull();
  });
});

describe("valueAt", () => {
  it("reads a linear fit directly off the line", () => {
    const fit: LinearFit = { model: "linear", slope: 10, intercept: 100 };
    // 100 + 10*25 = 350 exactly.
    expect(valueAt(fit, 25)).toBe(350);
  });

  it("exponentiates a cagr fit back into value space", () => {
    // value = exp(ln(1000) + ln(1.001)*100) = 1000 * 1.001**100.
    const fit: CagrFit = { model: "cagr", logIntercept: Math.log(1000), logSlope: Math.log(1.001) };
    expect(valueAt(fit, 100)).toBeCloseTo(1000 * 1.001 ** 100, 6);
  });
});

describe("projectForward", () => {
  it("lands endpoints exactly on fromT and toT with the requested step count", () => {
    const fit: LinearFit = { model: "linear", slope: 10, intercept: 100 };
    const pts = projectForward(fit, 0, 100, 5);
    expect(pts.length).toBe(5);
    // Endpoints exact; interior evenly spaced by (100-0)/(5-1) = 25.
    expect(pts[0].t).toBe(0);
    expect(pts[4].t).toBe(100);
    expect(pts[1].t).toBe(25);
    expect(pts[2].t).toBe(50);
    expect(pts[3].t).toBe(75);
    // Values follow the fit: 100 + 10*t.
    expect(pts[0].value).toBe(100);
    expect(pts[4].value).toBe(1100);
    expect(pts[2].value).toBe(600);
  });

  it("returns a single fromT point when steps === 1", () => {
    const fit: LinearFit = { model: "linear", slope: 10, intercept: 100 };
    const pts = projectForward(fit, 40, 100, 1);
    expect(pts.length).toBe(1);
    expect(pts[0].t).toBe(40);
    expect(pts[0].value).toBe(500); // 100 + 10*40
  });

  it("returns an empty array when steps <= 0", () => {
    const fit: LinearFit = { model: "linear", slope: 10, intercept: 100 };
    expect(projectForward(fit, 0, 100, 0)).toEqual([]);
    expect(projectForward(fit, 0, 100, -3)).toEqual([]);
  });

  it("projects a cagr fit, endpoints exact on the t axis", () => {
    const fit: CagrFit = { model: "cagr", logIntercept: Math.log(1000), logSlope: Math.log(1.001) };
    const pts = projectForward(fit, 0, 90, 4);
    expect(pts.length).toBe(4);
    expect(pts[0].t).toBe(0);
    expect(pts[3].t).toBe(90);
    expect(pts[0].value).toBeCloseTo(1000, 6);
    expect(pts[3].value).toBeCloseTo(1000 * 1.001 ** 90, 6);
  });
});

describe("etaToTarget", () => {
  it("solves a linear crossing at a known day", () => {
    // value = 100 + 10*t; target 600 → (600-100)/10 = t = 50, forward of fromT 0.
    const fit: LinearFit = { model: "linear", slope: 10, intercept: 100 };
    expect(etaToTarget(fit, 600, 0)).toBe(50);
  });

  it("solves a cagr crossing at a known day", () => {
    // value = exp(ln(1000) + ln(1.001)*t). Target 2000 →
    // t = (ln(2000) - ln(1000)) / ln(1.001) = ln(2)/ln(1.001).
    const fit: CagrFit = { model: "cagr", logIntercept: Math.log(1000), logSlope: Math.log(1.001) };
    expect(etaToTarget(fit, 2000, 0)).toBeCloseTo(Math.log(2) / Math.log(1.001), 6);
  });

  it("returns null when the linear target is already reached at/before fromT", () => {
    // target 600 crosses at t=50; from t=50 the target is reached now → null.
    const fit: LinearFit = { model: "linear", slope: 10, intercept: 100 };
    expect(etaToTarget(fit, 600, 50)).toBeNull();
    // A below-current target (crossing in the past) is likewise null.
    expect(etaToTarget(fit, 300, 50)).toBeNull();
  });

  it("returns null for a flat linear trend (slope 0 never crosses a distinct target)", () => {
    const fit: LinearFit = { model: "linear", slope: 0, intercept: 100 };
    expect(etaToTarget(fit, 500, 0)).toBeNull();
  });

  it("returns null for a declining linear trend toward an above-current target", () => {
    // slope -10, intercept 1000: value falls; a 2000 target lies backward in time.
    const fit: LinearFit = { model: "linear", slope: -10, intercept: 1000 };
    expect(etaToTarget(fit, 2000, 0)).toBeNull();
  });

  it("returns null for a non-positive cagr target (ln undefined; exp is always positive)", () => {
    const fit: CagrFit = { model: "cagr", logIntercept: Math.log(1000), logSlope: Math.log(1.001) };
    expect(etaToTarget(fit, 0, 0)).toBeNull();
    expect(etaToTarget(fit, -500, 0)).toBeNull();
  });

  it("returns null for a flat cagr log-trend (logSlope 0 never crosses)", () => {
    const fit: CagrFit = { model: "cagr", logIntercept: Math.log(1000), logSlope: 0 };
    expect(etaToTarget(fit, 2000, 0)).toBeNull();
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // value = 333.33*t; target 33333 → t = 33333/333.33 = 100.001... A ×100/÷100
    // bug lands the ETA two orders off.
    const fit: LinearFit = { model: "linear", slope: 333.33, intercept: 0 };
    expect(etaToTarget(fit, 33_333, 0)).toBeCloseTo(33_333 / 333.33, 6);
  });
});
