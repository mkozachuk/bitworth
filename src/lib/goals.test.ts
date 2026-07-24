import { describe, expect, it } from "vitest";
import type { Currency } from "@/lib/net-worth";
import type { CagrFit, LinearFit, TrajectorySample } from "@/lib/trajectory";
import type { GoalAsset, GoalEta, GoalEtaInput, GoalValueInput } from "@/lib/goals";
import { categorySubtotal, goalCurrentValue, goalEta, goalProgressPct, onTrackVerdict } from "@/lib/goals";
import { fitLinear } from "@/lib/trajectory";

// Pins the savings-goal math against oracles computed from first principles —
// never by reading the implementation. Every expected number below is derived
// here in the comment above it, from the stated inputs alone, so the suite fails
// if goals.ts changes behaviour rather than merely changing shape.
//
// Percentages run on a 0–100 scale end-to-end with NO ×100/÷100 conversion
// anywhere; a 333.33-class probe guards that scaling-bug class in each module
// that divides.
//
// FP discipline (house style, src/lib/fire.test.ts): `toBe` for provably-exact
// results (integer sums, short-circuit guards, discriminant states, ISO strings);
// `toBeCloseTo(_, 6)` for anything involving a division or a currency conversion.

// Narrow a nullable fit without a non-null assertion (forbidden by eslint) and
// fail loudly if a fit that should succeed unexpectedly returned null.
function unwrap<T>(value: T | null): T {
  if (value === null) throw new Error("expected a non-null value");
  return value;
}

// Narrow a GoalEta to its `projected` variant, for the same reason.
function projected(eta: GoalEta): Extract<GoalEta, { status: "projected" }> {
  if (eta.status !== "projected") throw new Error(`expected a projected ETA, got ${eta.status}`);
  return eta;
}

// Clean, explicit rates so oracles are unambiguous. convertAmount semantics:
//   inUSD = amount / rates[from]; result = inUSD * rates[to].
// So with these literals: 100 EUR → 100/2 * 1 = 50 USD; 400 PLN → 400/4 * 1 = 100 USD.
const rates: Record<Currency, number> = { USD: 1, EUR: 2, PLN: 4 };

// Days-to-milliseconds, restated here rather than imported so the calendar
// oracle is independent of the module under test.
const MS_PER_DAY = 86_400_000;

// The first comparable snapshot sits at 2026-01-01T00:00:00.000Z; `t` counts days
// forward from it. 2026 is not a leap year (2026 / 4 is not an integer).
const ORIGIN_MS = Date.UTC(2026, 0, 1);

// The last historical sample sits 30 days after the origin.
const LAST_T = 30;

// A complete asset; individual tests override only what they exercise.
function asset(overrides: Partial<GoalAsset> = {}): GoalAsset {
  return { category_id: "savings", amount: 100, currency: "USD", ...overrides };
}

function valueGoal(overrides: Partial<GoalValueInput> = {}): GoalValueInput {
  return { kind: "net_worth", category_id: null, ...overrides };
}

function etaGoal(overrides: Partial<GoalEtaInput> = {}): GoalEtaInput {
  return { kind: "net_worth", targetInDisplayCurrency: 200_000, ...overrides };
}

// A perfectly collinear history: value = 100_000 + 1000*t at t = 0,10,20,30.
// Ordinary least squares through collinear integer points recovers slope 1000
// and intercept 100_000 exactly.
function risingSamples(): TrajectorySample[] {
  return [0, 10, 20, 30].map((t) => ({ t, value: 100_000 + 1000 * t }));
}

