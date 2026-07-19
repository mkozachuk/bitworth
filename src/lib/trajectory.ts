// Pure net-worth trajectory math: fit a trend to historical samples, project it
// forward, and solve for the date a target is reached.
//
// No Supabase, no React, no I/O — this module is the single source of trajectory
// truth and is imported on both the Astro SSR server and the React island, so the
// initial render and every recompute share one code path. All values are raw
// floats; rounding happens only at the view edge.
//
// Two models are offered. `linear` fits value directly (ordinary least squares on
// (t, value)); `cagr` fits ln(value) and exponentiates, capturing compound growth.
// Time `t` is expressed in DAYS SINCE THE FIRST SAMPLE — the caller normalises
// calendar dates to this integer-day axis before calling in, so the math never
// touches Date arithmetic.
//
// Every function is pure and total: degenerate input (too few samples, a
// zero-variance time axis, a non-positive value under a log fit, an unreachable
// target) returns `null` rather than throwing, so callers guard a value instead
// of a try/catch.

export type FitModel = "linear" | "cagr";

/** One historical observation. `t` = days since the first sample. */
export interface TrajectorySample {
  t: number;
  value: number;
}

/** Least-squares line: `value = intercept + slope * t`. */
export interface LinearFit {
  model: "linear";
  slope: number;
  intercept: number;
}

/** Least-squares log-line: `value = exp(logIntercept + logSlope * t)`. */
export interface CagrFit {
  model: "cagr";
  logIntercept: number;
  logSlope: number;
}

export type Fit = LinearFit | CagrFit;

/**
 * Ordinary least squares on the raw `(t, value)` pairs.
 *
 * Returns `null` when there are fewer than 2 samples, or when the time axis has
 * zero variance (all-identical `t` — the slope denominator would be zero and the
 * fit is undefined). The regression is the exact closed form:
 *   slope     = Σ(t - t̄)(v - v̄) / Σ(t - t̄)²
 *   intercept = v̄ - slope * t̄
 */
export function fitLinear(samples: TrajectorySample[]): LinearFit | null {
  const n = samples.length;
  if (n < 2) return null;

  let sumT = 0;
  let sumV = 0;
  for (const s of samples) {
    sumT += s.t;
    sumV += s.value;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;

  let sxy = 0;
  let sxx = 0;
  for (const s of samples) {
    const dt = s.t - meanT;
    sxy += dt * (s.value - meanV);
    sxx += dt * dt;
  }
  if (sxx === 0) return null; // zero-variance time axis

  const slope = sxy / sxx;
  const intercept = meanV - slope * meanT;
  return { model: "linear", slope, intercept };
}

/**
 * Ordinary least squares on `(t, ln(value))`, capturing compound (exponential)
 * growth. The fitted line in log space maps back to `exp(logIntercept + logSlope*t)`.
 *
 * Returns `null` when there are fewer than 2 samples, when any sampled value is
 * `<= 0` (ln undefined), or when the time axis has zero variance.
 */
export function fitCagr(samples: TrajectorySample[]): CagrFit | null {
  const n = samples.length;
  if (n < 2) return null;
  for (const s of samples) {
    if (s.value <= 0) return null; // ln undefined
  }

  let sumT = 0;
  let sumL = 0;
  const logs: number[] = [];
  for (const s of samples) {
    const l = Math.log(s.value);
    logs.push(l);
    sumT += s.t;
    sumL += l;
  }
  const meanT = sumT / n;
  const meanL = sumL / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dt = samples[i].t - meanT;
    sxy += dt * (logs[i] - meanL);
    sxx += dt * dt;
  }
  if (sxx === 0) return null; // zero-variance time axis

  const logSlope = sxy / sxx;
  const logIntercept = meanL - logSlope * meanT;
  return { model: "cagr", logIntercept, logSlope };
}

/**
 * Evaluate a fit at time `t` (days since the first sample). Linear reads the line
 * directly; cagr exponentiates the log-line back into value space.
 */
export function valueAt(fit: Fit, t: number): number {
  if (fit.model === "linear") {
    return fit.intercept + fit.slope * t;
  }
  return Math.exp(fit.logIntercept + fit.logSlope * t);
}

/**
 * Sample the fitted curve at `steps` evenly-spaced points across `[fromT, toT]`,
 * INCLUSIVE of both endpoints. `steps` is the point count, not the interval count,
 * so `steps = N` yields N points with `points[0].t === fromT` and
 * `points[N-1].t === toT` landing exactly on the endpoints.
 *
 * Returns `[]` when `steps <= 0`. With `steps === 1` the single point lands on
 * `fromT` (there is no interior to space). Otherwise the spacing is
 * `(toT - fromT) / (steps - 1)`.
 */
export function projectForward(fit: Fit, fromT: number, toT: number, steps: number): TrajectorySample[] {
  if (steps <= 0) return [];
  if (steps === 1) return [{ t: fromT, value: valueAt(fit, fromT) }];

  const out: TrajectorySample[] = [];
  const span = toT - fromT;
  const last = steps - 1;
  for (let i = 0; i < steps; i++) {
    // Snap the final index exactly onto toT to avoid FP drift on the endpoint.
    const t = i === last ? toT : fromT + (span * i) / last;
    out.push({ t, value: valueAt(fit, t) });
  }
  return out;
}

/**
 * Solve for the time `t` (days since the first sample) at which the fit reaches
 * `target`, looking strictly FORWARD of `fromT`.
 *
 * Linear inverts `(target - intercept) / slope`; cagr inverts
 * `(ln(target) - logIntercept) / logSlope`. Returns `null` when:
 *   - the crossing is at or before `fromT` (target already reached / in the past),
 *   - the trend cannot reach the target in the forward direction (a flat or
 *     wrong-signed slope makes the crossing non-finite or backward), or
 *   - for cagr, `target <= 0` (ln undefined — an exponential of a real line is
 *     always positive and can never equal a non-positive target).
 */
export function etaToTarget(fit: Fit, target: number, fromT: number): number | null {
  let t: number;
  if (fit.model === "linear") {
    if (fit.slope === 0) return null; // flat trend never crosses a distinct target
    t = (target - fit.intercept) / fit.slope;
  } else {
    if (target <= 0) return null; // ln undefined; exp() is always positive
    if (fit.logSlope === 0) return null; // flat log-trend never crosses
    t = (Math.log(target) - fit.logIntercept) / fit.logSlope;
  }
  if (!Number.isFinite(t)) return null;
  if (t <= fromT) return null; // already reached or in the past
  return t;
}
