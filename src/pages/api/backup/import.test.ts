import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub } from "@/test-utils/supabase-mock";

// /api/backup/import must satisfy the project API-auth contract (401 when
// unauthenticated) and pin the import-specific guarantees: mode validation,
// version rejection, unknown-category rejection (with `context` AND no RPC
// call — nothing written unless the whole envelope validates), and the success
// path that calls `restore_backup` with the prepared payload.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { POST } from "@/pages/api/backup/import";

const userA = "user-A";

// A minimal but structurally-valid envelope. `category_id` values must be in
// the mocked asset_categories set. `mode` rides on the top-level body alongside
// the envelope fields (the UI posts `{ ...parsedJson, mode }`).
function validBody(mode: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app: "bitworth",
    schemaVersion: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    mode,
    data: {
      user_preferences: [],
      assets: [
        {
          id: "asset-a",
          user_id: userA,
          category_id: "cash",
          name: "Checking",
          amount: 500,
          currency: "USD",
        },
      ],
      snapshots: [
        {
          id: "snap-1",
          user_id: userA,
          total_net_worth: 500,
          display_currency: "USD",
          source: "manual",
        },
      ],
      snapshot_items: [
        {
          id: "item-1",
          snapshot_id: "snap-1",
          category_id: "cash",
          name: "Checking",
          original_amount: 500,
          original_currency: "USD",
          converted_amount: 500,
          display_currency: "USD",
        },
      ],
    },
    ...overrides,
  };
}

function authedMock() {
  return createSupabaseMock({
    userId: userA,
    tableResults: {
      asset_categories: { data: [{ id: "cash" }], error: null },
    },
  });
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/backup/import", {
    method: "POST",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rpcCall(m: ReturnType<typeof createSupabaseMock>) {
  return m.recorded.find((c) => c.method === "rpc");
}

describe("POST /api/backup/import", () => {
  it("returns 401 when unauthenticated", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(validBody("replace")), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("calls supabase.auth.getUser()", async () => {
    const m = authedMock();
    const spy = vi.spyOn(m.client.auth, "getUser");
    mocks.factory = () => m;

    await POST({ request: makeRequest(validBody("replace")), cookies: createCookiesStub() } as never);
    expect(spy).toHaveBeenCalled();
  });

  it("returns 400 when mode is missing", async () => {
    const m = authedMock();
    mocks.factory = () => m;

    const body = validBody("replace");
    delete body.mode;
    const response = await POST({ request: makeRequest(body), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(rpcCall(m)).toBeUndefined();
  });

  it("returns 400 when mode is invalid", async () => {
    const m = authedMock();
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(validBody("wipe")), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(rpcCall(m)).toBeUndefined();
  });

  it("returns 400 on a newer schemaVersion and does not call the RPC", async () => {
    const m = authedMock();
    mocks.factory = () => m;

    const response = await POST({
      request: makeRequest(validBody("replace", { schemaVersion: 99 })),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("UNSUPPORTED_VERSION");
    expect(rpcCall(m)).toBeUndefined();
  });

  it("returns 400 with context listing the unknown category_id and does not call the RPC", async () => {
    const m = authedMock();
    mocks.factory = () => m;

    const body = validBody("replace");
    (body.data as { assets: Record<string, unknown>[] }).assets[0].category_id = "bogus";
    const response = await POST({ request: makeRequest(body), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string; context?: { unknownCategoryIds?: string[] } } };
    expect(json.error.code).toBe("UNKNOWN_CATEGORY");
    expect(json.error.context?.unknownCategoryIds).toContain("bogus");
    expect(rpcCall(m)).toBeUndefined();
  });

  it("returns 200 and calls restore_backup with the prepared payload on a valid file", async () => {
    const m = authedMock();
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(validBody("replace")), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);

    const call = rpcCall(m);
    expect(call).toBeDefined();
    const [name, args] = (call?.args ?? []) as [string, { p_mode: string; p_data: Record<string, unknown[]> }];
    expect(name).toBe("restore_backup");
    expect(args.p_mode).toBe("replace");
    // prepareForImport strips ownership/id and remaps snapshot_items.snapshot_id
    // to the freshly-generated snapshots.id.
    expect(args.p_data.assets[0]).not.toHaveProperty("user_id");
    expect(args.p_data.assets[0]).not.toHaveProperty("id");
    const newSnapshotId = (args.p_data.snapshots[0] as { id: string }).id;
    expect((args.p_data.snapshot_items[0] as { snapshot_id: string }).snapshot_id).toBe(newSnapshotId);
  });

  it("returns 500 RESTORE_FAILED when the RPC errors", async () => {
    const m = authedMock();
    m.client.rpc = () => Promise.resolve({ data: null, error: { message: "boom" } });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(validBody("replace")), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: { code: string; context?: unknown } };
    expect(json.error.code).toBe("RESTORE_FAILED");
    expect(json.error.context).toBe("boom");
  });
});