describe("categorySubtotal", () => {
  it("sums only the assets whose category matches, each converted into the display currency", () => {
    // savings holds 100 USD (→ 100) and 100 EUR (→ 100/2 = 50); stocks is excluded.
    // Oracle: 100 + 50 = 150 USD.
    const assets = [
      asset({ category_id: "savings", amount: 100, currency: "USD" }),
      asset({ category_id: "savings", amount: 100, currency: "EUR" }),
      asset({ category_id: "stocks", amount: 400, currency: "PLN" }),
    ];
    expect(categorySubtotal(assets, "savings", "USD", rates)).toBeCloseTo(150, 6);
  });

  it("returns 0 for a category no asset belongs to", () => {
    expect(categorySubtotal([asset({ category_id: "savings" })], "crypto", "USD", rates)).toBe(0);
  });

  it("returns 0 for an empty asset list", () => {
    expect(categorySubtotal([], "savings", "USD", rates)).toBe(0);
  });

  it("counts a liability category at its stored sign instead of filtering it out", () => {
    // A mortgage is a legitimate goal denominator ("pay it down"), so the 250_000
    // is summed as stored — no liability negation, no exclusion.
    const assets = [
      asset({ category_id: "mortgage", amount: 250_000, currency: "USD" }),
      asset({ category_id: "savings", amount: 100, currency: "USD" }),
    ];
    expect(categorySubtotal(assets, "mortgage", "USD", rates)).toBe(250_000);
  });

  it("keeps non-positive amounts in the sum rather than dropping them", () => {
    // 100 + (-30) = 70. Dropping the negative row would over-report by 30.
    const assets = [
      asset({ category_id: "savings", amount: 100, currency: "USD" }),
      asset({ category_id: "savings", amount: -30, currency: "USD" }),
    ];
    expect(categorySubtotal(assets, "savings", "USD", rates)).toBe(70);
  });

  it("converts into a non-USD display currency", () => {
    // 100 USD → 100/1 * 2 = 200 EUR.
    expect(categorySubtotal([asset({ amount: 100, currency: "USD" })], "savings", "EUR", rates)).toBeCloseTo(200, 6);
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // 33_333.33 PLN → 33_333.33 / 4 = 8_333.3325 USD. A ×100/÷100 bug lands two
    // orders off and fails even a coarse comparison.
    const assets = [asset({ category_id: "savings", amount: 33_333.33, currency: "PLN" })];
    expect(categorySubtotal(assets, "savings", "USD", rates)).toBeCloseTo(33_333.33 / 4, 6);
  });
});

describe("goalCurrentValue", () => {
  it("returns the precomputed net worth for a net_worth goal, ignoring the asset list", () => {
    // The assets sum to 100 USD but must not influence a net-worth goal — the card
    // has to agree with the dashboard headline figure.
    const value = goalCurrentValue(valueGoal({ kind: "net_worth" }), [asset({ amount: 100 })], 250_000, "USD", rates);
    expect(value).toBe(250_000);
  });

  it("delegates a category goal to that category's subtotal", () => {
    // savings = 100 USD + 100 EUR (→ 50) = 150; the 999_999 net worth is irrelevant.
    const assets = [
      asset({ category_id: "savings", amount: 100, currency: "USD" }),
      asset({ category_id: "savings", amount: 100, currency: "EUR" }),
      asset({ category_id: "stocks", amount: 400, currency: "PLN" }),
    ];
    const goal = valueGoal({ kind: "category", category_id: "savings" });
    expect(goalCurrentValue(goal, assets, 999_999, "USD", rates)).toBeCloseTo(150, 6);
  });

  it("returns 0 for a category goal carrying no category id", () => {
    // The DB CHECK forbids this pairing; the math still has to be total.
    const goal = valueGoal({ kind: "category", category_id: null });
    expect(goalCurrentValue(goal, [asset({ amount: 100 })], 250_000, "USD", rates)).toBe(0);
  });
});

describe("goalProgressPct", () => {
  it("reports the plain ratio on a 0-100 scale", () => {
    // 25_000 / 100_000 * 100 = 25
    expect(goalProgressPct(25_000, 100_000)).toBeCloseTo(25, 6);
  });

  it("returns 0 instead of Infinity for a zero target", () => {
    expect(goalProgressPct(25_000, 0)).toBe(0);
  });

  it("returns 0 for a target magnitude below EPSILON", () => {
    // EPSILON is 1e-2, so 0.009 and -0.005 are both dust, not denominators.
    expect(goalProgressPct(25_000, 0.009)).toBe(0);
    expect(goalProgressPct(25_000, -0.005)).toBe(0);
  });

  it("still divides at the EPSILON boundary itself", () => {
    // 0.01 is not BELOW 1e-2, so the guard does not fire: 0.005 / 0.01 * 100 = 50.
    expect(goalProgressPct(0.005, 0.01)).toBeCloseTo(50, 6);
  });

  it("leaves an overshoot uncapped so the label can show the true ratio", () => {
    // 150_000 / 100_000 * 100 = 150 — the view edge clamps the bar, not the number.
    expect(goalProgressPct(150_000, 100_000)).toBeCloseTo(150, 6);
  });

  it("returns exactly 0 for a zero current value", () => {
    expect(goalProgressPct(0, 100_000)).toBe(0);
  });

  it("reports a negative percentage for an underwater current value (documented, not clamped)", () => {
    // -50_000 / 100_000 * 100 = -50
    expect(goalProgressPct(-50_000, 100_000)).toBeCloseTo(-50, 6);
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // 33_333.33 / 100_000 * 100 = 33.33333 — a ×100/÷100 bug lands two orders off.
    expect(goalProgressPct(33_333.33, 100_000)).toBeCloseTo(33.33333, 6);
  });
});

