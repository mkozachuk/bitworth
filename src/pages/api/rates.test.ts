import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/pages/api/rates";

// B2: /api/rates returns { rates, approximate } with a short public cache,
// and needs no Supabase client.

const RECON_BODY = [
  { date: "2026-11-26", base: "EUR", quote: "PLN", rate: 4.4838 },
  { date: "2026-11-26", base: "EUR", quote: "USD", rate: 1.0975 },
];

type Ctx = Parameters<typeof GET>[0];

describe("GET /api/rates", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns live rates with approximate false and Cache-Control public, max-age=300", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(RECON_BODY), { status: 200 }));

    const res = await GET({} as Ctx);
    const json = (await res.json()) as { rates: Record<string, number>; approximate: boolean };

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(json.approximate).toBe(false);
    expect(json.rates.EUR).toBeCloseTo(1 / 1.0975, 6);
  });

  it("returns the fallback with approximate true when Frankfurter is down", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const res = await GET({} as Ctx);
    const json = (await res.json()) as { rates: Record<string, number>; approximate: boolean };

    expect(json).toEqual({ rates: { USD: 1.0, EUR: 0.92, PLN: 3.85 }, approximate: true });
  });
});
