// Pure FIRE (Financial Independence / Retire Early) projection math.
//
// No Supabase, no React, no I/O — this module is the single source of
// projection truth and is imported on both the Astro SSR server and the React
// island, so the initial render and every keystroke recompute share one code
// path. All values are raw floats; rounding happens only at the view edge.
//
// Convention: the projection runs entirely in REAL (today's-dollar) terms. The
// caller supplies a nominal return and an inflation rate; we convert once to a
// real return and never re-inflate anything afterward. This single-convention
// choice is what avoids the nominal/real mixing bug flagged as the roadmap's
// top correctness hazard. Income and expenses are held flat in real terms.

export interface FireInputs {
  startingPrincipal: number; // today's currency, real
  annualIncome: number;
  annualExpenses: number;
  nominalReturn: number; // e.g. 0.07
  inflationRate: number; // e.g. 0.03
  safeWithdrawalRate: number; // e.g. 0.04 (> 0)
  currentAge: number;
  traditionalRetirementAge: number; // default 65, must be > currentAge for Coast
  baristaIncome?: number; // optional part-time semi-retirement income
  maxYears?: number; // projection horizon; default 100 - currentAge
}

export interface FireProjectionPoint {
  age: number;
  balance: number; // real terms
}

export interface FireResult {
  realReturn: number;
  fireNumber: number; // annualExpenses / safeWithdrawalRate
  annualSavings: number; // annualIncome - annualExpenses
  savingsRate: number; // annualSavings / annualIncome (0 if income <= 0)
  yearsToFi: number | null; // null if unreachable within maxYears
  retirementAge: number | null; // currentAge + yearsToFi, else null
  coastFireNumber: number | null; // null if traditionalRetirementAge <= currentAge
  isCoastFi: boolean;
  baristaFireNumber: number; // (expenses - baristaIncome)/SWR, floored at 0
  isBaristaFi: boolean; // startingPrincipal >= baristaFireNumber
  projection: FireProjectionPoint[]; // age vs real balance, currentAge to FI (or horizon)
}

/**
 * Convert a nominal return and an inflation rate into a single real return.
 * `(1 + nominal) / (1 + inflation) - 1` — the exact Fisher relation, not the
 * `nominal - inflation` approximation, so the oracle is unambiguous.
 */
export function toRealReturn(nominalReturn: number, inflationRate: number): number {
  return (1 + nominalReturn) / (1 + inflationRate) - 1;
}

/**
 * Project the portfolio forward in real terms and report the FIRE milestones.
 *
 * Compounding is annual with savings added at END of year (ordinary annuity):
 *   balance_{n+1} = balance_n * (1 + realReturn) + annualSavings
 * `yearsToFi` is the smallest integer n with balance_n >= fireNumber; if the
 * starting principal already clears the FIRE number, yearsToFi is 0. If FI is
 * never reached within the horizon, yearsToFi / retirementAge are null.
 *
 * Throws on a non-positive safe withdrawal rate (the FIRE number would divide
 * by zero) — an invalid input the caller must guard before calling.
 */
export function computeFireProjection(inputs: FireInputs): FireResult {
  const {
    startingPrincipal,
    annualIncome,
    annualExpenses,
    nominalReturn,
    inflationRate,
    safeWithdrawalRate,
    currentAge,
    traditionalRetirementAge,
    baristaIncome,
    maxYears,
  } = inputs;

  if (safeWithdrawalRate <= 0) {
    throw new RangeError(`safeWithdrawalRate must be > 0, received ${safeWithdrawalRate}`);
  }

  const realReturn = toRealReturn(nominalReturn, inflationRate);
  const fireNumber = annualExpenses / safeWithdrawalRate;
  const annualSavings = annualIncome - annualExpenses;
  const savingsRate = annualIncome > 0 ? annualSavings / annualIncome : 0;

  const horizon = maxYears ?? Math.max(0, 100 - currentAge);

  // Walk the portfolio year by year. Push the starting point (n = 0) and every
  // subsequent year's balance up to and including the FI crossing (or the
  // horizon if FI is never reached).
  const projection: FireProjectionPoint[] = [];
  let balance = startingPrincipal;
  let yearsToFi: number | null = null;
  for (let n = 0; n <= horizon; n++) {
    projection.push({ age: currentAge + n, balance });
    if (balance >= fireNumber) {
      yearsToFi = n;
      break;
    }
    balance = balance * (1 + realReturn) + annualSavings;
  }
  const retirementAge = yearsToFi === null ? null : currentAge + yearsToFi;

  // Coast FIRE: the principal that, left untouched, compounds to the FIRE
  // number by the traditional retirement age. Undefined once the user is at or
  // past that age (no growth runway left to discount over).
  let coastFireNumber: number | null = null;
  let isCoastFi = false;
  if (traditionalRetirementAge > currentAge) {
    coastFireNumber = fireNumber / (1 + realReturn) ** (traditionalRetirementAge - currentAge);
    isCoastFi = startingPrincipal >= coastFireNumber;
  }

  // Barista FIRE: a part-time income covers part of expenses, so a smaller
  // portfolio suffices. With no part-time income this equals the full FIRE
  // number. Floored at 0 (a part-time income exceeding expenses needs nothing).
  const barista = baristaIncome ?? 0;
  const baristaFireNumber = Math.max(0, (annualExpenses - barista) / safeWithdrawalRate);
  const isBaristaFi = startingPrincipal >= baristaFireNumber;

  return {
    realReturn,
    fireNumber,
    annualSavings,
    savingsRate,
    yearsToFi,
    retirementAge,
    coastFireNumber,
    isCoastFi,
    baristaFireNumber,
    isBaristaFi,
    projection,
  };
}

/**
 * Months a user could live on current net worth with zero income, at a flat
 * real burn rate: `netWorth / (annualExpenses / 12)`.
 *
 * Returns `null` when `annualExpenses` is non-positive or non-finite — runway
 * is undefined without a positive burn rate (a zero-expense user never runs
 * out, which is not a meaningful month count). A negative net worth (liabilities
 * exceed assets) yields a negative number by design; it is not clamped, so the
 * view edge can decide how to present an underwater position. Returns a raw
 * float; rounding happens at the view edge.
 */
export function monthsOfRunway(netWorth: number, annualExpenses: number): number | null {
  if (!Number.isFinite(annualExpenses) || annualExpenses <= 0) return null;
  return netWorth / (annualExpenses / 12);
}
