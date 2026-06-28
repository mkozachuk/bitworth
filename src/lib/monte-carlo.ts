// Pure Monte Carlo "Forecast" engine — randomized real-terms projection math.
//
// No Supabase, no React, no I/O. Like src/lib/fire.ts this is a single source of
// projection truth, imported by the React island and (potentially) the SSR
// server, so every recompute shares one code path. All values are raw floats;
// rounding happens only at the view edge.
//
// Convention: the simulation runs entirely in REAL (today's-dollar) terms,
// reusing fire.ts's `toRealReturn` for the mean and the same FIRE-number
// derivation, so the deterministic FIRE view and this probabilistic view agree
// on assumptions and target. The user's entered return is treated as the
// ARITHMETIC annual mean; compounding `balance *= (1 + r)` with r ~ Normal(mean,
// sd) introduces a volatility drag of ≈ sd²/2 on the median CAGR — that is
// correct and disclosed in the UI copy, NOT up-converted here.
//
// Determinism: the engine is seed-injected. A given (inputs, seed) pair always
// produces byte-identical output, which is what makes the stochastic math
// cheaply unit-testable. The RNG is consumed in a fixed order — outer loop over
// paths, inner loop over years, exactly one Gaussian draw per path-year — so a
// test can replay the same sequence as an independent oracle.

import type { FireInputs } from "@/lib/fire";
import { toRealReturn } from "@/lib/fire";

/**
 * mulberry32 — a canonical tiny seedable PRNG returning a float in `[0, 1)`.
 * Not cryptographic; its only virtue is determinism given a seed. The bit-ops
 * (`| 0`, `>>>`, `Math.imul`) keep arithmetic in 32-bit integer space.
 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw one sample from a Normal distribution via the Box–Muller transform.
 *
 * `z0 = sqrt(-2·ln(u1))·cos(2π·u2)`, then `mean + sd·z0`. The first uniform is
 * taken as `u1 = 1 - rng()` to map `[0, 1)` → `(0, 1]`: without this guard an
 * `rng()` of exactly 0 would yield `ln(0) = -Infinity`. Consumes exactly two
 * `rng()` values per call.
 */
export function nextGaussian(rng: () => number, mean: number, sd: number): number {
  const u1 = 1 - rng(); // (0, 1] — guards ln(0)
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z0;
}

/**
 * Type-7 (linear-interpolation) percentile of a pre-sorted-ascending array.
 *
 * `rank = p·(N-1)`, then linearly interpolate between the values at `floor(rank)`
 * and `ceil(rank)`. `p` is a fraction in `[0, 1]`. The input MUST already be
 * sorted ascending — sorting here would be a hidden O(n log n) cost on a hot
 * per-year path. Matches NumPy's default and R's type 7.
 */
export function percentile(sortedAscending: number[], p: number): number {
  const n = sortedAscending.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAscending[0];
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAscending[lo];
  const frac = rank - lo;
  return sortedAscending[lo] + frac * (sortedAscending[hi] - sortedAscending[lo]);
}

export interface MonteCarloInputs extends FireInputs {
  returnVolatility: number; // real-terms annual std-dev of returns (decimal, e.g. 0.15)
  seed: number; // explicit seed — determinism is a feature, not a default
  pathCount?: number; // number of simulated paths; default 1000
}

export interface MonteCarloBand {
  year: number; // 0 = starting principal, then 1..horizon
  p10: number;
  p50: number;
  p90: number;
}

export interface MonteCarloResult {
  fireNumber: number; // annualExpenses / safeWithdrawalRate — same target as fire.ts
  horizonYears: number;
  paths: number[][]; // paths[i] = [b0, b1, …, bHorizon]; b0 = startingPrincipal
  bands: MonteCarloBand[]; // per-year cross-sectional P10/P50/P90 (length horizon + 1)
  successProbability: number; // share of paths that reach fireNumber at any year within the horizon
  pathCount: number;
}

const DEFAULT_PATH_COUNT = 1000;

