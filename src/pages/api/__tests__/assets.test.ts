/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "../assets/index";
import { PUT, DELETE } from "../assets/[id]";

const dbRef = { current: null as unknown };

vi.mock("@/lib/db", () => ({
  createDbClient: vi.fn(() => dbRef.current),
}));

function makeContext(method = "GET", body?: unknown) {
  return {
    request: new Request("http://localhost", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    }),
    cookies: { get: (_n: string) => ({}), set: vi.fn(), delete: vi.fn(), getAll: () => [] } as unknown,
    params: {},
  };
}

function buildMockClient(overrides: {
  user: { id: string } | null;
  assetsData?: unknown[];
  assetsError?: { message: string };
  insertData?: unknown;
  insertError?: { message: string };
  updateData?: unknown;
  updateError?: { message: string };
  deleteError?: { message: string };
  existingAsset?: unknown;
}) {
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: overrides.user } }) };

  const assets = overrides.assetsData ?? [];
  const assetsError = overrides.assetsError ?? null;

  const from = (_table: string) => {
    const self = {
      select: (columns?: string) => {
        if (columns === "id") {
          return {
            eq: (_col1: string) => ({
              eq: (_col2: string) => ({
                single: () => ({ data: overrides.existingAsset ?? null, error: null }),
              }),
            }),
          };
        }
        return {
          eq: (col: string) => {
            if (col === "user_id") {
              return {
                order: () => ({ data: assets, error: assetsError }),
                eq: () => ({
                  single: () => ({ data: overrides.existingAsset ?? null, error: null }),
                }),
              };
            }
            return {
              single: () => ({ data: overrides.existingAsset ?? null, error: null }),
            };
          },
          single: () => ({ data: assets, error: assetsError }),
        };
      },
      insert: () => ({
        select: () => ({
          single: () => ({ data: overrides.insertData ?? { id: "new-1" }, error: overrides.insertError ?? null }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: () => ({
              data: overrides.updateData ?? { id: "asset-1" },
              error: overrides.updateError ?? null,
            }),
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: () => ({ data: null, error: overrides.deleteError ?? null }),
        }),
      }),
    };
    return self;
  };

  return { auth, from };
}

describe("GET /api/assets", () => {
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

  it("returns 200 with assets array when authenticated", async () => {
    const assets = [
      {
        id: "1",
        name: "Savings",
        amount: 5000,
        currency: "PLN",
        category: "Checking Account",
        is_liability: false,
        user_id: "user-1",
      },
      {
        id: "2",
        name: "Car Loan",
        amount: 20000,
        currency: "PLN",
        category: "Loans & Credit",
        is_liability: true,
        user_id: "user-1",
      },
    ];
    dbRef.current = buildMockClient({ user: { id: "user-1" }, assetsData: assets });
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe("Savings");
  });

  it("returns 500 with FETCH_ERROR when DB fails", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, assetsError: { message: "DB connection failed" } });
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("FETCH_ERROR");
  });
});

describe("POST /api/assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = null;
  });

  it("returns 401 when unauthenticated", async () => {
    dbRef.current = buildMockClient({ user: null });
    const ctx = makeContext("POST", { name: "Test", amount: 100, currency: "PLN", category: "Checking Account" });
    const res = await POST(ctx);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 201 with created asset on success", async () => {
    const created = {
      id: "new-1",
      name: "Savings Account",
      amount: 5000,
      currency: "PLN",
      category: "Checking Account",
      is_liability: false,
      user_id: "user-1",
    };
    dbRef.current = buildMockClient({ user: { id: "user-1" }, insertData: created });
    const ctx = makeContext("POST", {
      name: "Savings Account",
      amount: 5000,
      currency: "PLN",
      category: "Checking Account",
    });
    const res = await POST(ctx);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.id).toBe("new-1");
  });

  it("returns 400 with VALIDATION_ERROR for missing name", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" } });
    const ctx = makeContext("POST", { amount: 5000, currency: "PLN", category: "Checking Account" });
    const res = await POST(ctx);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("name is required");
  });

  it("returns 400 with VALIDATION_ERROR for invalid currency", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" } });
    const ctx = makeContext("POST", { name: "Test", amount: 100, currency: "GBP", category: "Checking Account" });
    const res = await POST(ctx);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 with INSERT_ERROR when DB insert fails", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, insertError: { message: "Constraint violation" } });
    const ctx = makeContext("POST", { name: "Test", amount: 100, currency: "PLN", category: "Checking Account" });
    const res = await POST(ctx);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INSERT_ERROR");
  });
});

describe("PUT /api/assets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = null;
  });

  it("returns 401 when unauthenticated", async () => {
    dbRef.current = buildMockClient({ user: null });
    const ctx = { ...makeContext(), params: { id: "asset-1" } };
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with updated asset on success", async () => {
    const updated = {
      id: "asset-1",
      name: "Updated Savings",
      amount: 6000,
      currency: "PLN",
      category: "Checking Account",
      is_liability: false,
      user_id: "user-1",
    };
    dbRef.current = buildMockClient({ user: { id: "user-1" }, updateData: updated, existingAsset: { id: "asset-1" } });
    const ctx = { ...makeContext("PUT", { name: "Updated Savings", amount: 6000 }), params: { id: "asset-1" } };
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.name).toBe("Updated Savings");
  });

  it("returns 500 with UPDATE_ERROR when DB update fails", async () => {
    dbRef.current = buildMockClient({
      user: { id: "user-1" },
      updateError: { message: "Update failed" },
      existingAsset: { id: "asset-1" },
    });
    const ctx = { ...makeContext("PUT", { name: "Updated" }), params: { id: "asset-1" } };
    const res = await PUT(ctx);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("UPDATE_ERROR");
  });
});

describe("DELETE /api/assets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = null;
  });

  it("returns 401 when unauthenticated", async () => {
    dbRef.current = buildMockClient({ user: null });
    const ctx = { ...makeContext(), params: { id: "asset-1" } };
    const res = await DELETE(ctx);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 204 on successful deletion", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, existingAsset: { id: "asset-1" } });
    const ctx = { ...makeContext(), params: { id: "asset-1" } };
    const res = await DELETE(ctx);
    expect(res.status).toBe(204);
  });
});