describe("goalEta", () => {
  it("returns unsupported for a category goal even when a valid fit is in hand", () => {
    // No per-category history exists yet, so the net-worth trend is the wrong
    // series to project from — the row is hidden rather than guessed.
    const fit = unwrap(fitLinear(risingSamples()));
    const eta = goalEta(etaGoal({ kind: "category" }), fit, LAST_T, ORIGIN_MS, 50, 4);
    expect(eta).toEqual({ status: "unsupported" });
  });

  it("returns unsupported for a category goal that is already past 100 percent", () => {
    // Kind is checked before progress, so a completed category goal still hides
    // the ETA row rather than claiming a projection it cannot make.
    const fit = unwrap(fitLinear(risingSamples()));
    const eta = goalEta(etaGoal({ kind: "category" }), fit, LAST_T, ORIGIN_MS, 150, 4);
    expect(eta).toEqual({ status: "unsupported" });
  });

  it("returns reached at exactly 100 percent", () => {
    const fit = unwrap(fitLinear(risingSamples()));
    expect(goalEta(etaGoal(), fit, LAST_T, ORIGIN_MS, 100, 4)).toEqual({ status: "reached" });
  });

  it("returns reached above 100 percent", () => {
    const fit = unwrap(fitLinear(risingSamples()));
    expect(goalEta(etaGoal(), fit, LAST_T, ORIGIN_MS, 150, 4)).toEqual({ status: "reached" });
  });

  it("returns reached without any history when progress already clears the target", () => {
    // Progress is checked before the history guard: a goal that is done is done,
    // whether or not there are snapshots to project from.
    expect(goalEta(etaGoal(), null, LAST_T, ORIGIN_MS, 150, 0)).toEqual({ status: "reached" });
  });

  it("returns insufficient_history when fewer than two comparable snapshots exist", () => {
    // A user who just switched display currency has one comparable snapshot. The
    // fit handed in is perfectly valid, so this must NOT read as not_reaching —
    // telling them their trend never gets there would simply be false.
    const fit = unwrap(fitLinear(risingSamples()));
    expect(goalEta(etaGoal(), fit, LAST_T, ORIGIN_MS, 50, 1)).toEqual({ status: "insufficient_history" });
  });

  it("returns insufficient_history when the fit is null", () => {
    // fitLinear returns null on a zero-variance t axis — e.g. two snapshots taken
    // on the same calendar day. Plenty of samples, still no line.
    expect(goalEta(etaGoal(), null, LAST_T, ORIGIN_MS, 50, 5)).toEqual({ status: "insufficient_history" });
  });

  it("returns not_reaching for a flat trend", () => {
    // value = 100_000 for all t; a 200_000 target is never crossed.
    const flat: LinearFit = { model: "linear", slope: 0, intercept: 100_000 };
    expect(goalEta(etaGoal(), flat, LAST_T, ORIGIN_MS, 50, 4)).toEqual({ status: "not_reaching" });
  });

  it("returns not_reaching for a declining trend whose crossing lies in the past", () => {
    // value = 200_000 - 1000*t. At lastT = 30 the value is 170_000; a 180_000
    // target was crossed at t = 20, i.e. behind us, and the trend is falling away
    // from it. Progress is 170_000 / 180_000 * 100 = 94.44..., so `reached` does
    // not fire and the solver's null correctly means "not on this trend".
    const declining: LinearFit = { model: "linear", slope: -1000, intercept: 200_000 };
    const goal = etaGoal({ targetInDisplayCurrency: 180_000 });
    expect(goalEta(goal, declining, LAST_T, ORIGIN_MS, (170_000 / 180_000) * 100, 4)).toEqual({
      status: "not_reaching",
    });
  });

  it("projects the calendar date on which the trend crosses the target", () => {
    // Fit: value = 100_000 + 1000*t. Target 200_000 → t = (200_000 - 100_000)/1000
    // = 100 days, which is forward of lastT = 30. Origin 2026-01-01 plus 100 days:
    // +31 → Feb 1, +28 (2026 is not a leap year) → Mar 1, +31 → Apr 1, +10 → Apr 11.
    const fit = unwrap(fitLinear(risingSamples()));
    const eta = projected(goalEta(etaGoal(), fit, LAST_T, ORIGIN_MS, 50, 4));
    expect(eta.date).toBe("2026-04-11T00:00:00.000Z");
  });

  it("anchors the projected date on the supplied origin, not on today", () => {
    // Same 100-day crossing, origin moved back a year. 2025 is not a leap year
    // either, so the same +31/+28/+31/+10 walk lands on 2025-04-11.
    const fit = unwrap(fitLinear(risingSamples()));
    const eta = projected(goalEta(etaGoal(), fit, LAST_T, Date.UTC(2025, 0, 1), 50, 4));
    expect(eta.date).toBe("2025-04-11T00:00:00.000Z");
  });

  it("projects a compound-growth fit as opaquely as a linear one", () => {
    // value = exp(ln(100_000) + (ln 2 / 100) * t) — a doubling every 100 days.
    // Target 200_000 → t = (ln 200_000 - ln 100_000) / (ln 2 / 100) = 100 days,
    // landing on the same 2026-04-11 as the linear case. Compared with a 1s
    // tolerance because the log/exp round-trip is not bit-exact.
    const fit: CagrFit = { model: "cagr", logIntercept: Math.log(100_000), logSlope: Math.log(2) / 100 };
    const eta = projected(goalEta(etaGoal(), fit, LAST_T, ORIGIN_MS, 50, 4));
    expect(Math.abs(Date.parse(eta.date) - Date.parse("2026-04-11T00:00:00.000Z"))).toBeLessThan(1000);
  });

  it("survives a 333.33-class FP probe without scaling drift", () => {
    // value = 333.33*t; target 33_333 → t = 33_333 / 333.33 = 100 days exactly
    // (333.33 × 100 = 33_333), give or take one ULP of binary rounding.
    // The projected instant is origin + that many days; a ×100/÷100 bug would put
    // it roughly 27 years out. Sub-millisecond tolerance covers Date's truncation.
    const fit: LinearFit = { model: "linear", slope: 333.33, intercept: 0 };
    const goal = etaGoal({ targetInDisplayCurrency: 33_333 });
    const eta = projected(goalEta(goal, fit, 0, ORIGIN_MS, 50, 4));
    expect(Math.abs(Date.parse(eta.date) - (ORIGIN_MS + (33_333 / 333.33) * MS_PER_DAY))).toBeLessThan(1);
  });
});

