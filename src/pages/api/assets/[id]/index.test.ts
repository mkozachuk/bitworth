import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// Per-handler integration test for /api/assets/[id] PUT and DELETE.
// The compound `id + user_id` filter is the cross-tenant defense (Risk #2
// from context/foundation/test-plan.md §2). The PUT payload-shape assertion
// pins the structural property that `user_id` is NOT in the update
// payload — a future "transfer asset" feature that adds `user_id` to the
// updates object would otherwise silently bypass the handler filter (the
// USING-only RLS gap, see plan §5 / Phase 5 migration).

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { PUT, DELETE } from "@/pages/api/assets/[id]/index";

const userA = "user-A";
const assetId = "asset-b";

describe("PUT /api/assets/[id]", () => {
  it("uses a compound id+user_id filter", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: { id: assetId }, error: null } },
    });
    mocks.factory = () => m;

    const form = new FormData();
    form.set("name", "Updated name");

    const request = new Request(`http://localhost/api/assets/${assetId}`, {
      method: "PUT",
      headers: { Cookie: "sb-access-token=fake" },
      body: form,
    });
    const response = await PUT({
      request,
      cookies: createCookiesStub(),
      params: { id: assetId },
    } as never);
    expect(response.status).toBe(200);

    const idEq = findCall(m.recorded, "eq", ["id", assetId]);
    const userEq = findCall(m.recorded, "eq", ["user_id", userA]);
    expect(idEq).toBeDefined();
    expect(userEq).toBeDefined();
    if (idEq === undefined || userEq === undefined) return;
    // The id filter must come before the user_id filter in the chain
    const idIdx = m.recorded.indexOf(idEq);
    const userIdx = m.recorded.indexOf(userEq);
    expect(idIdx).toBeLessThan(userIdx);
  });

  it("update payload does NOT contain user_id", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: { id: assetId }, error: null } },
    });
    mocks.factory = () => m;

    const form = new FormData();
    form.set("name", "Updated name");
    form.set("amount", "200");

    const request = new Request(`http://localhost/api/assets/${assetId}`, {
      method: "PUT",
      headers: { Cookie: "sb-access-token=fake" },
      body: form,
    });
    await PUT({ request, cookies: createCookiesStub(), params: { id: assetId } } as never);

    const updateCall = m.recorded.find((c) => c.method === "update");
    expect(updateCall).toBeDefined();
    const updates = updateCall?.args[0] as Record<string, unknown>;
    expect(updates).not.toHaveProperty("user_id");
  });

  it("returns 404 when the row does not match", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: null, error: null } },
    });
    mocks.factory = () => m;

    const form = new FormData();
    form.set("name", "Updated name");

    const request = new Request(`http://localhost/api/assets/${assetId}`, {
      method: "PUT",
      headers: { Cookie: "sb-access-token=fake" },
      body: form,
    });
    const response = await PUT({
      request,
      cookies: createCookiesStub(),
      params: { id: assetId },
    } as never);
    expect(response.status).toBe(404);
  });

  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const form = new FormData();
    form.set("name", "Updated name");

    const request = new Request(`http://localhost/api/assets/${assetId}`, { method: "PUT", body: form });
    const response = await PUT({
      request,
      cookies: createCookiesStub(),
      params: { id: assetId },
    } as never);
    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/assets/[id]", () => {
  it("uses a compound id+user_id filter", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: { id: assetId }, error: null } },
    });
    mocks.factory = () => m;

    const request = new Request(`http://localhost/api/assets/${assetId}`, {
      method: "DELETE",
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await DELETE({
      request,
      cookies: createCookiesStub(),
      params: { id: assetId },
    } as never);
    expect(response.status).toBe(200);

    expect(findCall(m.recorded, "eq", ["id", assetId])).toBeDefined();
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
  });

  it("returns 404 when no row matches", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: null, error: null } },
    });
    mocks.factory = () => m;

    const request = new Request(`http://localhost/api/assets/${assetId}`, {
      method: "DELETE",
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await DELETE({
      request,
      cookies: createCookiesStub(),
      params: { id: assetId },
    } as never);
    expect(response.status).toBe(404);
  });

  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const request = new Request(`http://localhost/api/assets/${assetId}`, { method: "DELETE" });
    const response = await DELETE({
      request,
      cookies: createCookiesStub(),
      params: { id: assetId },
    } as never);
    expect(response.status).toBe(401);
  });
});
