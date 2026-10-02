import { describe, expect, it } from "vitest";
import {
  AVERAGE_WINDOW,
  buildSavingsRates,
  rateLabel,
  summarizeSavingsRates,
  type SavingsRateSnapshot,
} from "@/lib/savings-rate";

// Expected values are worked out from the definition (rate = contribution /
// income for the interval ending at a snapshot) and the rates below, not read
// back from the implementation. Rates are units per USD:
//   convertAmount(x, EUR, PLN) = x / 0.92 * 3.85
const RATES: Record<"PLN" | "USD" | "EUR", number> = { USD: 1.0, EUR: 0.92, PLN: 3.85 };

function snap(date: string, over: Partial<SavingsRateSnapshot> = {}): SavingsRateSnapshot {
  return { totalNetWorth: 1000, displayCurrency: "USD", netContribution: 0, income: null, date, ...over };
}

/** A two-snapshot history whose single interval carries `contribution` and `income`. */
function pair(contribution: number | null, income: number | null): SavingsRateSnapshot[] {
  return [snap("2026-01-01"), snap("2026-02-01", { netContribution: contribution, income })];
}

describe("buildSavingsRates: one interval, table", () => {
  it.each([
    // [case, contribution, income, rate, label]
    ["income null", 300, null, null, null],
    ["income 0", 300, 0, null, null],
    ["income negative (the DB forbids it; still unknown, never a rate)", 300, -100, null, null],
    ["contribution null", null, 1000, null, null],
    ["both null", null, null, null, null],
    ["a plain rate", 250, 1000, 0.25, null],
    ["a contribution of 0 is a known 0%, not unknown", 0, 1000, 0, null],
    ["exactly 100% carries no label", 1000, 1000, 1, null],
    ["a negative contribution is a withdrawal", -200, 1000, -0.2, "withdrawal"],
    ["above 100% is kept, not clamped", 1500, 1000, 1.5, "more than earned"],
  ] as const)("%s", (_case, contribution, income, rate, label) => {
    const [iv] = buildSavingsRates(pair(contribution, income), "USD", RATES);
    expect(iv.rate).toBe(rate);
    expect(iv.label).toBe(label);
    expect(iv.contribution).toBe(contribution);
    expect(iv.income).toBe(income);
  });
});

describe("buildSavingsRates: unknown is never 0 (R4)", () => {
  it.each([
    ["income missing", 500, null],
    ["contribution missing", null, 4000],
    ["income zero", 500, 0],
  ] as const)("%s → rate is null, not 0 and not NaN", (_case, contribution, income) => {
    const [iv] = buildSavingsRates(pair(contribution, income), "USD", RATES);
    expect(iv.rate).toBeNull();
    expect(iv.rate).not.toBe(0);
    expect(Number.isNaN(iv.rate)).toBe(false);
    expect(iv.label).toBeNull();
  });

  it("a history with nothing known averages to null with a count of 0, never 0% or NaN", () => {
    const s = summarizeSavingsRates(
      [
        snap("2026-01-01"),
        snap("2026-02-01", { netContribution: 100 }),
        snap("2026-03-01", { income: 900, netContribution: null }),
      ],
      "USD",
      RATES,
    );
    expect(s.intervals.map((iv) => iv.rate)).toEqual([null, null]);
    expect(s.average).toBeNull();
    expect(s.averageCount).toBe(0);
    expect(s.latest?.rate).toBeNull();
  });

  it("an unknown interval does not drag the average towards 0", () => {
    const s = summarizeSavingsRates(
      [
        snap("2026-01-01"),
        snap("2026-02-01", { netContribution: 400, income: 1000 }),
        snap("2026-03-01", { netContribution: 400, income: null }),
      ],
      "USD",
      RATES,
    );
    expect(s.average).toBe(0.4);
    expect(s.averageCount).toBe(1);
  });
});

