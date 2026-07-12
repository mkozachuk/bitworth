import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseMock, findCall } from "@/test-utils/supabase-mock";
import { getPrice } from "@/lib/metal-prices";

// The mock factory exposes only the methods the SUT touches (from/rpc/auth).
// Cast at the call site so tsc accepts the structural mock as a real client.
const asClient = (c: ReturnType<typeof createSupabaseMock>["client"]): SupabaseClient => c as unknown as SupabaseClient;

// Pins the `getPrice` orchestrator's failure paths and the cache write
// invariant for the metals path, mirroring the crypto recipe. GoldAPI.io
// network responses are stubbed via `vi.stubGlobal("fetch", ...)`.

const NOW_ISO = new Date().toISOString();
const STALE_ISO = new Date(Date.now() - 7200 * 1000).toISOString();

describe("getPrice", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns cached price when fresh cache row exists", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        metal_price_cache: { data: { price_usd: 2400, fetched_at: NOW_ISO }, error: null },
      },
    });

    const result = await getPrice(asClient(m.client), "XAU");

    expect(result).toEqual({
      price: 2400,
      isCached: true,
      fetchedAt: NOW_ISO,
      cachedAge: "0s ago",
    });
    expect(fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("silently evicts stale cache row and fetches", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        metal_price_cache: { data: { price_usd: 2400, fetched_at: STALE_ISO }, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ price: 2400 }), { status: 200 }),
    );

    const result = await getPrice(asClient(m.client), "XAU");

    expect(result).toMatchObject({ price: 2400, isCached: false });
    expect(fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("fetches and writes cache on 200 success", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        metal_price_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ price: 2400 }), { status: 200 }),
    );

    const result = await getPrice(asClient(m.client), "XAU");

    expect(result).toMatchObject({ price: 2400, isCached: false });
    expect(
      findCall(m.recorded, "rpc", [
        "upsert_metal_price_cache",
        { p_metal_id: "gold", p_metal_symbol: "XAU", p_price_usd: 2400 },
      ]),
    ).toBeDefined();
  });

  it("does not write cache when fetch returns 503", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        metal_price_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("upstream down", { status: 503 }));

    const result = await getPrice(asClient(m.client), "XAU");

    expect(result).toEqual({
      error: {
        code: "PRICE_UNAVAILABLE",
        message: 'Could not fetch price for "XAU"',
        context: { metalId: "gold", upstreamStatus: 503 },
      },
    });
    expect(m.recorded.filter((c) => c.method === "rpc").length).toBe(0);
  });

  it("does not write cache when fetch returns 200 with malformed body", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        metal_price_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(getPrice(asClient(m.client), "XAU")).rejects.toThrow();
    expect(m.recorded.filter((c) => c.method === "rpc").length).toBe(0);
  });

  // Regression: prices must come from GoldAPI.io, never a geo-blocked/throttled
  // provider. Pins the provider host and the cache key (metal id + ticker symbol).
  it.each([
    { symbol: "XAU", metalId: "gold", price: 2400 },
    { symbol: "XAG", metalId: "silver", price: 30 },
  ])("returns a live GoldAPI price for $symbol", async ({ symbol, metalId, price }) => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        metal_price_cache: { data: null, error: null },
      },
    });
    const mockFetch = fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ price }), { status: 200 }));

    const result = await getPrice(asClient(m.client), symbol);

    expect(result).toMatchObject({ price, isCached: false });
    // Price must come from GoldAPI.io, never the geo-blocked/throttled crypto providers.
    const requestedUrl = String(mockFetch.mock.calls[0][0]);
    expect(requestedUrl).toContain("goldapi.io");
    expect(requestedUrl).toContain(`/${symbol}/USD`);
    expect(requestedUrl).not.toContain("binance");
    expect(requestedUrl).not.toContain("coingecko");
    // Cache is keyed by the resolved metal id + ticker symbol.
    expect(
      findCall(m.recorded, "rpc", [
        "upsert_metal_price_cache",
        { p_metal_id: metalId, p_metal_symbol: symbol, p_price_usd: price },
      ]),
    ).toBeDefined();
  });
});
