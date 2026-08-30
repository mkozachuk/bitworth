import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, findCall } from "@/test-utils/supabase-mock";

// Both price modules import `astro:env/server` and hit external APIs; the
// reprice helper's contract is "given a price (or an error), what happens to
// the row", so they are mocked at the module boundary (same exception the
// snapshot route test makes for exchange-rates).
const priceMocks = vi.hoisted(() => ({
  crypto: vi.fn(),
  metal: vi.fn(),
}));

vi.mock("@/lib/crypto-prices", () => ({ getPrice: priceMocks.crypto }));
vi.mock("@/lib/metal-prices", () => ({ getPrice: priceMocks.metal }));

import { repriceAssets } from "@/lib/reprice";

const base = {
  currency: "USD",
  quantity: null as number | null,
  crypto_symbol: null as string | null,
  metal_symbol: null as string | null,
};

const cash = { ...base, id: "cash", name: "Checking", amount: 500 };
const btc = { ...base, id: "btc", name: "Bitcoin", amount: 59941, quantity: 1, crypto_symbol: "BTC" };
const gold = { ...base, id: "gold", name: "Gold", amount: 4053, quantity: 1, metal_symbol: "XAU" };

function ok(price: number) {
  return Promise.resolve({ price, isCached: false, fetchedAt: "2026-08-30T00:00:00.000Z" });
}

function client() {
  return createSupabaseMock({ userId: "user-A", tableResults: { assets: { data: null, error: null } } });
}

beforeEach(() => {
  priceMocks.crypto.mockReset();
  priceMocks.metal.mockReset();
});

describe("repriceAssets", () => {
  it("reprices a crypto holding to quantity × price (cents) and persists it", async () => {
    priceMocks.crypto.mockImplementation(() => ok(78636.123));
    const m = client();

    const result = await repriceAssets(m.client as never, [{ ...btc, quantity: 0.5 }]);

    expect(result.assets[0].amount).toBe(39318.06);
    expect(result.assets[0].currency).toBe("USD");
    expect(result.repriced).toEqual([
      { id: "btc", name: "Bitcoin", symbol: "BTC", oldAmount: 59941, newAmount: 39318.06, priceUsd: 78636.123 },
    ]);
    expect(result.failed).toEqual([]);
    expect(findCall(m.recorded, "update", [{ amount: 39318.06, currency: "USD" }])).toBeDefined();
    expect(findCall(m.recorded, "eq", ["id", "btc"])).toBeDefined();
  });

  it("reprices a metal holding through the metal price source", async () => {
    priceMocks.metal.mockImplementation(() => ok(4456));
    const m = client();

    const result = await repriceAssets(m.client as never, [{ ...gold, quantity: 2 }]);

    expect(priceMocks.metal).toHaveBeenCalledWith(expect.anything(), "XAU");
    expect(priceMocks.crypto).not.toHaveBeenCalled();
    expect(result.assets[0].amount).toBe(8912);
    expect(result.repriced).toHaveLength(1);
  });

  it("passes unpriced rows through untouched and never fetches for them", async () => {
    const m = client();

    const result = await repriceAssets(m.client as never, [cash, { ...btc, quantity: null }, { ...btc, quantity: 0 }]);

    expect(result.assets).toEqual([cash, { ...btc, quantity: null }, { ...btc, quantity: 0 }]);
    expect(result.repriced).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(priceMocks.crypto).not.toHaveBeenCalled();
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("keeps the stored amount and reports the failure when the price is unavailable", async () => {
    priceMocks.crypto.mockImplementation(() =>
      Promise.resolve({ error: { code: "PRICE_UNAVAILABLE", message: "Could not fetch price" } }),
    );
    const m = client();

    const result = await repriceAssets(m.client as never, [btc, cash]);

    expect(result.assets).toEqual([btc, cash]);
    expect(result.failed).toEqual([{ id: "btc", name: "Bitcoin", symbol: "BTC", code: "PRICE_UNAVAILABLE" }]);
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("treats a thrown price fetch as PRICE_UNAVAILABLE rather than propagating", async () => {
    priceMocks.crypto.mockImplementation(() => Promise.reject(new Error("network")));
    const m = client();

    const result = await repriceAssets(m.client as never, [btc]);

    expect(result.failed[0].code).toBe("PRICE_UNAVAILABLE");
    expect(result.assets[0].amount).toBe(btc.amount);
  });

  it("skips the write when the price has not moved", async () => {
    priceMocks.crypto.mockImplementation(() => ok(59941));
    const m = client();

    const result = await repriceAssets(m.client as never, [btc]);

    expect(result.repriced).toEqual([]);
    expect(result.assets[0]).toBe(btc);
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("fetches once per symbol across multiple holdings", async () => {
    priceMocks.crypto.mockImplementation(() => ok(80000));
    const m = client();

    const result = await repriceAssets(m.client as never, [
      btc,
      { ...btc, id: "btc-2", name: "Cold wallet", quantity: 2 },
    ]);

    expect(priceMocks.crypto).toHaveBeenCalledTimes(1);
    expect(result.assets.map((a) => a.amount)).toEqual([80000, 160000]);
  });

  it("keeps the stored amount when the assets write fails", async () => {
    priceMocks.crypto.mockImplementation(() => ok(80000));
    const m = createSupabaseMock({
      userId: "user-A",
      tableResults: { assets: { data: null, error: { code: "42501", message: "permission denied" } } },
    });

    const result = await repriceAssets(m.client as never, [btc]);

    expect(result.assets[0].amount).toBe(btc.amount);
    expect(result.repriced).toEqual([]);
    expect(result.failed).toEqual([{ id: "btc", name: "Bitcoin", symbol: "BTC", code: "42501" }]);
  });
});
