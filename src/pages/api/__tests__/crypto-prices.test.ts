/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../crypto-prices/index";

const dbRef = { current: null as unknown };

vi.mock("@/lib/db", () => ({
  createDbClient: vi.fn(() => dbRef.current),
}));

vi.mock("@/lib/crypto-prices", () => ({
  getCachedCryptoPrices: vi.fn(),
  fetchCryptoPrices: vi.fn().mockResolvedValue([]),
  isPriceStale: vi.fn(),
}));

function makeContext() {
  return {
    request: new Request("http://localhost", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }),
    cookies: { get: (_n: string) => ({}), set: vi.fn(), delete: vi.fn(), getAll: () => [] } as unknown,
    params: {},
  };
}

function makeChain(data: unknown, error: unknown) {
  return new Proxy((() => ({ data, error })) as any, {
    get(_t, prop) {
      if (prop === "data") return data;
      if (prop === "error") return error;
      if (prop === "then" || prop === Symbol.toStringTag) return undefined;
      return makeChain(data, error);
    },
  });
}

function buildMockClient(overrides: {
  user: { id: string } | null;
  pricesData?: unknown[];
  pricesError?: { message: string };
}) {
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: overrides.user } }) };

  const from = (table: string) => {
    if (table === "crypto_prices") {
      return { select: () => makeChain(overrides.pricesData ?? [], overrides.pricesError ?? null) };
    }
    return { select: () => makeChain(null, null) };
  };

  return { auth, from };
}

describe("GET /api/crypto-prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = null;
  });

  it("returns 401 when unauthenticated", async () => {
    dbRef.current = buildMockClient({ user: null });
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with prices array when authenticated", async () => {
    const prices = [
      { symbol: "BTC", price_usd: 45000, fetched_at: new Date().toISOString() },
      { symbol: "ETH", price_usd: 2500, fetched_at: new Date().toISOString() },
    ];
    dbRef.current = buildMockClient({ user: { id: "user-1" }, pricesData: prices });
    const { isPriceStale } = await import("@/lib/crypto-prices");
    vi.mocked(isPriceStale).mockReturnValue(false);
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].symbol).toBe("BTC");
    expect(body.data[0].price_usd).toBe(45000);
  });

  it("returns 200 with empty array when no cached data", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, pricesData: [] });
    const { isPriceStale } = await import("@/lib/crypto-prices");
    vi.mocked(isPriceStale).mockReturnValue(false);
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns 500 with FETCH_ERROR when DB fails", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, pricesError: { message: "DB connection error" } });
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("FETCH_ERROR");
    expect(body.error.context).toBeDefined();
  });

  it("returns 500 with SERVER_ERROR when db client is null", async () => {
    dbRef.current = null;
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("SERVER_ERROR");
  });
});
