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

  it("returns fetched rates and warns when every cache upsert fails", async () => {
    const upsertError = { data: null, error: { message: "permission denied for table exchange_rate_cache" } };
    const m = createSupabaseMock({
      userId: null,
      tableResultQueues: {
        // Two cache-read misses, then seven failing upserts.
        exchange_rate_cache: [
          { data: null, error: null },
          { data: null, error: null },
          ...Array.from({ length: 7 }, () => upsertError),
        ],
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ rates: { USD: 1.1, PLN: 4.4 } }), { status: 200 }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await getRates(asClient(m.client));

      expect(result).not.toEqual({ USD: 1.0, EUR: 0.92, PLN: 3.85 });
      expect(result.USD).toBe(1.0);
      expect(result.EUR).toBeCloseTo(1 / 1.1, 6);
      expect(result.PLN).toBeCloseTo(4.4 / 1.1, 6);
      expect(warn).toHaveBeenCalled();
      expect(
        warn.mock.calls.some((args) => String(args[0]).includes("permission denied for table exchange_rate_cache")),
      ).toBe(true);
      expect(warn.mock.calls.some((args) => String(args[0]).includes("EUR->USD"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("fetches rates from the frankfurter.dev v1 endpoint", async () => {
    const m = createSupabaseMock({
      userId: null,
      tableResults: {
        exchange_rate_cache: { data: null, error: null },
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ rates: { USD: 1.1, PLN: 4.4 } }), { status: 200 }),
    );

    await getRates(asClient(m.client));

    expect(fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("https://api.frankfurter.dev/v1/latest?from=EUR");
  });
});
