// @vitest-environment happy-dom
import { render, screen, cleanup, within } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { SavingsRateCard, NOTHING_KNOWN, SUBTITLE, formatRate } from "./SavingsRateCard";
import { ContributionsChart } from "./ContributionsChart";
import type { Tables } from "@/lib/database.types";

// R5: the four rendered states of the savings-rate card, plus the per-interval
// rate on ContributionsChart. Fixtures are synthetic.

const RATES = { USD: 1, EUR: 0.5, PLN: 4 };

function row(month: number, over: Partial<Tables<"snapshots">> = {}): Tables<"snapshots"> {
  return {
    id: `snap-${month}`,
    user_id: "user-1",
    total_net_worth: 1000 * month,
    display_currency: "USD",
    base_currency: "USD",
    source: "manual",
    note: null,
    net_contribution: null,
    income: null,
    created_at: `2026-${String(month).padStart(2, "0")}-01T12:00:00Z`,
    ...over,
  };
}

afterEach(cleanup);

/** No state may leak a non-number into the page. */
function expectNoJunk(container: HTMLElement) {
  const text = container.textContent;
  expect(text).not.toMatch(/NaN|Infinity|null|undefined/);
}

function card(snapshots: Tables<"snapshots">[]) {
  const { container } = render(<SavingsRateCard snapshots={snapshots} displayCurrency="USD" rates={RATES} />);
  expect(screen.getByRole("heading", { name: "Savings rate" })).toBeDefined();
  return container;
}

describe("SavingsRateCard: income is after tax (B2.1 N4)", () => {
  it.each([
    ["nothing known", [row(1)]],
    ["a known rate", [row(1), row(2, { net_contribution: 300, income: 1000 })]],
  ] as const)("the subtitle says the rate is of after-tax income: %s", (_case, snapshots) => {
    const container = card([...snapshots]);
    expect(screen.getByText(SUBTITLE)).toBeDefined();
    expect(container.textContent).toMatch(/of after-tax income/);
    expectNoJunk(container);
  });
});

describe("SavingsRateCard: rendered states", () => {
  it("1. known latest and average, the average labelled with its count", () => {
    const container = card([
      row(1),
      row(2, { net_contribution: 300, income: 1000 }), // 30%
      row(3, { net_contribution: 100, income: null }), // unknown
      row(4, { net_contribution: 500, income: 2000 }), // 25%
    ]);
    const latest = screen.getByTestId("savings-rate-latest");
    const average = screen.getByTestId("savings-rate-average");
    expect(within(latest).getByText("25.0%")).toBeDefined();
    expect(latest.textContent).toContain("Latest interval, to Apr 1, 2026");
    expect(within(average).getByText("avg of 2 known")).toBeDefined();
    // Pooled (B2.1 N1): (300 + 500) / (1000 + 2000) = 26.7%. It read 27.5%, the
    // plain mean of 30% and 25%, before the average was pooled.
    expect(within(average).getByText("26.7%")).toBeDefined();
    expect(container.textContent).not.toMatch(/more than earned|withdrawal/);
    expect(screen.queryByText(NOTHING_KNOWN)).toBeNull();
    expectNoJunk(container);
  });

  it("2. a rate above 100% is shown as it is, with its label", () => {
    const container = card([row(1), row(2, { net_contribution: 1500, income: 1000 })]);
    const latest = screen.getByTestId("savings-rate-latest");
    expect(latest.textContent).toContain("150.0%");
    expect(within(latest).getByText("more than earned")).toBeDefined();
    expect(within(screen.getByTestId("savings-rate-average")).getByText("more than earned")).toBeDefined();
    expect(screen.getByText("avg of 1 known")).toBeDefined();
    expectNoJunk(container);
  });

  it("3. a negative rate is shown as it is, with its label", () => {
    const container = card([row(1), row(2, { net_contribution: -200, income: 1000 })]);
    const latest = screen.getByTestId("savings-rate-latest");
    expect(latest.textContent).toContain("−20.0%");
    expect(within(latest).getByText("withdrawal")).toBeDefined();
    expectNoJunk(container);
  });

  it.each([
    ["no snapshots", []],
    ["one snapshot", [row(1, { net_contribution: 100, income: 1000 })]],
    ["contributions but no income", [row(1), row(2, { net_contribution: 300 }), row(3, { net_contribution: 50 })]],
    ["income 0 everywhere", [row(1), row(2, { net_contribution: 300, income: 0 })]],
    ["income but no contribution", [row(1), row(2, { income: 4000 })]],
  ])("4. nothing known (%s): the card is present with the prompt, and shows no 0%%", (_case, snapshots) => {
    const container = card(snapshots);
    expect(screen.getByText(NOTHING_KNOWN)).toBeDefined();
    expect(screen.queryByTestId("savings-rate-latest")).toBeNull();
    expect(container.textContent).not.toContain("0.0%");
    expectNoJunk(container);
  });

  it("the latest interval may be unknown while the average is known: words, not 0%", () => {
    const container = card([row(1), row(2, { net_contribution: 400, income: 1000 }), row(3, { net_contribution: 10 })]);
    const latest = screen.getByTestId("savings-rate-latest");
    expect(latest.textContent).toContain("Not known yet");
    expect(latest.textContent).not.toMatch(/%/);
    expect(within(screen.getByTestId("savings-rate-average")).getByText("40.0%")).toBeDefined();
    expectNoJunk(container);
  });

  it("a row read before the migration (no income key at all) counts as unknown, not NaN", () => {
    const legacy = row(2, { net_contribution: 300 }) as Partial<Tables<"snapshots">>;
    delete legacy.income;
    const container = card([row(1), legacy as Tables<"snapshots">]);
    expect(screen.getByText(NOTHING_KNOWN)).toBeDefined();
    expectNoJunk(container);
  });
});

describe("formatRate", () => {
  it.each([
    [0.255, "25.5%"],
    [0, "0.0%"],
    [1.5, "150.0%"],
    [-0.2, "−20.0%"],
  ])("%s → %s", (rate, text) => {
    expect(formatRate(rate)).toBe(text);
  });
});

describe("ContributionsChart: per-interval savings rate label", () => {
  it("labels known intervals with their rate and leaves unknown ones unlabelled", () => {
    const { container } = render(
      <ContributionsChart
        snapshots={[
          row(1),
          row(2, { net_contribution: 300, income: 1000 }),
          row(3, { net_contribution: 100 }),
          row(4, { net_contribution: 1500, income: 1000 }),
          row(5, { net_contribution: -200, income: 1000 }),
        ]}
        displayCurrency="USD"
        rates={RATES}
      />,
    );
    const labels = screen.getAllByTestId("interval-savings-rate").map((el) => el.textContent);
    expect(labels).toEqual([
      "saved 30.0% of income",
      "saved 150.0% of income · more than earned",
      "saved −20.0% of income · withdrawal",
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expectNoJunk(container);
  });
});
