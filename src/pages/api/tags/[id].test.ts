import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub } from "@/test-utils/supabase-mock";

// /api/tags/:id: rename, toggle show_on_dashboard, delete. Beyond validation,
// the weight is on ownership: every write filters .eq("id").eq("user_id"), in
// that order, and another user's tag (no match) is a 404 — never a 403 and
// never their row.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { PATCH, DELETE } from "@/pages/api/tags/[id]";

const userA = "user-A";
const tagId = "11111111-1111-4111-8111-111111111111";
const updated = { id: tagId, name: "Renamed", show_on_dashboard: true };

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/tags/${tagId}`, {
    method: "PATCH",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request(`http://localhost/api/tags/${tagId}`, {
    method: "DELETE",
    headers: { Cookie: "sb-access-token=fake" },
  });
}

function mockWith(result: { data: unknown; error: unknown }) {
  const m = createSupabaseMock({ userId: userA, tableResults: { tags: result } });
  mocks.factory = () => m;
  return m;
}

function eqArgs(m: ReturnType<typeof createSupabaseMock>): unknown[][] {
  return m.recorded.filter((c) => c.method === "eq").map((c) => c.args);
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

describe("PATCH /api/tags/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.factory = () => createSupabaseMock({ userId: null });
    const response = await PATCH({
      request: patchRequest({ name: "x" }),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(401);
  });

  it.each([
    ["a rename (trimmed)", { name: " Renamed " }, { name: "Renamed" }],
    ["a toggle", { show_on_dashboard: true }, { show_on_dashboard: true }],
    ["both at once", { name: "Renamed", show_on_dashboard: false }, { name: "Renamed", show_on_dashboard: false }],
  ])("applies %s and returns 200, scoped by id then user_id", async (_label, body, expectedUpdate) => {
    const m = mockWith({ data: updated, error: null });

    const response = await PATCH({
      request: patchRequest(body),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: updated });
    expect(m.recorded.find((c) => c.method === "update")?.args[0]).toEqual(expectedUpdate);
    expect(eqArgs(m)).toEqual([
      ["id", tagId],
      ["user_id", userA],
    ]);
  });

  it("returns 404 NOT_FOUND for another user's tag — never 403, never their row", async () => {
    // A foreign row does not match .eq("user_id"), so the update returns no data.
    mockWith({ data: null, error: null });
    const response = await PATCH({
      request: patchRequest({ name: "Mine now" }),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Tag not found" } });
  });

  it("returns 409 DUPLICATE_TAG when renaming onto a name the user already has (ignoring case)", async () => {
    mockWith({ data: null, error: { code: "23505", message: "duplicate key value" } });
    const response = await PATCH({
      request: patchRequest({ name: "ETF" }),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({ code: "DUPLICATE_TAG", message: 'A tag named "ETF" already exists' });
  });

  it.each([
    ["an empty body", {}, "At least one of name or show_on_dashboard is required"],
    ["an empty name", { name: "" }, "name must not be empty"],
    ["a 33-character name", { name: "z".repeat(33) }, "name must be at most 32 characters"],
    ["a non-boolean toggle", { show_on_dashboard: 1 }, "show_on_dashboard must be a boolean"],
  ])("returns 400 for %s, without writing", async (_label, body, message) => {
    const m = mockWith({ data: updated, error: null });
    const response = await PATCH({
      request: patchRequest(body),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({ code: "VALIDATION_ERROR", message });
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("returns 400 for a malformed id", async () => {
    mockWith({ data: updated, error: null });
    const response = await PATCH({
      request: patchRequest({ name: "x" }),
      cookies: createCookiesStub(),
      params: { id: "not-a-uuid" },
    } as never);
    expect(response.status).toBe(400);
  });

  it("returns 500 UPDATE_FAILED for any other database error", async () => {
    mockWith({ data: null, error: { code: "XX000", message: "boom" } });
    const response = await PATCH({
      request: patchRequest({ name: "x" }),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("UPDATE_FAILED");
  });
});

describe("DELETE /api/tags/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.factory = () => createSupabaseMock({ userId: null });
    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(401);
  });

  it("deletes the caller's tag, scoped by id then user_id", async () => {
    const m = mockWith({ data: { id: tagId }, error: null });
    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: tagId } });
    expect(m.recorded.some((c) => c.method === "delete")).toBe(true);
    expect(eqArgs(m)).toEqual([
      ["id", tagId],
      ["user_id", userA],
    ]);
  });

  it("returns 404 NOT_FOUND for another user's tag", async () => {
    mockWith({ data: null, error: null });
    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: tagId },
    } as never);
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({ code: "NOT_FOUND", message: "Tag not found" });
  });

  it("returns 400 for a malformed id", async () => {
    mockWith({ data: null, error: null });
    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: "x" },
    } as never);
    expect(response.status).toBe(400);
  });
});
