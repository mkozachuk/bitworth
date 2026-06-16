import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseMock, findCall } from "@/test-utils/supabase-mock";
import { getPrice } from "@/lib/crypto-prices";

// The mock factory exposes only the methods the SUT touches (from/rpc/auth).
// Cast at the call site so tsc accepts the structural mock as a real client.
const asClient = (c: ReturnType<typeof createSupabaseMock>["client"]): SupabaseClient => c as unknown as SupabaseClient;

// Pins the `getPrice` orchestrator's failure paths and the cache write
// invariant for Risk #4 (crypto path) and Risk #6 (cache not poisoned).
// `getPrice` imports `SupabaseClient` as a type, so we pass the mock
// factory's `client` directly. Network responses are stubbed via
// `vi.stubGlobal("fetch", ...)` — same precedent as the rates test file.

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
        crypto_price_cache: { data: { price_usd: 50000, fetched_at: NOW_ISO }, error: null },
      },
    });

    const result = await getPrice(asClient(m.client), "BTC");

    expect(result).toEqual({
      price: 50000,
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
        crypto_price_cache: { data: { price_usd: 50000, fetched_at: STALE_ISO }, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ bitcoin: { usd: 50000 } }), { status: 200 }),
    );

    const result = await getPrice(asClient(m.client), "BTC");

    expect(result).toMatchObject({ price: 50000, isCached: false });
    expect(fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("fetches and writes cache on 200 success", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        crypto_price_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ bitcoin: { usd: 50000 } }), { status: 200 }),
    );

    const result = await getPrice(asClient(m.client), "BTC");

    expect(result).toMatchObject({ price: 50000, isCached: false });
    expect(
      findCall(m.recorded, "rpc", [
        "upsert_crypto_price_cache",
        { p_coin_id: "bitcoin", p_coin_symbol: "BTC", p_price_usd: 50000 },
      ]),
    ).toBeDefined();
  });

  it("does not write cache when fetch returns 503", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        crypto_price_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("upstream down", { status: 503 }));

    const result = await getPrice(asClient(m.client), "BTC");

    expect(result).toEqual({
      error: { code: "PRICE_UNAVAILABLE", message: 'Could not fetch price for "BTC"' },
    });
    expect(m.recorded.filter((c) => c.method === "rpc").length).toBe(0);
  });

  it("does not write cache when fetch returns 200 with malformed body", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        crypto_price_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(getPrice(asClient(m.client), "BTC")).rejects.toThrow();
    expect(m.recorded.filter((c) => c.method === "rpc").length).toBe(0);
  });

  // Regression: prod showed "Price unavailable" for BTC/ETH because the price was
  // fetched from Binance, which geo-blocks Cloudflare Workers egress (HTTP 451).
  // Prices must come from CoinGecko's simple/price, keyed by the resolved coin id.
  it.each([
    { symbol: "BTC", coinId: "bitcoin", price: 66000 },
    { symbol: "ETH", coinId: "ethereum", price: 3200 },
  ])("returns a live CoinGecko price for $symbol", async ({ symbol, coinId, price }) => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        crypto_price_cache: { data: null, error: null },
      },
    });
    const mockFetch = fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ [coinId]: { usd: price } }), { status: 200 }));

    const result = await getPrice(asClient(m.client), symbol);

    expect(result).toMatchObject({ price, isCached: false });
    // Price must come from CoinGecko (keyed by coin id), never the geo-blocked Binance.
    const requestedUrl = String(mockFetch.mock.calls[0][0]);
    expect(requestedUrl).toContain("api.coingecko.com");
    expect(requestedUrl).toContain(`ids=${coinId}`);
    expect(requestedUrl).not.toContain("binance");
    // Cache is keyed by the resolved coin id + ticker symbol.
    expect(
      findCall(m.recorded, "rpc", [
        "upsert_crypto_price_cache",
        { p_coin_id: coinId, p_coin_symbol: symbol, p_price_usd: price },
      ]),
    ).toBeDefined();
  });
});
