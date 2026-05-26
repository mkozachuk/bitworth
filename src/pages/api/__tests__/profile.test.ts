/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "../profile/index";

const dbRef = { current: null as unknown };

vi.mock("@/lib/db", () => ({
  createDbClient: vi.fn(() => dbRef.current),
}));

function makeRequestContext(body: unknown) {
  return {
    request: new Request("http://localhost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    cookies: { get: (_n: string) => ({}), set: vi.fn(), delete: vi.fn(), getAll: () => [] } as unknown,
    params: {},
  };
}

function buildMockClient(overrides: {
  user: { id: string } | null;
  profileData?: unknown;
  profileError?: { message: string };
}) {
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: overrides.user } }) };

  // Supabase returns a thenable for each query builder method call
  // We need the chain: from().update().eq().select().single()
  const singleBuilder = () => ({
    data: overrides.profileData ?? { id: "user-1", display_currency: "PLN" },
    error: overrides.profileError ?? null,
  });

  const from = (table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({ eq: () => ({ single: singleBuilder }) }),
        update: () => ({
          eq: () => ({
            select: () => ({ single: singleBuilder }),
          }),
        }),
      };
    }
    return { select: () => ({}), update: () => ({}) };
  };

  return { auth, from };
}

describe("PUT /api/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = null;
  });

  it("returns 401 when unauthenticated", async () => {
    dbRef.current = buildMockClient({ user: null });
    const ctx = makeRequestContext({ display_currency: "EUR" });
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with updated profile on success", async () => {
    const updated = { id: "user-1", display_currency: "EUR" };
    dbRef.current = buildMockClient({ user: { id: "user-1" }, profileData: updated });
    const ctx = makeRequestContext({ display_currency: "EUR" });
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.display_currency).toBe("EUR");
  });

  it("returns 400 with VALIDATION_ERROR for invalid currency", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" } });
    const ctx = makeRequestContext({ display_currency: "GBP" });
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with VALIDATION_ERROR when display_currency is missing", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" } });
    const ctx = makeRequestContext({});
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with INVALID_BODY for malformed JSON", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" } });
    const ctx = makeRequestContext("not valid json{");
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 500 with UPDATE_ERROR when DB update fails", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, profileError: { message: "Update failed" } });
    const ctx = makeRequestContext({ display_currency: "USD" });
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("UPDATE_ERROR");
  });
});