describe("buildSavingsRates: currency", () => {
  it("converts income with contribution's convention (snapshot currency → display currency at today's rates)", () => {
    // Interval ends at an EUR snapshot: contribution 250 EUR, income 1000 EUR.
    const history = [
      snap("2026-01-01"),
      snap("2026-02-01", { displayCurrency: "EUR", netContribution: 250, income: 1000 }),
    ];
    const [iv] = buildSavingsRates(history, "PLN", RATES);
    expect(iv.contribution).toBeCloseTo((250 / 0.92) * 3.85, 6);
    expect(iv.income).toBeCloseTo((1000 / 0.92) * 3.85, 6);
    expect(iv.rate).toBeCloseTo(0.25, 12);
  });

  it("a display-currency switch mid-history leaves every rate unchanged; only the amounts move", () => {
    const history = [
      snap("2026-01-01", { displayCurrency: "USD" }),
      snap("2026-02-01", { displayCurrency: "USD", netContribution: 300, income: 1200 }),
      snap("2026-03-01", { displayCurrency: "PLN", netContribution: 1925, income: 7700 }),
    ];
    const inUsd = buildSavingsRates(history, "USD", RATES);
    const inPln = buildSavingsRates(history, "PLN", RATES);
    expect(inUsd.map((iv) => iv.rate)).toEqual([0.25, 0.25]);
    expect(inPln[0].rate).toBeCloseTo(0.25, 12);
    expect(inPln[1].rate).toBeCloseTo(0.25, 12);
    // 7700 PLN shown in USD = 2000; 1200 USD shown in PLN = 4620.
    expect(inUsd[1].income).toBeCloseTo(2000, 6);
    expect(inPln[0].income).toBeCloseTo(4620, 6);
  });
});

describe("buildSavingsRates: shape", () => {
  it("a single snapshot has no interval", () => {
    expect(buildSavingsRates([snap("2026-01-01", { netContribution: 100, income: 1000 })], "USD", RATES)).toEqual([]);
    const s = summarizeSavingsRates([snap("2026-01-01", { netContribution: 100, income: 1000 })], "USD", RATES);
    expect(s).toEqual({ intervals: [], latest: null, average: null, averageLabel: null, averageCount: 0 });
  });

  it("no snapshots at all", () => {
    expect(summarizeSavingsRates([], "USD", RATES).latest).toBeNull();
  });

  it("the first snapshot's own income is never used (it has no interval)", () => {
    const [iv] = buildSavingsRates(
      [snap("2026-01-01", { income: 5000, netContribution: 5000 }), snap("2026-02-01", { netContribution: 100 })],
      "USD",
      RATES,
    );
    expect(iv.rate).toBeNull();
  });

  it("unsorted input gives the same intervals as sorted input", () => {
    const sorted = [
      snap("2026-01-01"),
      snap("2026-02-01", { totalNetWorth: 1300, netContribution: 300, income: 1000 }),
      snap("2026-03-01", { totalNetWorth: 1500, netContribution: -100, income: 1000 }),
      snap("2026-04-01", { totalNetWorth: 2000, netContribution: 600, income: 400 }),
    ];
    const shuffled = [sorted[2], sorted[0], sorted[3], sorted[1]];
    const original = JSON.stringify(shuffled);
    expect(buildSavingsRates(shuffled, "USD", RATES)).toEqual(buildSavingsRates(sorted, "USD", RATES));
    expect(buildSavingsRates(shuffled, "USD", RATES).map((iv) => [iv.date, iv.rate])).toEqual([
      ["2026-02-01", 0.3],
      ["2026-03-01", -0.1],
      ["2026-04-01", 1.5],
    ]);
    expect(JSON.stringify(shuffled)).toBe(original); // input is not mutated
  });
});

