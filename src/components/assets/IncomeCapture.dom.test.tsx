// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NetWorthDisplay } from "./NetWorthDisplay";
import { EditContributionDialog } from "./EditContributionDialog";
import type { Currency } from "@/lib/net-worth";

// B2 (R2): income is captured in the save flow, next to the contribution, and
// in the edit dialog. Fixtures are synthetic.

const RATES: Record<Currency, number> = { USD: 1.0, EUR: 0.85, PLN: 4.0 };

type FetchCall = [string, RequestInit | undefined];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Rates load on mount; any write answers 400 so the success path's
  // page reload never runs inside the test. The request is what is asserted.
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url.startsWith("/api/snapshots")
        ? new Response(JSON.stringify({ error: { message: "stopped by test" } }), { status: 400 })
        : new Response(JSON.stringify({ rates: RATES }), { status: 200 }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function writes(): FetchCall[] {
  return (fetchMock.mock.calls as FetchCall[]).filter(([url]) => url.startsWith("/api/snapshots"));
}

function openSave() {
  render(<NetWorthDisplay assets={[]} displayCurrency="PLN" rates={RATES} snapshots={[]} />);
  fireEvent.click(screen.getByRole("button", { name: /Save snapshot/ }));
}

describe("save flow: income next to the contribution", () => {
  it("shows an Income field in the save dialog, in the display currency", () => {
    openSave();
    const input = screen.getByLabelText<HTMLInputElement>("Income");
    expect(input.id).toBe("save-income");
    expect(input.min).toBe("0");
    expect(screen.getByLabelText("Net contribution")).toBeDefined();
    expect(screen.getByText(/Amount in PLN earned since your previous snapshot/)).toBeDefined();
  });

  it("sends both keys when both are filled", async () => {
    openSave();
    fireEvent.change(screen.getByLabelText("Net contribution"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Income"), { target: { value: "4000.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    const [url, init] = writes()[0];
    expect(url).toBe("/api/snapshots");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ net_contribution: 250, income: 4000.5 });
  });

  it("sends income alone when the contribution is blank", async () => {
    openSave();
    fireEvent.change(screen.getByLabelText("Income"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({ income: 3000 });
  });

  it("sends no body when both are blank (unchanged legacy save)", async () => {
    openSave();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(writes()[0][1]?.body).toBeUndefined();
  });

  it("refuses a negative income client-side and sends nothing", async () => {
    openSave();
    fireEvent.change(screen.getByLabelText("Income"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    // NetWorthDisplay prefixes save errors with "Snapshot failed: " (unchanged).
    expect(await screen.findByText("Snapshot failed: Income must be a number of 0 or more")).toBeDefined();
    expect(writes()).toHaveLength(0);
  });
});

describe("EditContributionDialog: edits both fields", () => {
  function openEdit(netContribution: number | null, income: number | null) {
    render(
      <EditContributionDialog
        open
        id="snap-9"
        netContribution={netContribution}
        income={income}
        displayCurrency="EUR"
        dateLabel="March 1, 2026"
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
  }

  it("pre-fills both fields from the snapshot", () => {
    openEdit(200, 3000);
    expect(screen.getByLabelText<HTMLInputElement>("Net contribution").value).toBe("200");
    expect(screen.getByLabelText<HTMLInputElement>("Income").value).toBe("3000");
    expect(screen.getByText("Edit contribution and income")).toBeDefined();
  });

  it("PATCHes both keys; a cleared income is sent as null", async () => {
    openEdit(200, 3000);
    fireEvent.change(screen.getByLabelText("Income"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    const [url, init] = writes()[0];
    expect(url).toBe("/api/snapshots/snap-9");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ net_contribution: 200, income: null });
  });

  it("adds income to a snapshot that had none", async () => {
    openEdit(null, null);
    fireEvent.change(screen.getByLabelText("Income"), { target: { value: "5200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({ net_contribution: null, income: 5200 });
  });

  it("refuses a negative income and sends nothing", () => {
    openEdit(100, null);
    fireEvent.change(screen.getByLabelText("Income"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Income must be a number of 0 or more")).toBeDefined();
    expect(writes()).toHaveLength(0);
  });
});
