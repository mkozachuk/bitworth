import { describe, expect, it } from "vitest";
import type { ContributionSnapshot } from "@/lib/contributions";
import { buildContributionSplits } from "@/lib/contributions";

// Pins the contribution/growth split identity (growth = totalChange -
// contribution) and every edge case before any UI consumes it. Each expected
// value is derived from first principles (the rates below + the split formula),
// not by reading the implementation.
//
// Rates are units-per-USD (USD === 1.0). They carry real conversions so
// cross-currency contribution math is meaningfully exercised:
//   convertAmount(x, PLN, USD) = x / 3.85
//   convertAmount(x, EUR, USD) = x / 0.92
// USD<->USD short-circuits, so same-currency cases stay exact integers.

const RATES: Record<"PLN" | "USD" | "EUR", number> = { USD: 1.0, EUR: 0.92, PLN: 3.85 };

function snapshot(over: Partial<ContributionSnapshot>): ContributionSnapshot {
  return {
    totalNetWorth: 0,
    displayCurrency: "USD",
    netContribution: 0,
    date: "2026-01-01",
    ...over,
  };
}

describe("buildContributionSplits", () => {
  it("splits a positive change into contribution + growth (identity holds)", () => {
    const snapshots = [
      snapshot({ date: "2026-01-01", totalNetWorth: 1000 }),
      snapshot({ date: "2026-02-01", totalNetWorth: 1500, netContribution: 300 }),
    ];

    // totalChange = 1500 - 1000 = 500; contribution = 300 (USD->USD);
    // growth = 500 - 300 = 200; contribution + growth = 500 = totalChange.
    expect(buildContributionSplits(snapshots, "USD", RATES)).toEqual([
      { date: "2026-02-01", totalChange: 500, kind: "split", contribution: 300, growth: 200 },
    ]);
  });

  it("reports negative growth when markets drop despite a positive contribution", () => {
    const snapshots = [
      snapshot({ date: "2026-01-01", totalNetWorth: 1000 }),
      snapshot({ date: "2026-02-01", totalNetWorth: 900, netContribution: 100 }),
    ];

    // totalChange = 900 - 1000 = -100; contribution = 100;
    // growth = -100 - 100 = -200 (the market lost 200, deposits added 100).
    expect(buildContributionSplits(snapshots, "USD", RATES)).toEqual([
      { date: "2026-02-01", totalChange: -100, kind: "split", contribution: 100, growth: -200 },
    ]);
  });

  it("treats a withdrawal (negative contribution) so growth = totalChange + |contribution|", () => {
    const snapshots = [
      snapshot({ date: "2026-01-01", totalNetWorth: 1000 }),
      snapshot({ date: "2026-02-01", totalNetWorth: 1100, netContribution: -50 }),
    ];

    // totalChange = 1100 - 1000 = 100; contribution = -50 (withdrew 50);
    // growth = 100 - (-50) = 150 = totalChange + |contribution|.
    expect(buildContributionSplits(snapshots, "USD", RATES)).toEqual([
      { date: "2026-02-01", totalChange: 100, kind: "split", contribution: -50, growth: 150 },
    ]);
  });

  it("flags an interval as unknown when net_contribution is null", () => {
    const snapshots = [
      snapshot({ date: "2026-01-01", totalNetWorth: 1000 }),
      snapshot({ date: "2026-02-01", totalNetWorth: 1500, netContribution: null }),
    ];

    // totalChange still computable; the split is not.
    expect(buildContributionSplits(snapshots, "USD", RATES)).toEqual([
      { date: "2026-02-01", totalChange: 500, kind: "unknown" },
    ]);
  });

  it("treats net_contribution = 0 as a known split (growth = totalChange), distinct from null", () => {
    const snapshots = [
      snapshot({ date: "2026-01-01", totalNetWorth: 1000 }),
      snapshot({ date: "2026-02-01", totalNetWorth: 1200, netContribution: 0 }),
    ];

    // contribution = 0; growth = 200 - 0 = 200 = totalChange. kind is "split", not "unknown".
    expect(buildContributionSplits(snapshots, "USD", RATES)).toEqual([
      { date: "2026-02-01", totalChange: 200, kind: "split", contribution: 0, growth: 200 },
    ]);
  });

  it("re-converts the stored contribution to the display currency (entry PLN, view USD)", () => {
    const snapshots = [
      snapshot({ date: "2026-01-01", displayCurrency: "PLN", totalNetWorth: 5000 }),
      snapshot({ date: "2026-02-01", displayCurrency: "PLN", totalNetWorth: 6000, netContribution: 1000 }),
    ];

    const [result] = buildContributionSplits(snapshots, "USD", RATES);

    // Net worth is NOT cross-converted (v1 caveat): totalChange = 6000 - 5000 = 1000.
    // contribution = convertAmount(1000 PLN, PLN, USD) = 1000 / 3.85 = 259.74025974...
    // growth = 1000 - 259.74025974... = 740.25974025...
    expect(result.kind).toBe("split");
    expect(result.totalChange).toBe(1000);
    if (result.kind === "split") {
      expect(result.contribution).toBeCloseTo(259.74025974, 6);
      expect(result.growth).toBeCloseTo(740.25974025, 6);
    }
  });

  it("snaps float dust below EPSILON to exactly 0 (totalChange, contribution, growth)", () => {
    const snapshots = [
      snapshot({ date: "2026-01-01", totalNetWorth: 1000 }),
      snapshot({ date: "2026-02-01", totalNetWorth: 1000.005, netContribution: 0.004 }),
    ];

    // raw totalChange = 0.005 < EPSILON (1e-2) -> 0; contribution = 0.004 -> 0; growth -> 0.
    expect(buildContributionSplits(snapshots, "USD", RATES)).toEqual([
      { date: "2026-02-01", totalChange: 0, kind: "split", contribution: 0, growth: 0 },
    ]);
  });

  it("snaps a near-zero growth to 0 even when totalChange and contribution are real", () => {
    const snapshots = [
      snapshot({ date: "2026-01-01", totalNetWorth: 1000 }),
      snapshot({ date: "2026-02-01", totalNetWorth: 1100, netContribution: 99.997 }),
    ];

    // totalChange = 100; contribution = 99.997 (kept, > EPSILON);
    // raw growth = 100 - 99.997 = 0.003 < EPSILON -> 0.
    expect(buildContributionSplits(snapshots, "USD", RATES)).toEqual([
      { date: "2026-02-01", totalChange: 100, kind: "split", contribution: 99.997, growth: 0 },
    ]);
  });

  it("emits nothing for a single snapshot (no predecessor)", () => {
    expect(buildContributionSplits([snapshot({ totalNetWorth: 1000 })], "USD", RATES)).toEqual([]);
  });

  it("emits nothing for empty input", () => {
    expect(buildContributionSplits([], "USD", RATES)).toEqual([]);
  });
});
