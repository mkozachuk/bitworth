import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, type RecordedCall } from "@/test-utils/supabase-mock";

// Per-handler integration test for /api/user-preferences. Mirrors the
// pattern from src/pages/api/assets/index.test.ts and
// src/pages/api/snapshots/index.test.ts. Pins the .eq('user_id', user.id)
// filter on both GET and PUT (lessons.md §4 RLS defense in depth) and
// the validation regex for display_currency and theme.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { GET, PUT } from "@/pages/api/user-preferences/index";

const userA = "user-A";

function findCall(recorded: RecordedCall[], method: string, args: unknown[]): RecordedCall | undefined {
  return recorded.find((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));
}

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

function makeJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PUT",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const prefsRow = { display_currency: "USD", theme: "system" };
const updatedRow = { display_currency: "EUR", theme: "light" };

describe("GET /api/user-preferences", () => {
  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const request = makeRequest("http://localhost/api/user-preferences");
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });

  it("returns 200 with the user's prefs when the row is present", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { user_preferences: { data: prefsRow, error: null } },
    });
    mocks.factory = () => m;

    const request = makeRequest("http://localhost/api/user-preferences", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { display_currency: string; theme: string } };
    expect(body.data).toEqual(prefsRow);
  });

  it("filters by user_id in the read chain", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { user_preferences: { data: prefsRow, error: null } },
    });
    mocks.factory = () => m;

    const request = makeRequest("http://localhost/api/user-preferences", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    await GET({ request, cookies: createCookiesStub() } as never);
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
  });

  it("returns 404 when the prefs row is missing", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { user_preferences: { data: null, error: null } },
    });
    mocks.factory = () => m;

    const request = makeRequest("http://localhost/api/user-preferences", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(404);
  });
});

describe("PUT /api/user-preferences", () => {
  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", { display_currency: "EUR" });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });

  it("returns 400 on invalid display_currency and names the field", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", { display_currency: "GBP" });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/display_currency/);
  });

  it("returns 400 on invalid theme", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", { theme: "auto" });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/theme/);
  });

  it("returns 200 with the updated row on a valid body and pins .eq('user_id', user.id)", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { user_preferences: { data: updatedRow, error: null } },
    });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", {
      display_currency: "EUR",
      theme: "light",
    });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { display_currency: string; theme: string } };
    expect(body.data).toEqual(updatedRow);

    // Lesson §4 structural pin: the update chain MUST include
    // .eq('user_id', user.id) as a defense-in-depth alongside RLS.
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
  });

  it("only the supplied field appears in the update payload (no surprise writes)", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { user_preferences: { data: { display_currency: "EUR", theme: "system" }, error: null } },
    });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", { display_currency: "EUR" });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);

    // The upsert payload contains display_currency and user_id (for the
    // onConflict clause) but does NOT include theme.
    const upsertCall = m.recorded.find((c) => c.method === "upsert");
    expect(upsertCall).toBeDefined();
    const payload = upsertCall?.args[0] as Record<string, unknown>;
    expect(payload.display_currency).toBe("EUR");
    expect(payload.user_id).toBe(userA);
    expect(payload).not.toHaveProperty("theme");
  });
});