describe("onTrackVerdict", () => {
  const projectedEta: GoalEta = { status: "projected", date: "2026-04-11T00:00:00.000Z" };

  it("reports on_track when the projected date precedes the target date", () => {
    expect(onTrackVerdict(projectedEta, "2026-12-31")).toBe("on_track");
  });

  it("reports behind when the projected date falls after the target date", () => {
    expect(onTrackVerdict(projectedEta, "2026-01-31")).toBe("behind");
  });

  it("counts a projection landing on the target day itself as on_track", () => {
    // target_date is a SQL DATE with no time-of-day, so an ETA at 18:30 on the
    // same calendar day must not read as behind.
    const sameDay: GoalEta = { status: "projected", date: "2026-04-11T18:30:00.000Z" };
    expect(onTrackVerdict(sameDay, "2026-04-11")).toBe("on_track");
  });

  it("returns null when there is no ETA", () => {
    expect(onTrackVerdict(null, "2026-12-31")).toBeNull();
    expect(onTrackVerdict(undefined, "2026-12-31")).toBeNull();
  });

  it("returns null when there is no target date", () => {
    expect(onTrackVerdict(projectedEta, null)).toBeNull();
    expect(onTrackVerdict(projectedEta, undefined)).toBeNull();
  });

  it("returns null for every non-projected ETA status", () => {
    // Nothing to compare against, so no badge at all — a guessed badge would be
    // worse than none.
    expect(onTrackVerdict({ status: "reached" }, "2026-12-31")).toBeNull();
    expect(onTrackVerdict({ status: "not_reaching" }, "2026-12-31")).toBeNull();
    expect(onTrackVerdict({ status: "insufficient_history" }, "2026-12-31")).toBeNull();
    expect(onTrackVerdict({ status: "unsupported" }, "2026-12-31")).toBeNull();
  });
});
