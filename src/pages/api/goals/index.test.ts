import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";
import type { TableResult } from "@/test-utils/supabase-mock";

// Per-handler coverage for /api/goals — the gap `allocation-cards` and
// `allocation-targets` left (they have only the auto-generated auth-contract
// walk). The load-bearing assertions here are the tenant filter
// (.eq("user_id", user.id) — risk #2 in test-plan.md, cross-tenant leak) and
// the hand-rolled validation matrix, every branch of which mirrors either the
// DB CHECK constraints or the NUMERIC(18,2) column precision.
//
// Mock wiring is the `vi.hoisted` + `vi.mock("@/lib/supabase")` +
// import-after-mock pattern from snapshots/index.test.ts:17-30. `asClient` is
// not needed — that helper is for src/lib/ SUTs taking a real SupabaseClient.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { GET, POST } from "@/pages/api/goals/index";

const userA = "user-A";

const goalRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Emergency fund",
  kind: "net_worth",
  category_id: null,
  target_amount: 50000,
  target_currency: "EUR",
  target_date: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Emergency fund",
    kind: "net_worth",
    target_amount: 50000,
    target_currency: "EUR",
    ...overrides,
  };
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/goals", {
    method: "POST",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getRequest(withCookie = true): Request {
  return new Request("http://localhost/api/goals", {
    headers: withCookie ? { Cookie: "sb-access-token=fake" } : {},
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("GET /api/goals", () => {
  it("returns 200 and the user's goals on an authenticated request", async () => {
    const m = createSupabaseMock({ userId: userA, tableResults: { goals: { data: [goalRow], error: null } } });
    mocks.factory = () => m;

    const response = await GET({ request: getRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string }[] };
    expect(body.data.map((g) => g.id)).toEqual([goalRow.id]);
  });

  it("filters by user_id so another tenant's rows can never be selected", async () => {
    const m = createSupabaseMock({ userId: userA, tableResults: { goals: { data: [], error: null } } });
    mocks.factory = () => m;

    await GET({ request: getRequest(), cookies: createCookiesStub() } as never);
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
  });

  it("orders by created_at ascending", async () => {
    const m = createSupabaseMock({ userId: userA, tableResults: { goals: { data: [], error: null } } });
    mocks.factory = () => m;

    await GET({ request: getRequest(), cookies: createCookiesStub() } as never);
    expect(findCall(m.recorded, "order", ["created_at", { ascending: true }])).toBeDefined();
  });

  it("never selects user_id, so the tenant key cannot leak into a response body", async () => {
    // Structural pin: the projection is the only thing standing between the
    // stored row and the wire. A future `select("*")` regression is caught here.
    const m = createSupabaseMock({ userId: userA, tableResults: { goals: { data: [], error: null } } });
    mocks.factory = () => m;

    await GET({ request: getRequest(), cookies: createCookiesStub() } as never);
    const selectCall = m.recorded.find((c) => c.method === "select");
    expect(selectCall).toBeDefined();
    expect(String(selectCall?.args[0])).not.toContain("user_id");
  });

  it("returns 401 UNAUTHORIZED when there is no session", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const response = await GET({ request: getRequest(false), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("UNAUTHORIZED");
  });

  it("returns 500 FETCH_FAILED when the query errors", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { goals: { data: null, error: { message: "boom" } } },
    });
    mocks.factory = () => m;

    const response = await GET({ request: getRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("FETCH_FAILED");
  });
});

describe("POST /api/goals", () => {
  function mockWithInsert(result: TableResult = { data: goalRow, error: null }) {
    const m = createSupabaseMock({ userId: userA, tableResults: { goals: result } });
    mocks.factory = () => m;
    return m;
  }

  it("creates a net-worth goal and returns 201", async () => {
    const m = mockWithInsert();

    const response = await POST({ request: makeRequest(validBody()), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const insertCall = m.recorded.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toMatchObject({
      user_id: userA,
      name: "Emergency fund",
      kind: "net_worth",
      category_id: null,
      target_amount: 50000,
      target_currency: "EUR",
      target_date: null,
    });
  });

  it("creates a category goal with its category_id", async () => {
    const m = mockWithInsert({ data: { ...goalRow, kind: "category", category_id: "cash" }, error: null });

    const response = await POST({
      request: makeRequest(validBody({ kind: "category", category_id: "cash" })),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(m.recorded.find((c) => c.method === "insert")?.args[0]).toMatchObject({
      kind: "category",
      category_id: "cash",
    });
  });

  it("accepts a target below the current value — a completed goal is legal", async () => {
    mockWithInsert();

    const response = await POST({
      request: makeRequest(validBody({ target_amount: 0.01 })),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
  });

  it("accepts an optional ISO target_date", async () => {
    const m = mockWithInsert();

    const response = await POST({
      request: makeRequest(validBody({ target_date: "2027-12-31" })),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(m.recorded.find((c) => c.method === "insert")?.args[0]).toMatchObject({ target_date: "2027-12-31" });
  });

  it("never selects user_id on the created row", async () => {
    const m = mockWithInsert();

    await POST({ request: makeRequest(validBody()), cookies: createCookiesStub() } as never);
    const selectCall = m.recorded.find((c) => c.method === "select");
    expect(String(selectCall?.args[0])).not.toContain("user_id");
  });

  it("returns 401 UNAUTHORIZED when there is no session", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(validBody()), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("UNAUTHORIZED");
  });

  it("returns 400 VALIDATION_ERROR on a malformed JSON body", async () => {
    mockWithInsert();

    const response = await POST({ request: makeRequest("{not json"), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when the body is not an object", async () => {
    mockWithInsert();

    const response = await POST({ request: makeRequest("[]"), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
  });

  const rejections: { title: string; body: Record<string, unknown> }[] = [
    { title: "an empty name", body: validBody({ name: "   " }) },
    { title: "a non-string name", body: validBody({ name: 42 }) },
    { title: "a name longer than 60 characters", body: validBody({ name: "x".repeat(61) }) },
    { title: "an unknown kind", body: validBody({ kind: "retirement" }) },
    { title: "a non-numeric target_amount", body: validBody({ target_amount: "50000" }) },
    { title: "target_amount: 0", body: validBody({ target_amount: 0 }) },
    { title: "a negative target_amount", body: validBody({ target_amount: -1 }) },
    { title: "a target_amount with 3 decimal places", body: validBody({ target_amount: 100.123 }) },
    { title: "an absurdly large target_amount", body: validBody({ target_amount: 1e16 }) },
    { title: "an unsupported target_currency", body: validBody({ target_currency: "GBP" }) },
    { title: "a non-ISO target_date", body: validBody({ target_date: "31/12/2027" }) },
    { title: "a calendar-invalid target_date", body: validBody({ target_date: "2026-02-31" }) },
  ];

  for (const { title, body } of rejections) {
    it(`rejects ${title} with 400 VALIDATION_ERROR`, async () => {
      const m = mockWithInsert();

      const response = await POST({ request: makeRequest(body), cookies: createCookiesStub() } as never);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
      // Nothing reached the database.
      expect(m.recorded.find((c) => c.method === "insert")).toBeUndefined();
    });
  }

  it("rejects kind: category without a category_id with 400, not a 500 from the DB CHECK", async () => {
    const m = mockWithInsert();

    const response = await POST({
      request: makeRequest(validBody({ kind: "category" })),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(m.recorded.find((c) => c.method === "insert")).toBeUndefined();
  });

  it("rejects kind: net_worth carrying a category_id with 400, not a 500 from the DB CHECK", async () => {
    const m = mockWithInsert();

    const response = await POST({
      request: makeRequest(validBody({ kind: "net_worth", category_id: "cash" })),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(m.recorded.find((c) => c.method === "insert")).toBeUndefined();
  });

  it("returns 500 CREATE_FAILED when the insert errors", async () => {
    mockWithInsert({ data: null, error: { message: "insert boom" } });

    const response = await POST({ request: makeRequest(validBody()), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("CREATE_FAILED");
  });
});
