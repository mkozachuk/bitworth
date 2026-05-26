import { describe, it, expect } from "vitest";
import { computeNetWorth } from "@/lib/net-worth";

interface AssetRow {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  currency: string;
  category: string;
  is_liability: boolean;
  created_at: string;
  updated_at: string;
}

interface ExchangeRate {
  currency_pair: string;
  rate: number;
}

function makeAsset(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: "asset-1",
    user_id: "user-1",
    name: "Savings",
    amount: 1000,
    currency: "PLN",
    category: "savings",
    is_liability: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRate(pair: string, rate: number): ExchangeRate {
  return { currency_pair: pair, rate };
}

describe("computeNetWorth", () => {
  it("returns zero when asset array is empty", () => {
    const result = computeNetWorth([], [], "PLN");
    expect(result.total).toBe(0);
    expect(result.byCategory).toEqual({});
    expect(result.currency).toBe("PLN");
  });

  it("handles asset with amount of zero", () => {
    const result = computeNetWorth([makeAsset({ amount: 0 })], [], "PLN");
    expect(result.total).toBe(0);
    expect(result.byCategory.savings).toBe(0);
  });

  it("handles null-like values gracefully via amount and currency defaults", () => {
    const result = computeNetWorth(
      [
        makeAsset({ amount: 500, currency: "PLN", is_liability: false }),
        makeAsset({ amount: 200, currency: "PLN", is_liability: true }),
      ],
      [],
      "PLN",
    );
    expect(result.total).toBe(300);
  });

  it("sums assets by category when no conversion is needed (same currency)", () => {
    const assets = [
      makeAsset({ id: "a1", amount: 1000, currency: "USD", category: "cash" }),
      makeAsset({ id: "a2", amount: 500, currency: "USD", category: "cash" }),
      makeAsset({ id: "a3", amount: 300, currency: "USD", category: "investments" }),
    ];
    const rates = [makeRate("USD/PLN", 1), makeRate("PLN/USD", 1)];

    const result = computeNetWorth(assets, rates, "USD");

    expect(result.total).toBe(1800);
    expect(result.byCategory.cash).toBe(1500);
    expect(result.byCategory.investments).toBe(300);
    expect(result.currency).toBe("USD");
  });

  it("converts PLN assets to USD display currency", () => {
    // PLN/USD rate = 4.0 means 1 PLN = 4 USD
    const assets = [makeAsset({ amount: 400, currency: "PLN", category: "cash" })];
    const rates = [makeRate("PLN/USD", 4.0), makeRate("USD/PLN", 0.25)];

    const result = computeNetWorth(assets, rates, "USD");

    // 400 PLN * 4.0 = 1600 USD
    expect(result.total).toBe(1600);
    expect(result.byCategory.cash).toBe(1600);
  });

  it("converts USD assets to PLN display currency", () => {
    // USD/PLN rate = 4.0 means 1 USD = 4 PLN
    const assets = [makeAsset({ amount: 100, currency: "USD", category: "cash" })];
    const rates = [makeRate("USD/PLN", 4.0), makeRate("PLN/USD", 0.25)];

    const result = computeNetWorth(assets, rates, "PLN");

    // 100 USD * 4.0 = 400 PLN
    expect(result.total).toBe(400);
    expect(result.byCategory.cash).toBe(400);
  });

  it("handles mixed assets and liabilities", () => {
    const assets = [
      makeAsset({ id: "a1", amount: 5000, currency: "PLN", category: "cash", is_liability: false }),
      makeAsset({ id: "a2", amount: 1000, currency: "PLN", category: "investments", is_liability: false }),
      makeAsset({ id: "a3", amount: 2000, currency: "PLN", category: "debt", is_liability: true }),
      makeAsset({ id: "a4", amount: 500, currency: "PLN", category: "debt", is_liability: true }),
    ];
    const rates: ExchangeRate[] = [];

    const result = computeNetWorth(assets, rates, "PLN");

    expect(result.total).toBe(5000 + 1000 - 2000 - 500); // 3500
    expect(result.byCategory.cash).toBe(5000);
    expect(result.byCategory.investments).toBe(1000);
    expect(result.byCategory.debt).toBe(-2500);
  });

  it("converts mixed currencies to PLN with cross-conversion", () => {
    const assets = [
      makeAsset({ id: "a1", amount: 400, currency: "PLN", category: "pln_asset" }),
      makeAsset({ id: "a2", amount: 100, currency: "USD", category: "usd_asset" }),
    ];
    // USD/PLN = 4.0 (1 USD = 4 PLN)
    const rates = [makeRate("USD/PLN", 4.0), makeRate("PLN/USD", 0.25)];

    const result = computeNetWorth(assets, rates, "PLN");

    // 400 PLN + 100 USD * 4 = 400 + 400 = 800 PLN
    expect(result.total).toBe(800);
    expect(result.byCategory.usd_asset).toBe(400);
  });

  it("produces negative total when liabilities exceed assets", () => {
    const assets = [
      makeAsset({ id: "a1", amount: 100, currency: "PLN", category: "cash", is_liability: false }),
      makeAsset({ id: "a2", amount: 500, currency: "PLN", category: "debt", is_liability: true }),
    ];
    const rates: ExchangeRate[] = [];

    const result = computeNetWorth(assets, rates, "PLN");

    expect(result.total).toBe(-400);
    expect(result.byCategory.debt).toBe(-500);
  });

  it("uses fallback rate of 1 when no conversion rate available", () => {
    const assets = [makeAsset({ amount: 100, currency: "EUR", category: "cash" })];
    const rates: ExchangeRate[] = [];

    const result = computeNetWorth(assets, rates, "PLN");

    expect(result.total).toBe(100);
  });

  it("cross-converts via PLN when direct pair is missing", () => {
    // We have USD/PLN and PLN/EUR but not USD/EUR
    // USD → PLN: USD/PLN = 0.25 means 1 USD = 0.25 PLN → 100 USD = 25 PLN
    // PLN → EUR: PLN/EUR = 4.0 means 1 PLN = 4 EUR → 25 PLN = 100 EUR
    const assets = [makeAsset({ amount: 100, currency: "USD", category: "cash" })];
    const rates = [makeRate("USD/PLN", 0.25), makeRate("PLN/EUR", 4.0)];

    const result = computeNetWorth(assets, rates, "EUR");

    // 100 USD * 0.25 = 25 PLN; 25 PLN * 4.0 = 100 EUR
    expect(result.total).toBe(100);
  });

  it("handles single asset with null category", () => {
    const assets = [makeAsset({ category: "", amount: 500, currency: "PLN" })];
    const rates: ExchangeRate[] = [];

    const result = computeNetWorth(assets, rates, "PLN");

    expect(result.total).toBe(500);
    expect(result.byCategory[""]).toBe(500);
  });

  it("returns correct currency in result", () => {
    const result = computeNetWorth([], [], "EUR");
    expect(result.currency).toBe("EUR");

    const result2 = computeNetWorth([], [], "USD");
    expect(result2.currency).toBe("USD");

    const result3 = computeNetWorth([], [], "PLN");
    expect(result3.currency).toBe("PLN");
  });
});
