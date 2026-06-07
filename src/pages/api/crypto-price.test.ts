import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub } from "@/test-utils/supabase-mock";

// /api/crypto-price reads the global `crypto_price_cache` table — same
// shape as /api/categories. Auth check is the only per-user gate. The
// `getPrice` helper from @/lib/crypto-prices is mocked below so the test
// does not exercise the real (network) code path.

const mocks = vi.hoisted(() => {
  return {
    factory: () => null as unknown as ReturnType<typeof createSupabaseMock>,
    getPrice: vi.fn(),
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

vi.mock("@/lib/crypto-prices", () => ({
  getPrice: mocks.getPrice,
}));

import { GET } from "@/pages/api/crypto-price";

describe("GET /api/crypto-price", () => {
  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;
    mocks.getPrice.mockReset();

    const request = new Request("http://localhost/api/crypto-price?symbol=BTC");
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });

  it("returns the cached price on authenticated request", async () => {
    const m = createSupabaseMock({ userId: "user-A" });
    mocks.factory = () => m;
    mocks.getPrice.mockReset();
    mocks.getPrice.mockResolvedValue({
      price: 50000,
      isCached: false,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    const request = new Request("http://localhost/api/crypto-price?symbol=BTC", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    expect(mocks.getPrice).toHaveBeenCalled();
  });

  it("returns 400 when symbol query parameter is missing", async () => {
    const m = createSupabaseMock({ userId: "user-A" });
    mocks.factory = () => m;
    mocks.getPrice.mockReset();

    const request = new Request("http://localhost/api/crypto-price", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
  });

  it("returns 404 PRICE_UNAVAILABLE when fetch returns 5xx", async () => {
    const m = createSupabaseMock({ userId: "user-A" });
    mocks.factory = () => m;
    mocks.getPrice.mockReset();
    mocks.getPrice.mockResolvedValue({
      error: { code: "PRICE_UNAVAILABLE", message: 'Could not fetch price for "BTC"' },
    });

    const request = new Request("http://localhost/api/crypto-price?symbol=BTC", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PRICE_UNAVAILABLE");
    expect(m.recorded.filter((c) => c.method === "rpc").length).toBe(0);
  });

  it("returns 404 PRICE_UNAVAILABLE when fetch returns 4xx", async () => {
    const m = createSupabaseMock({ userId: "user-A" });
    mocks.factory = () => m;
    mocks.getPrice.mockReset();
    mocks.getPrice.mockResolvedValue({
      error: { code: "PRICE_UNAVAILABLE", message: 'Could not fetch price for "BTC"' },
    });

    const request = new Request("http://localhost/api/crypto-price?symbol=BTC", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PRICE_UNAVAILABLE");
    expect(m.recorded.filter((c) => c.method === "rpc").length).toBe(0);
  });
});