describe("summarizeSavingsRates: the average of the last 6 known", () => {
  // Months 2..n each end an interval; `known[i]` gives that interval's rate or null.
  function history(known: (number | null)[]): SavingsRateSnapshot[] {
    return [
      snap("2026-01-01"),
      ...known.map((r, i) =>
        snap(
          `2026-${String(i + 2).padStart(2, "0")}-01`,
          r === null ? { netContribution: 100 } : { netContribution: r * 1000, income: 1000 },
        ),
      ),
    ];
  }

  it("with fewer than 6 known, averages what is known and says how many", () => {
    const s = summarizeSavingsRates(history([0.1, null, 0.2, null, 0.3, 0.4, null]), "USD", RATES);
    expect(s.averageCount).toBe(4);
    expect(s.average).toBeCloseTo(0.25, 12);
    expect(s.latest?.rate).toBeNull(); // the latest interval itself is unknown
    expect(s.latest?.date).toBe("2026-08-01");
  });

  it(`with more than ${AVERAGE_WINDOW} known, uses only the most recent ${AVERAGE_WINDOW}`, () => {
    const s = summarizeSavingsRates(history([0.9, 0.9, 0.1, 0.1, null, 0.1, 0.1, 0.1, 0.1]), "USD", RATES);
    expect(s.averageCount).toBe(AVERAGE_WINDOW);
    expect(s.average).toBeCloseTo(0.1, 12);
    expect(s.latest?.rate).toBeCloseTo(0.1, 12);
  });

  it("labels an average outside 0..100% the same way as an interval", () => {
    expect(summarizeSavingsRates(history([1.2, 1.4]), "USD", RATES).averageLabel).toBe("more than earned");
    expect(summarizeSavingsRates(history([-0.5, 0.1]), "USD", RATES).averageLabel).toBe("withdrawal");
  });
});

describe("summarizeSavingsRates: the average is pooled (B2.1 N1)", () => {
  // Pooled = sum(contribution) / sum(income) over the window. The plain mean of
  // rates would be (0.9 + 0.1) / 2 = 0.5; pooled is 1900 / 11000 = 0.1727...
  it("weights each interval by its income: a windfall in a low-income month does not dominate", () => {
    const s = summarizeSavingsRates(
      [
        snap("2026-01-01"),
        snap("2026-02-01", { netContribution: 900, income: 1000 }), // 90%
        snap("2026-03-01", { netContribution: 1000, income: 10000 }), // 10%
      ],
      "USD",
      RATES,
    );
    expect(s.averageCount).toBe(2);
    expect(s.average).toBeCloseTo(1900 / 11000, 12);
    expect(s.average).toBeCloseTo(0.1727, 4);
    // More than 10 points away from the plain mean.
    expect(Math.abs((s.average ?? 0) - 0.5)).toBeGreaterThan(0.1);
  });

  it("pools only the last 6 known intervals; unknown intervals add nothing to either sum", () => {
    const s = summarizeSavingsRates(
      [
        snap("2026-01-01"),
        snap("2026-02-01", { netContribution: 9000, income: 10000 }), // 7th known back: outside the window
        snap("2026-03-01", { netContribution: 100, income: 1000 }),
        snap("2026-04-01", { netContribution: 100, income: 1000 }),
        snap("2026-05-01", { netContribution: 5000, income: null }), // unknown: not pooled
        snap("2026-06-01", { netContribution: 100, income: 1000 }),
        snap("2026-07-01", { netContribution: 100, income: 1000 }),
        snap("2026-08-01", { netContribution: 100, income: 1000 }),
        snap("2026-09-01", { netContribution: 2000, income: 5000 }),
      ],
      "USD",
      RATES,
    );
    expect(s.averageCount).toBe(6);
    expect(s.average).toBeCloseTo(2500 / 10000, 12);
  });

  it("pools in the display currency: amounts converted from each snapshot's own currency", () => {
    // 250 EUR of 1000 EUR, then 1925 PLN of 3850 PLN, shown in USD:
    // contributions 271.739... + 500, incomes 1086.956... + 1000.
    const s = summarizeSavingsRates(
      [
        snap("2026-01-01"),
        snap("2026-02-01", { displayCurrency: "EUR", netContribution: 250, income: 1000 }),
        snap("2026-03-01", { displayCurrency: "PLN", netContribution: 1925, income: 3850 }),
      ],
      "USD",
      RATES,
    );
    expect(s.average).toBeCloseTo((250 / 0.92 + 500) / (1000 / 0.92 + 1000), 12);
  });
});

describe("rateLabel", () => {
  it.each([
    [null, null],
    [0, null],
    [0.5, null],
    [1, null],
    [1.0001, "more than earned"],
    [-0.0001, "withdrawal"],
  ] as const)("%s → %s", (rate, label) => {
    expect(rateLabel(rate)).toBe(label);
  });
});
