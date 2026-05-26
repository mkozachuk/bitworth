import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const _makeAssetsResponse = (assets: unknown[]) => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ data: assets }),
  });
};

const emptySnapshots = [];
const emptyRates: { currency_pair: string; rate: number; fetched_at: string }[] = [];

describe("DashboardClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("renders with empty state", () => {
    render(
      <DashboardClient
        profile={{ display_currency: "PLN" }}
        assets={[]}
        snapshots={emptySnapshots}
        rates={emptyRates}
      />,
    );
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Your Assets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add asset/i })).toBeInTheDocument();
  });

  it("renders with assets", () => {
    const assets = [
      {
        id: "1",
        name: "Savings Account",
        amount: 5000,
        currency: "PLN",
        category: "Checking Account",
        is_liability: false,
        user_id: "user-1",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ];
    render(
      <DashboardClient
        profile={{ display_currency: "PLN" }}
        assets={assets}
        snapshots={emptySnapshots}
        rates={emptyRates}
      />,
    );
    expect(screen.getByText("Savings Account")).toBeInTheDocument();
  });

  it("shows empty state message when no assets", () => {
    render(
      <DashboardClient
        profile={{ display_currency: "PLN" }}
        assets={[]}
        snapshots={emptySnapshots}
        rates={emptyRates}
      />,
    );
    expect(screen.getByText(/no assets yet/i)).toBeInTheDocument();
  });

  it("opens Add Asset modal when button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <DashboardClient
        profile={{ display_currency: "PLN" }}
        assets={[]}
        snapshots={emptySnapshots}
        rates={emptyRates}
      />,
    );
    // Click the header "Add Asset" button by finding button with svg child
    const addButtons = screen.getAllByRole("button", { name: /add asset/i });
    const headerButton = addButtons.find((b) => b.querySelector("svg"));
    if (!headerButton) throw new Error("Header button not found");
    await user.click(headerButton);
    expect(document.body.querySelector('[role="dialog"] h2')?.textContent).toBe("Add Asset");
  });

  it("shows chart placeholder when fewer than 2 snapshots", () => {
    const snapshots = [
      {
        id: "snap-1",
        user_id: "user-1",
        total_net_worth: 5000,
        currency: "PLN",
        snapshot_date: "2024-01-01",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];
    render(
      <DashboardClient profile={{ display_currency: "PLN" }} assets={[]} snapshots={snapshots} rates={emptyRates} />,
    );
    expect(screen.getByText(/save at least 2 snapshots/i)).toBeInTheDocument();
  });
});
