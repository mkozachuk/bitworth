import { describe, expect, it } from "vitest";
import type { ContributionSnapshot } from "./contributions";
import { computePeriodReturns, type PeriodReturns } from "./period-returns";

// Pins the measured numbers of the C-10 gather (Hermes Gather-BitWorth-
// ReturnMethods-2026-10-09, NB-077 script, mid timing) to 4 dp. Every series
// is single-currency USD, so convertAmount is the identity here.

const RATES = { USD: 1, EUR: 0.92, PLN: 3.85 };

function snap(date: string, totalNetWorth: number, netContribution: number | null): ContributionSnapshot {
  return { date, totalNetWorth, netContribution, displayCurrency: "USD" };
}

function run(s: ContributionSnapshot[]): PeriodReturns {
  return computePeriodReturns(s, "USD", RATES);
}

/** Percentage to 4 dp, the gather's print format. */
const pct = (x: number | null) => (x === null ? null : (x * 100).toFixed(4));

/** No field may carry NaN or Infinity. */
function expectFinite(r: PeriodReturns) {
  for (const v of [r.simple, r.modifiedDietz, r.twr]) {
    if (v !== null) expect(Number.isFinite(v)).toBe(true);
  }
  expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
}

// (a1): one (V, F) pair from each of the first five contributions.test.ts cases.
const A1 = [
  snap("2026-01-01", 1000, null),
  snap("2026-02-01", 1500, 300),
  snap("2026-03-01", 900, 100),
  snap("2026-04-01", 1100, -50),
  snap("2026-05-01", 1200, 0),
];

describe("computePeriodReturns: the gather's measured numbers", () => {
  it("(a1) multi-interval series: simple -15.0000%, MD -11.4961%, TWR -9.7066%", () => {
    const r = run(A1);
    expect(pct(r.simple)).toBe("-15.0000");
    expect(pct(r.modifiedDietz)).toBe("-11.4961");
    expect(pct(r.twr)).toBe("-9.7066");
    expect(r).toMatchObject({ start: "2026-01-01", end: "2026-05-01", covered: 4, total: 4, breaks: [] });
  });

  it("(a2) DB fixture series: 9.8971% / 9.9802% / 9.9802%", () => {
    const r = run([snap("2026-01-31T18:00:00Z", 15000.0, null), snap("2026-02-28T18:00:00Z", 16234.56, -250.0)]);
    expect(pct(r.simple)).toBe("9.8971");
    expect(pct(r.modifiedDietz)).toBe("9.9802");
    expect(pct(r.twr)).toBe("9.9802");
    expect(r).toMatchObject({ covered: 1, total: 1, breaks: [] });
  });

  it("(b2) a1 plus one null interval: the latest run is a1's, covering 4 of 5", () => {
    const r = run([...A1, snap("2026-06-01", 1500, null)]);
    expect(pct(r.simple)).toBe("-15.0000");
    expect(pct(r.modifiedDietz)).toBe("-11.4961");
    expect(pct(r.twr)).toBe("-9.7066");
    expect(r).toMatchObject({ start: "2026-01-01", end: "2026-05-01", covered: 4, total: 5, breaks: ["2026-06-01"] });
  });

  it("a null interval in the middle: the run is the part after the break", () => {
    const r = run([
      snap("2026-01-01", 1000, null),
      snap("2026-02-01", 1500, 300),
      snap("2026-03-01", 900, null),
      snap("2026-04-01", 1100, -50),
      snap("2026-05-01", 1200, 0),
    ]);
    expect(r).toMatchObject({ start: "2026-03-01", end: "2026-05-01", covered: 2, total: 4, breaks: ["2026-03-01"] });
    // simple = (1200 - 900 + 50) / 900
    expect(pct(r.simple)).toBe("38.8889");
    // MD: T = 61 d; the -50 flow sits at day 15.5, W = 45.5/61 -> den = 900 - 37.2951
    expect(pct(r.modifiedDietz)).toBe(((350 / (900 - (50 * 45.5) / 61)) * 100).toFixed(4));
    // TWR: (1 + 250/875) * (1 + 100/1100) - 1
    expect(pct(r.twr)).toBe((((1 + 250 / 875) * (1 + 100 / 1100) - 1) * 100).toFixed(4));
    // The pre-break interval (1000 -> 1500, F 300) must not leak in.
    expect(pct(r.twr)).not.toBe(pct(run(A1).twr));
  });

  it("(b) a single null interval: all three null, nothing covered", () => {
    const r = run([snap("2026-01-01", 1000, 0), snap("2026-02-01", 1500, null)]);
    expect(r).toEqual({
      simple: null,
      modifiedDietz: null,
      twr: null,
      start: null,
      end: null,
      covered: 0,
      total: 1,
      breaks: ["2026-02-01"],
    });
  });

  it("(e2) V_0 = 0: simple null, MD and TWR 20.0000%", () => {
    const r = run([snap("2026-01-01", 0, null), snap("2026-02-01", 1100, 1000)]);
    expect(r.simple).toBeNull();
    expect(pct(r.modifiedDietz)).toBe("20.0000");
    expect(pct(r.twr)).toBe("20.0000");
    expectFinite(r);
  });

  it("V_0 < 0: no NaN or Infinity in any field", () => {
    const r = run([snap("2026-01-01", -1000, null), snap("2026-02-01", -500, 100), snap("2026-03-01", 200, 0)]);
    expect(r.simple).toBeNull();
    expectFinite(r);
    const zero = run([snap("2026-01-01", -200, null), snap("2026-02-01", 0, 400)]);
    expectFinite(zero);
  });

  it("fewer than 2 snapshots: all three null", () => {
    expect(run([]).twr).toBeNull();
    const one = run([snap("2026-01-01", 1000, null)]);
    expect([one.simple, one.modifiedDietz, one.twr]).toEqual([null, null, null]);
    expect(one.total).toBe(0);
  });

  it("a null contribution is never read as 0", () => {
    // With null -> 0 the gather measured +15.0000% / +11.4149% / +12.8668% on (b2).
    const r = run([...A1, snap("2026-06-01", 1500, null)]);
    expect(pct(r.simple)).not.toBe("15.0000");
    expect(pct(r.twr)).not.toBe("12.8668");
  });

  it("converts contributions to the display currency like buildContributionSplits", () => {
    // 100 EUR at EUR 0.5 per USD = 200 USD; net worth is not re-converted.
    const r = computePeriodReturns(
      [
        { date: "2026-01-01", totalNetWorth: 1000, netContribution: null, displayCurrency: "USD" },
        { date: "2026-02-01", totalNetWorth: 1300, netContribution: 100, displayCurrency: "EUR" },
      ],
      "USD",
      { USD: 1, EUR: 0.5, PLN: 4 },
    );
    expect(pct(r.simple)).toBe("10.0000");
  });
});
