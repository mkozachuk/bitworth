import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// Mock at the request boundary. The handler's own `supabase.auth.getUser()`
// runs against the Request; the mock's getUser returns a user when the
// factory is built with a userId. The test chooses userId based on whether
// the test Request carries a Cookie header — matching what a real
// missing-cookie request produces. See context/foundation/test-plan.md:43.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { GET, POST } from "@/pages/api/assets/index";

const userA = "user-A";

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

describe("GET /api/assets", () => {
  it("filters by user_id and 200s on authenticated request", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: [{ id: "a1" }], error: null } },
    });
    mocks.factory = () => m;

    const request = makeRequest("http://localhost/api/assets", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([{ id: "a1" }]);
  });

  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const request = makeRequest("http://localhost/api/assets");
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });
});

describe("POST /api/assets", () => {
  it("bakes user_id into the insert payload", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: { id: "new-asset" }, error: null } },
    });
    mocks.factory = () => m;

    const form = new FormData();
    form.set("name", "Test");
    form.set("amount", "100");
    form.set("currency", "USD");
    form.set("category_id", "cash");

    const request = makeRequest("http://localhost/api/assets", {
      method: "POST",
      headers: { Cookie: "sb-access-token=fake" },
      body: form,
    });
    const response = await POST({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);

    const insertCall = m.recorded.find((c) => c.method === "insert");
    expect(insertCall).toBeDefined();
    const payload = insertCall?.args[0] as Record<string, unknown>;
    expect(payload.user_id).toBe(userA);
  });

  it("includes show_on_chart=true in the insert payload when checked", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: { id: "new-asset" }, error: null } },
    });
    mocks.factory = () => m;

    const form = new FormData();
    form.set("name", "Test");
    form.set("amount", "100");
    form.set("currency", "USD");
    form.set("category_id", "cash");
    form.set("show_on_chart", "true");

    const request = makeRequest("http://localhost/api/assets", {
      method: "POST",
      headers: { Cookie: "sb-access-token=fake" },
      body: form,
    });
    const response = await POST({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);

    const insertCall = m.recorded.find((c) => c.method === "insert");
    const payload = insertCall?.args[0] as Record<string, unknown>;
    expect(payload.show_on_chart).toBe(true);
  });

  // The new asset takes the top slot: one below the caller's current minimum
  // `sort_order`. The first `assets` await is the min-select, the second is the
  // insert, hence the queue.
  it("places a new asset one slot above the current minimum sort_order", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResultQueues: {
        assets: [
          { data: [{ sort_order: -2 }], error: null },
          { data: { id: "new-asset" }, error: null },
        ],
      },
    });
    mocks.factory = () => m;

    const form = new FormData();
    form.set("name", "Test");
    form.set("amount", "100");
    form.set("currency", "USD");
    form.set("category_id", "cash");

    const request = makeRequest("http://localhost/api/assets", {
      method: "POST",
      headers: { Cookie: "sb-access-token=fake" },
      body: form,
    });
    const response = await POST({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);

    const insertCall = m.recorded.find((c) => c.method === "insert");
    const payload = insertCall?.args[0] as Record<string, unknown>;
    expect(payload.sort_order).toBe(-3);
  });

  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const form = new FormData();
    form.set("name", "Test");
    form.set("amount", "100");
    form.set("currency", "USD");
    form.set("category_id", "cash");

    const request = makeRequest("http://localhost/api/assets", { method: "POST", body: form });
    const response = await POST({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });
});
