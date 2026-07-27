import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub } from "@/test-utils/supabase-mock";

// PATCH /api/assets/order must satisfy the project API-auth contract (401 when
// unauthenticated) and pin the reorder-specific guarantees: `ids` validation
// that never reaches the RPC, the exact `reorder_assets` call shape, and the
// 500 path when Postgres rejects the array (the RPC raises on a partial or
// foreign-id cover). Harness mirrors backup/import.test.ts.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { PATCH } from "@/pages/api/assets/order";

const userA = "user-A";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/assets/order", {
    method: "PATCH",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rpcCall(m: ReturnType<typeof createSupabaseMock>) {
  return m.recorded.find((c) => c.method === "rpc");
}

describe("PATCH /api/assets/order", () => {
  it("returns 401 when unauthenticated", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const response = await PATCH({ request: makeRequest({ ids: ["a"] }), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(rpcCall(m)).toBeUndefined();
  });

  it("calls supabase.auth.getUser()", async () => {
    const m = createSupabaseMock({ userId: userA });
    const spy = vi.spyOn(m.client.auth, "getUser");
    mocks.factory = () => m;

    await PATCH({ request: makeRequest({ ids: ["a"] }), cookies: createCookiesStub() } as never);
    expect(spy).toHaveBeenCalled();
  });

  it.each([
    ["missing ids", {}],
    ["ids is not an array", { ids: "a,b" }],
    ["ids is empty", { ids: [] }],
    ["ids has a non-string element", { ids: ["a", 7] }],
    ["ids has an empty-string element", { ids: ["a", ""] }],
  ])("returns 400 and makes no rpc call when %s", async (_label, body) => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const response = await PATCH({ request: makeRequest(body), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(rpcCall(m)).toBeUndefined();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const request = new Request("http://localhost/api/assets/order", {
      method: "PATCH",
      headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
      body: "{not json",
    });
    const response = await PATCH({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(rpcCall(m)).toBeUndefined();
  });

  it("returns 200 and calls reorder_assets with the id array in order", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const ids = ["asset-c", "asset-a", "asset-b"];
    const response = await PATCH({ request: makeRequest({ ids }), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);

    const call = rpcCall(m);
    expect(call).toBeDefined();
    const [name, args] = (call?.args ?? []) as [string, { p_ids: string[] }];
    expect(name).toBe("reorder_assets");
    expect(args.p_ids).toEqual(ids);

    const json = (await response.json()) as { data: { count: number } };
    expect(json.data.count).toBe(3);
  });

  it("returns 500 REORDER_FAILED when the RPC errors", async () => {
    const m = createSupabaseMock({ userId: userA });
    m.client.rpc = () =>
      Promise.resolve({
        data: null,
        error: { message: "reorder_assets: id array is not a complete, unique cover of the caller's assets" },
      });
    mocks.factory = () => m;

    const response = await PATCH({ request: makeRequest({ ids: ["a"] }), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: { code: string; context?: unknown } };
    expect(json.error.code).toBe("REORDER_FAILED");
    expect(json.error.context).toContain("complete, unique cover");
  });
});
