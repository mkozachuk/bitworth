/* eslint-disable @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../exchange-rates/index";

const dbRef = { current: null as unknown };

vi.mock("@/lib/db", () => ({
  createDbClient: vi.fn(() => dbRef.current),
}));

vi.mock("@/lib/exchange-rates", () => ({
  getCachedRates: vi.fn(),
  fetchExchangeRates: vi.fn().mockResolvedValue([]),
  isRateStale: vi.fn(),
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
  ratesData?: unknown[];
  ratesError?: { message: string };
}) {
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: overrides.user } }) };

  const from = (table: string) => {
    if (table === "exchange_rates") {
      return { select: () => makeChain(overrides.ratesData ?? [], overrides.ratesError ?? null) };
    }
    return { select: () => makeChain(null, null) };
  };

  return { auth, from };
}

describe("GET /api/exchange-rates", () => {
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

  it("returns 200 with rates array when authenticated", async () => {
    const rates = [
      { currency_pair: "PLN/USD", rate: 0.25, fetched_at: new Date().toISOString() },
      { currency_pair: "PLN/EUR", rate: 0.23, fetched_at: new Date().toISOString() },
      { currency_pair: "USD/EUR", rate: 0.92, fetched_at: new Date().toISOString() },
    ];
    dbRef.current = buildMockClient({ user: { id: "user-1" }, ratesData: rates });
    const { isRateStale } = await import("@/lib/exchange-rates");
    vi.mocked(isRateStale).mockReturnValue(false);
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.data[0].currency_pair).toBe("PLN/USD");
  });

  it("returns 200 with empty array when no cached data", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, ratesData: [] });
    const { isRateStale } = await import("@/lib/exchange-rates");
    vi.mocked(isRateStale).mockReturnValue(false);
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns 500 with FETCH_ERROR when DB fails", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, ratesError: { message: "Database unavailable" } });
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
