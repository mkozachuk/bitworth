import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseMock } from "@/test-utils/supabase-mock";
import { getRates } from "@/lib/exchange-rates";

// The mock factory exposes only the methods the SUT touches (from/rpc/auth).
// Cast at the call site so tsc accepts the structural mock as a real client.
const asClient = (c: ReturnType<typeof createSupabaseMock>["client"]): SupabaseClient => c as unknown as SupabaseClient;

// Pins the defensive `try/catch` fallback in `getRates` (Risk #4's rates
// path) and the cache fast-path optimization. `getRates` imports
// `SupabaseClient` as a type, so we pass the mock factory's `client`
// directly. Network responses are stubbed via `vi.stubGlobal("fetch", ...)`
// — the precedent for the project's network shim, established by this file.

const NOW_ISO = new Date().toISOString();

describe("getRates", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns STATIC_RATES when fetch throws", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        exchange_rate_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const result = await getRates(asClient(m.client));

    expect(result).toEqual({ USD: 1.0, EUR: 0.92, PLN: 3.85 });
  });

  it("returns STATIC_RATES when fetch returns 503", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        exchange_rate_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("service unavailable", { status: 503 }));

    const result = await getRates(asClient(m.client));

    expect(result).toEqual({ USD: 1.0, EUR: 0.92, PLN: 3.85 });
  });

  it("returns STATIC_RATES when fetch returns 200 with malformed body", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        exchange_rate_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("not json", { status: 200 }));

    const result = await getRates(asClient(m.client));

    expect(result).toEqual({ USD: 1.0, EUR: 0.92, PLN: 3.85 });
  });

  it("skips fetch when both EUR→USD and EUR→PLN are cached and fresh", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        exchange_rate_cache: { data: { rate: 0.92, fetched_at: NOW_ISO }, error: null },
      },
    });

    const result = await getRates(asClient(m.client));

    expect(fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    // USD is the base short-circuit (1.0); EUR = 1/0.92; PLN = 0.92/EUR-rate; both rates are 0.92 here.
    expect(result.USD).toBe(1.0);
    expect(result.EUR).toBeCloseTo(1 / 0.92, 6);
    expect(result.PLN).toBeCloseTo(1, 6);
  });
});
