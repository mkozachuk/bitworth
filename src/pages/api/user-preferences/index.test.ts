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

describe("PUT /api/user-preferences — FIRE fields", () => {
  const fireRow = {
    display_currency: "USD",
    theme: "system",
    fire_current_age: 30,
    fire_annual_income: 80000,
    fire_annual_expenses: 40000,
    fire_expected_return: 0.07,
    fire_inflation_rate: 0.03,
    fire_safe_withdrawal_rate: 0.04,
    fire_starting_principal_override: null,
    fire_traditional_retirement_age: 65,
    fire_barista_income: null,
  };

  it("upserts a valid FIRE payload and echoes it back", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { user_preferences: { data: fireRow, error: null } },
    });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", {
      fire_current_age: 30,
      fire_annual_income: 80000,
      fire_annual_expenses: 40000,
      fire_expected_return: 0.07,
      fire_inflation_rate: 0.03,
      fire_safe_withdrawal_rate: 0.04,
      fire_traditional_retirement_age: 65,
    });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: typeof fireRow };
    expect(body.data).toEqual(fireRow);

    // The validated FIRE fields appear in the upsert payload alongside user_id.
    const upsertCall = m.recorded.find((c) => c.method === "upsert");
    const payload = upsertCall?.args[0] as Record<string, unknown>;
    expect(payload.fire_annual_income).toBe(80000);
    expect(payload.fire_safe_withdrawal_rate).toBe(0.04);
    expect(payload.user_id).toBe(userA);
    // Defense-in-depth: the .eq('user_id') filter is still pinned (lessons §4).
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
  });

  it("rejects an out-of-range rate with VALIDATION_ERROR and names the field", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", { fire_safe_withdrawal_rate: 1.5 });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/fire_safe_withdrawal_rate/);
  });

  it("rejects a zero safe withdrawal rate (strictly > 0)", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", { fire_safe_withdrawal_rate: 0 });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/fire_safe_withdrawal_rate/);
  });

  it("rejects traditional retirement age <= current age", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", {
      fire_current_age: 40,
      fire_traditional_retirement_age: 30,
    });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/fire_traditional_retirement_age/);
  });

  it("rejects a non-integer age", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", { fire_current_age: 30.5 });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/fire_current_age/);
  });

  it("accepts a partial FIRE payload and writes only the supplied fields", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { user_preferences: { data: { ...fireRow, fire_annual_income: 90000 }, error: null } },
    });
    mocks.factory = () => m;

    const request = makeJsonRequest("http://localhost/api/user-preferences", { fire_annual_income: 90000 });
    const response = await PUT({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);

    const upsertCall = m.recorded.find((c) => c.method === "upsert");
    const payload = upsertCall?.args[0] as Record<string, unknown>;
    expect(payload.fire_annual_income).toBe(90000);
    expect(payload.user_id).toBe(userA);
    // No other FIRE field, currency, or theme is clobbered on a partial write.
    expect(payload).not.toHaveProperty("fire_annual_expenses");
    expect(payload).not.toHaveProperty("fire_safe_withdrawal_rate");
    expect(payload).not.toHaveProperty("display_currency");
    expect(payload).not.toHaveProperty("theme");
  });
});
