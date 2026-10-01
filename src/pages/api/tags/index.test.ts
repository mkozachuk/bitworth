import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// /api/tags: list and create. The properties that carry weight: every read and
// write is scoped to the caller, the name rule (trimmed, 1–32), and a duplicate
// name, decided by the database's case-insensitive unique index, is a 409.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { GET, POST } from "@/pages/api/tags/index";

const userA = "user-A";
const tagRow = { id: "11111111-1111-4111-8111-111111111111", name: "Long term", show_on_dashboard: false };

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/tags", {
    method: "POST",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return body.error;
}

describe("GET /api/tags", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.factory = () => createSupabaseMock({ userId: null });
    const response = await GET({
      request: new Request("http://localhost/api/tags"),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("UNAUTHORIZED");
  });

  it("lists the caller's tags, scoped by user_id, without selecting user_id", async () => {
    const m = createSupabaseMock({ userId: userA, tableResults: { tags: { data: [tagRow], error: null } } });
    mocks.factory = () => m;

    const response = await GET({
      request: new Request("http://localhost/api/tags"),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [tagRow] });
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
    for (const call of m.recorded.filter((c) => c.method === "select")) {
      expect(String(call.args[0])).not.toContain("user_id");
    }
  });

  it("returns 500 FETCH_FAILED when the read fails", async () => {
    mocks.factory = () =>
      createSupabaseMock({ userId: userA, tableResults: { tags: { data: null, error: { message: "boom" } } } });
    const response = await GET({
      request: new Request("http://localhost/api/tags"),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toEqual({ code: "FETCH_FAILED", message: "boom" });
  });
});

describe("POST /api/tags", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.factory = () => createSupabaseMock({ userId: null });
    const response = await POST({ request: postRequest({ name: "x" }), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });

  it("creates a tag with the trimmed name, stamped with the caller's user_id, and returns 201", async () => {
    const m = createSupabaseMock({ userId: userA, tableResults: { tags: { data: tagRow, error: null } } });
    mocks.factory = () => m;

    const response = await POST({
      request: postRequest({ name: "  Long term " }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: tagRow });
    expect(m.recorded.find((c) => c.method === "insert")?.args[0]).toEqual({ user_id: userA, name: "Long term" });
  });

  it("passes show_on_dashboard through when given", async () => {
    const m = createSupabaseMock({ userId: userA, tableResults: { tags: { data: tagRow, error: null } } });
    mocks.factory = () => m;

    await POST({
      request: postRequest({ name: "ETF", show_on_dashboard: true }),
      cookies: createCookiesStub(),
    } as never);
    expect(m.recorded.find((c) => c.method === "insert")?.args[0]).toEqual({
      user_id: userA,
      name: "ETF",
      show_on_dashboard: true,
    });
  });

  it.each([
    ["an empty name", { name: "" }, "name must not be empty"],
    ["a whitespace name", { name: "   " }, "name must not be empty"],
    ["a 33-character name", { name: "a".repeat(33) }, "name must be at most 32 characters"],
    ["a missing name", {}, "name must be a string"],
    [
      "a non-boolean show_on_dashboard",
      { name: "ETF", show_on_dashboard: "yes" },
      "show_on_dashboard must be a boolean",
    ],
    ["an array body", [], "Request body must be an object with name"],
  ])("returns 400 VALIDATION_ERROR for %s, without writing", async (_label, body, message) => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const response = await POST({ request: postRequest(body), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({ code: "VALIDATION_ERROR", message });
    expect(m.recorded.find((c) => c.method === "insert")).toBeUndefined();
  });

  it("returns 400 for invalid JSON", async () => {
    mocks.factory = () => createSupabaseMock({ userId: userA });
    const response = await POST({ request: postRequest("{not json"), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
  });

  it("returns 409 DUPLICATE_TAG when the name is taken (unique_violation 23505), in the error shape", async () => {
    mocks.factory = () =>
      createSupabaseMock({
        userId: userA,
        tableResults: { tags: { data: null, error: { code: "23505", message: "duplicate key value" } } },
      });

    const response = await POST({ request: postRequest({ name: "etf" }), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "DUPLICATE_TAG", message: 'A tag named "etf" already exists' },
    });
  });

  it("returns 500 CREATE_FAILED for any other database error", async () => {
    mocks.factory = () =>
      createSupabaseMock({
        userId: userA,
        tableResults: { tags: { data: null, error: { code: "XX000", message: "boom" } } },
      });
    const response = await POST({ request: postRequest({ name: "ETF" }), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("CREATE_FAILED");
  });
});
