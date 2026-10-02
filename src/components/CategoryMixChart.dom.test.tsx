// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { CategoryMixChart, NOT_ENOUGH_HISTORY, LIABILITIES_EXCLUDED } from "./CategoryMixChart";
import type { SnapshotItemWithDate } from "./AssetTrendsChart";

// M4: the rendered states of the category-mix card. Fixtures are synthetic.

const RATES = { USD: 1, EUR: 2, PLN: 4 };
const BAD_TEXT = /NaN|Infinity|null|undefined/;

interface Cat {
  id: string;
  name: string;
  is_liability: boolean;
  display_order: number;
}
const CASH: Cat = { id: "cat-cash", name: "Cash", is_liability: false, display_order: 1 };
const STOCKS: Cat = { id: "cat-stocks", name: "Stocks", is_liability: false, display_order: 2 };
const ODD: Cat = { id: "cat-odd", name: "<b>Crypto</b>", is_liability: false, display_order: 3 };
const LOAN: Cat = { id: "cat-loan", name: "Loan", is_liability: true, display_order: 9 };

function item(snapshot: number, cat: Cat, amount: number): SnapshotItemWithDate {
  return {
    id: `item-${snapshot}-${cat.id}`,
    snapshot_id: `snap-${snapshot}`,
    snapshotDate: `2026-0${snapshot}-01T00:00:00Z`,
    category_id: cat.id,
    name: `${cat.name} holding`,
    original_amount: amount,
    original_currency: "USD",
    converted_amount: amount,
    display_currency: "USD",
    display_order: 0,
    exchange_rate_usd: 1,
    created_at: `2026-0${snapshot}-01T00:00:00Z`,
    tag_ids: null,
    category: { ...cat, icon: null, created_at: "2026-01-01T00:00:00Z" },
  };
}

function renderChart(items: SnapshotItemWithDate[]) {
  return render(<CategoryMixChart snapshotItems={items} displayCurrency="USD" rates={RATES} />);
}

// happy-dom does no layout, so ResponsiveContainer would measure 0×0 and draw
// nothing. Size the container only (as TagTrendsChart.dom.test.tsx does).
function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("recharts-responsive-container") ? rect(600, 320) : rect(0, 0);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HISTORY = [
  item(1, CASH, 300),
  item(1, STOCKS, 100),
  item(1, LOAN, 200),
  item(2, CASH, 300),
  item(2, STOCKS, 200),
  item(2, ODD, 100), // appears late: zero-filled at snapshot 1
  item(2, LOAN, 150),
  item(3, LOAN, 100), // only a liability: no share row
];

function legendTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".recharts-legend-item-text")].map((n) => n.textContent).sort();
}

describe("CategoryMixChart rendered states", () => {
  it("state 1, the chart: stacked areas per category, names as text, the toggle switches views", async () => {
    const { container } = renderChart(HISTORY);
    expect(screen.getByRole("heading", { name: "Category Mix" })).toBeDefined();
    expect(screen.queryByText(NOT_ENOUGH_HISTORY)).toBeNull();

    // Share view (default): the three asset categories, no liability series.
    await waitFor(() => {
      expect(container.querySelectorAll(".recharts-area")).toHaveLength(3);
    });
    expect(container.querySelectorAll(".recharts-area-area").length).toBeGreaterThan(0);
    expect(legendTexts(container)).toEqual(["<b>Crypto</b>", "Cash", "Stocks"]);
    // A category name is text, never markup.
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).not.toMatch(BAD_TEXT);

    // Absolute view: the liability joins as its own series below the axis.
    fireEvent.click(screen.getByLabelText("USD"));
    expect(screen.getByLabelText<HTMLInputElement>("USD").checked).toBe(true);
    await waitFor(() => {
      expect(container.querySelectorAll(".recharts-area")).toHaveLength(4);
    });
    expect(legendTexts(container)).toEqual(["<b>Crypto</b>", "Cash", "Loan (liability)", "Stocks"]);
    expect(screen.queryByText(LIABILITIES_EXCLUDED)).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).not.toMatch(BAD_TEXT);

    // And back.
    fireEvent.click(screen.getByLabelText("Share %"));
    await waitFor(() => {
      expect(container.querySelectorAll(".recharts-area")).toHaveLength(3);
    });
  });

  it.each([
    ["no snapshots at all", []],
    ["one snapshot with several categories", [item(1, CASH, 100), item(1, STOCKS, 50), item(1, LOAN, 20)]],
    ["one snapshot holding only a liability", [item(1, LOAN, 500)]],
  ])("state 2, not enough history: %s", (_label, items) => {
    const { container } = renderChart(items);
    expect(screen.getByRole("heading", { name: "Category Mix" })).toBeDefined();
    expect(screen.getByText(NOT_ENOUGH_HISTORY)).toBeDefined();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
    expect(screen.queryByRole("group", { name: "Chart view" })).toBeNull();
    expect(screen.queryByText(LIABILITIES_EXCLUDED)).toBeNull();
    expect(container.textContent).not.toMatch(BAD_TEXT);
  });

  it("state 3, the share view with liabilities carries the one-line exclusion note", async () => {
    const { container } = renderChart(HISTORY);
    expect(screen.getByLabelText<HTMLInputElement>("Share %").checked).toBe(true);
    expect(screen.getByText(LIABILITIES_EXCLUDED)).toBeDefined();
    await waitFor(() => {
      expect(container.querySelectorAll(".recharts-area")).toHaveLength(3);
    });
    expect(legendTexts(container)).not.toContain("Loan (liability)");
    expect(container.textContent).not.toMatch(BAD_TEXT);
  });

  it("the share view without any liability shows no exclusion note", async () => {
    const { container } = renderChart([item(1, CASH, 100), item(2, CASH, 100), item(2, STOCKS, 100)]);
    await waitFor(() => {
      expect(container.querySelectorAll(".recharts-area")).toHaveLength(2);
    });
    expect(screen.queryByText(LIABILITIES_EXCLUDED)).toBeNull();
    expect(container.textContent).not.toMatch(BAD_TEXT);
  });
});
