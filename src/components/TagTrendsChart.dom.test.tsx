// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { TagTrendsChart, NOT_ENOUGH_HISTORY, type DashboardTag } from "./TagTrendsChart";
import type { SnapshotItemWithDate } from "./AssetTrendsChart";

// T10: the three rendered states of the dashboard tag chart. Fixtures are
// synthetic.

const RATES = { USD: 1, EUR: 2, PLN: 4 };
const TAG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TAGS: DashboardTag[] = [
  { id: TAG_A, name: "Long term" },
  { id: TAG_B, name: "<b>Income</b>" },
];

function item(snapshot: number, amount: number, tagIds: string[] | null): SnapshotItemWithDate {
  return {
    id: `item-${snapshot}-${amount}`,
    snapshot_id: `snap-${snapshot}`,
    snapshotDate: `2026-0${snapshot}-01T00:00:00Z`,
    category_id: "cash",
    name: `Asset ${amount}`,
    original_amount: amount,
    original_currency: "USD",
    converted_amount: amount,
    display_currency: "USD",
    display_order: 0,
    exchange_rate_usd: 1,
    created_at: `2026-0${snapshot}-01T00:00:00Z`,
    tag_ids: tagIds,
    category: {
      id: "cash",
      name: "Cash",
      icon: null,
      is_liability: false,
      display_order: 1,
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

function renderChart(tags: DashboardTag[], items: SnapshotItemWithDate[]) {
  return render(<TagTrendsChart tags={tags} snapshotItems={items} displayCurrency="USD" rates={RATES} />);
}

// happy-dom does no layout, so ResponsiveContainer would measure 0×0 and draw
// nothing. Give the container (and only it: a legend measured at full height
// would leave the plot no room) the size a browser would.
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

describe("TagTrendsChart rendered states", () => {
  it("state 1, the chart: one line per dashboard tag, names as text, with the scale switch", async () => {
    const { container } = renderChart(TAGS, [
      item(1, 100, null), // before tags were recorded
      item(2, 100, [TAG_A]),
      item(2, 50, [TAG_A, TAG_B]),
      item(3, 120, [TAG_A]),
      item(3, 60, [TAG_B]),
    ]);
    expect(screen.getByRole("heading", { name: "Tag Trends" })).toBeDefined();
    expect(screen.queryByText(NOT_ENOUGH_HISTORY)).toBeNull();
    await waitFor(() => {
      expect(container.querySelectorAll(".recharts-line")).toHaveLength(2);
    });
    // Each line has a drawn path (2 recorded snapshots → a segment per tag).
    expect(container.querySelectorAll(".recharts-line-curve")).toHaveLength(2);
    const legend = [...container.querySelectorAll(".recharts-legend-item-text")].map((n) => n.textContent);
    // Recharts orders legend items by name; the set is what matters.
    expect(legend.sort()).toEqual(["<b>Income</b>", "Long term"]);
    // A tag name is text, never markup.
    expect(container.querySelector("b")).toBeNull();
    const scale = screen.getByRole("group", { name: "Chart scale" });
    expect(scale).toBeDefined();
    fireEvent.click(screen.getByLabelText("USD"));
    expect(screen.getByLabelText<HTMLInputElement>("USD").checked).toBe(true);
    await waitFor(() => {
      expect(container.querySelectorAll(".recharts-line")).toHaveLength(2);
    });
  });

  it.each([
    ["no snapshot has recorded tags yet (all NULL)", [item(1, 100, null), item(2, 100, null)]],
    ["only one snapshot has recorded tags", [item(1, 100, null), item(2, 100, [TAG_A])]],
    ["one recorded snapshot carrying both tags (2 values, 1 date)", [item(2, 100, [TAG_A, TAG_B])]],
    ["no snapshots at all", []],
  ])("state 2, not enough history: %s", (_label, items) => {
    const { container } = renderChart(TAGS, items);
    expect(screen.getByRole("heading", { name: "Tag Trends" })).toBeDefined();
    expect(screen.getByText(NOT_ENOUGH_HISTORY)).toBeDefined();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
    expect(screen.queryByRole("group", { name: "Chart scale" })).toBeNull();
  });

  it("state 3, absent: no tag toggled on renders no card at all, whatever the history", () => {
    const { container } = renderChart([], [item(2, 100, [TAG_A]), item(3, 100, [TAG_A])]);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("heading", { name: "Tag Trends" })).toBeNull();
  });
});
