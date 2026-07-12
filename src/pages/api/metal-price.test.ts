import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub } from "@/test-utils/supabase-mock";

// /api/metal-price reads the global `metal_price_cache` table — same shape as
// /api/crypto-price. Auth check is the only per-user gate. The `getPrice` helper
// from @/lib/metal-prices is mocked below so the test does not exercise the real
// (network) code path.

const mocks = vi.hoisted(() => {
  return {
    factory: () => null as unknown as ReturnType<typeof createSupabaseMock>,
    getPrice: vi.fn(),
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

vi.mock("@/lib/metal-prices", () => ({
  getPrice: mocks.getPrice,
}));

import { GET } from "@/pages/api/metal-price";

describe("GET /api/metal-price", () => {
  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;
    mocks.getPrice.mockReset();

    const request = new Request("http://localhost/api/metal-price?symbol=XAU");
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });

  it("returns the cached price on authenticated request", async () => {
    const m = createSupabaseMock({ userId: "user-A" });
    mocks.factory = () => m;
    mocks.getPrice.mockReset();
    mocks.getPrice.mockResolvedValue({
      price: 2400,
      isCached: false,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    const request = new Request("http://localhost/api/metal-price?symbol=XAU", {
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

    const request = new Request("http://localhost/api/metal-price", {
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
      error: { code: "PRICE_UNAVAILABLE", message: 'Could not fetch price for "XAU"' },
    });

    const request = new Request("http://localhost/api/metal-price?symbol=XAU", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PRICE_UNAVAILABLE");
    expect(m.recorded.filter((c) => c.method === "rpc").length).toBe(0);
  });

  it("returns 404 METAL_NOT_FOUND for an unsupported symbol", async () => {
    const m = createSupabaseMock({ userId: "user-A" });
    mocks.factory = () => m;
    mocks.getPrice.mockReset();
    mocks.getPrice.mockResolvedValue({
      error: { code: "METAL_NOT_FOUND", message: 'No metal found for symbol "XPT"' },
    });

    const request = new Request("http://localhost/api/metal-price?symbol=XPT", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("METAL_NOT_FOUND");
    expect(m.recorded.filter((c) => c.method === "rpc").length).toBe(0);
  });
});
