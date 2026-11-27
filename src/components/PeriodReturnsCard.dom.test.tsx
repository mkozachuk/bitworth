// @vitest-environment happy-dom
import { render, screen, cleanup, within } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PeriodReturnsCard, EXPLAIN_SIMPLE, EXPLAIN_DIETZ, EXPLAIN_TWR, formatReturn } from "./PeriodReturnsCard";
import type { Tables } from "@/lib/database.types";

// B5: TWR leads outside <details>; simple and Modified Dietz sit inside it,
// closed; a broken chain is said in words. Fixtures are synthetic: the gather's
// (a1) series, with a null interval appended for the broken case.

const RATES = { USD: 1, EUR: 0.5, PLN: 4 };

function row(month: number, nw: number, contribution: number | null, currency = "USD"): Tables<"snapshots"> {
  return {
    id: `snap-${month}`,
    user_id: "user-1",
    total_net_worth: nw,
    display_currency: currency,
    base_currency: "USD",
    source: "manual",
    note: null,
    net_contribution: contribution,
    income: null,
    client_request_id: null,
    created_at: `2026-${String(month).padStart(2, "0")}-01T12:00:00Z`,
  };
}

const WHOLE = [row(1, 1000, null), row(2, 1500, 300), row(3, 900, 100), row(4, 1100, -50), row(5, 1200, 0)];
const BROKEN = [...WHOLE, row(6, 1500, null)];

afterEach(cleanup);

function card(snapshots: Tables<"snapshots">[], displayCurrency: "USD" | "EUR" | "PLN" = "USD") {
  return render(<PeriodReturnsCard snapshots={snapshots} displayCurrency={displayCurrency} rates={RATES} />).container;
}

describe("PeriodReturnsCard", () => {
  it("shows TWR outside a closed <details> holding the two other figures", () => {
    const container = card(WHOLE);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(within(details as HTMLElement).getByText("Details").tagName).toBe("SUMMARY");

    const twr = screen.getByTestId("period-returns-twr");
    expect(twr.closest("details")).toBeNull();
    expect(twr.textContent).toContain(formatReturn(-0.097066));
    expect(twr.textContent).toContain("Jan 1, 2026");
    expect(twr.textContent).toContain("May 1, 2026");

    const simple = screen.getByTestId("period-returns-simple");
    const dietz = screen.getByTestId("period-returns-dietz");
    expect(simple.closest("details")).toBe(details);
    expect(dietz.closest("details")).toBe(details);
    expect(simple.textContent).toContain("−15.00%");
    expect(dietz.textContent).toContain("−11.50%");

    for (const line of [EXPLAIN_SIMPLE, EXPLAIN_DIETZ, EXPLAIN_TWR]) {
      expect(screen.getAllByText(line)).toHaveLength(1);
    }
    expect(container.textContent).not.toMatch(/NaN|Infinity|null|undefined/);
  });

  it("no broken-chain notice on a whole chain", () => {
    const container = card(WHOLE);
    expect(screen.queryByTestId("period-returns-broken")).toBeNull();
    expect(container.textContent).not.toContain("Chain broken");
  });

  it("a broken chain shows the notice with the date and the coverage", () => {
    card(BROKEN);
    const notice = screen.getByTestId("period-returns-broken");
    expect(notice.textContent).toContain("Chain broken: contribution not recorded for Jun 1, 2026");
    expect(notice.textContent).toContain("covers 4 of 5 intervals");
    // The latest known run still reads (a1)'s TWR.
    expect(screen.getByTestId("period-returns-twr").textContent).toContain("−9.71%");
  });

  it("an unknown figure reads as an em dash", () => {
    card([row(1, 1000, 0), row(2, 1500, null)]);
    expect(screen.getByTestId("period-returns-twr").textContent).toContain("—");
    expect(screen.getByTestId("period-returns-simple").textContent).toContain("—");
  });

  it("renders nothing for fewer than 2 comparable snapshots", () => {
    expect(card([row(1, 1000, null)]).innerHTML).toBe("");
    // Two snapshots, but only one in the current display currency.
    expect(card([row(1, 1000, null), row(2, 1500, 300, "EUR")]).innerHTML).toBe("");
  });

  it("feeds only snapshots in the current display currency", () => {
    // The EUR snapshot in the middle is dropped; USD 1000 -> 1500 with F 300 remains.
    card([row(1, 1000, null), row(2, 99999, 5, "EUR"), row(3, 1500, 300)], "USD");
    expect(screen.getByTestId("period-returns-simple").textContent).toContain("20.00%");
  });
});