// Limited-liability clamp: a one-year real return can't drop below −95%. The
// growth multiplier `1 + r` is floored at 0.05. A draw below −95% is a ~−5.5σ
// to −7σ event at typical volatility, so the truncation bias is negligible
// (and disclosed in the UI as marginally optimistic).
const MIN_GROWTH_MULTIPLIER = 0.05;

/**
 * Simulate `pathCount` real-terms portfolio paths over the FIRE horizon and
 * report the per-year percentile bands plus the terminal-wealth success
 * probability.
 *
 * Per-path-year recurrence (clamp on the growth multiplier):
 *   balance = max(0.05, 1 + nextGaussian(rng, realReturn, σ)) * balance + annualSavings
 *
 * `annualSavings` is `annualIncome - annualExpenses`, already a today's-dollars
 * value. Percentile bands are CROSS-SECTIONAL: for each year index, the N path
 * balances are sorted and the type-7 quantile is taken — that is what produces
 * the widening fan. `successProbability` is the share of paths that reach the
 * FIRE number at ANY year within the horizon (ever-reached / first-crossing) —
 * once a path touches your number you are financially independent, even if a
 * later down-year dips it back below. Set the horizon (`maxYears`) to the year
 * you'd actually retire so this answers "by my retirement age", not "by age 100"
 * where decades of compounding make success trivially certain.
 *
 * Throws `RangeError` on a non-positive safe withdrawal rate (the FIRE number
 * would divide by zero) — the same invalid-input guard as fire.ts; the caller
 * must guard before calling.
 */
export function computeMonteCarlo(inputs: MonteCarloInputs): MonteCarloResult {
  const {
    startingPrincipal,
    annualIncome,
    annualExpenses,
    nominalReturn,
    inflationRate,
    safeWithdrawalRate,
    currentAge,
    returnVolatility,
    seed,
    pathCount,
    maxYears,
  } = inputs;

  if (safeWithdrawalRate <= 0) {
    throw new RangeError(`safeWithdrawalRate must be > 0, received ${safeWithdrawalRate}`);
  }

  const realReturn = toRealReturn(nominalReturn, inflationRate);
  const fireNumber = annualExpenses / safeWithdrawalRate;
  const annualSavings = annualIncome - annualExpenses;
  const horizon = maxYears ?? Math.max(0, 100 - currentAge);
  const count = pathCount ?? DEFAULT_PATH_COUNT;

  const rng = mulberry32(seed);

  // Outer loop over paths, inner loop over years — exactly one Gaussian draw per
  // path-year. This fixed consumption order is the contract a test replays. We
  // also record, per path, whether the balance ever touched the FIRE number —
  // the ever-reached metric below — including year 0 for an already-FI start.
  const paths: number[][] = [];
  let successes = 0;
  for (let i = 0; i < count; i++) {
    const path = new Array<number>(horizon + 1);
    let balance = startingPrincipal;
    path[0] = balance;
    let reached = balance >= fireNumber;
    for (let year = 1; year <= horizon; year++) {
      const growth = Math.max(MIN_GROWTH_MULTIPLIER, 1 + nextGaussian(rng, realReturn, returnVolatility));
      balance = growth * balance + annualSavings;
      path[year] = balance;
      if (balance >= fireNumber) reached = true;
    }
    if (reached) successes++;
    paths.push(path);
  }

  // Cross-sectional percentiles: for each year, sort the N balances across paths
  // and take the type-7 quantile. A scratch buffer is sorted in place per year.
  const bands: MonteCarloBand[] = [];
  for (let year = 0; year <= horizon; year++) {
    const column = new Array<number>(count);
    for (let i = 0; i < count; i++) column[i] = paths[i][year];
    column.sort((a, b) => a - b);
    bands.push({
      year,
      p10: percentile(column, 0.1),
      p50: percentile(column, 0.5),
      p90: percentile(column, 0.9),
    });
  }

  const successProbability = count > 0 ? successes / count : 0;

  return {
    fireNumber,
    horizonYears: horizon,
    paths,
    bands,
    successProbability,
    pathCount: count,
  };
}
