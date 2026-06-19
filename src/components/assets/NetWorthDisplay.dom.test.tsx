// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NetWorthDisplay } from "./NetWorthDisplay";
import type { Tables } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };

const RATES: Record<Currency, number> = { USD: 1.0, EUR: 0.85, PLN: 4.0 };

function makeAsset(overrides: Partial<AssetWithCategory> & { amount: number; currency: string }): AssetWithCategory {
  return {
    id: crypto.randomUUID(),
    user_id: "u1",
    name: "Test",
    category_id: "c1",
    crypto_symbol: null,
    notes: null,
    quantity: null,
    show_on_chart: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    category: {
      id: "c1",
      name: "Cash",
      is_liability: false,
      display_order: 1,
      icon: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ rates: RATES }), { status: 200 }))),
  );
  sessionStorage.clear();
});

afterEach(cleanup);

describe("NetWorthDisplay DOM", () => {
  it("renders the correct total for mixed-currency assets with a liability", () => {
    const assets: AssetWithCategory[] = [
      makeAsset({ amount: 1000, currency: "USD" }),
      makeAsset({ amount: 500, currency: "EUR" }),
      makeAsset({
        amount: 200,
        currency: "PLN",
        category_id: "c2",
        category: {
          id: "c2",
          name: "Debt",
          is_liability: true,
          display_order: 2,
          icon: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
    ];

    // Hand-computed expected value:
    // 1000 USD → USD = 1000
    // 500 EUR → USD = 500 / 0.85 * 1.0 = 588.2352941...
    // totalAssets = 1588.2352941...
    // 200 PLN → USD = 200 / 4.0 * 1.0 = 50
    // netWorth = 1588.2352941... - 50 = 1538.2352941...
    // Formatted: "1,538.24"
    render(<NetWorthDisplay assets={assets} displayCurrency="USD" rates={RATES} snapshots={[]} />);

    expect(screen.getByText(/1,538\.24/)).toBeDefined();
  });

  it("renders zero total for empty assets array", () => {
    render(<NetWorthDisplay assets={[]} displayCurrency="USD" rates={RATES} snapshots={[]} />);

    expect(screen.getByText(/^0\.00/)).toBeDefined();
  });
});
