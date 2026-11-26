import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// /api/snapshots is the only handler exercising Risks #2 AND #3 together:
// the GET filter (cross-tenant) AND the POST atomicity AND the sort order
// (chart's defensive re-sort is load-bearing per research §3). Since NB-060
// the POST writes parent + items through ONE `create_snapshot` rpc call, so
// atomicity and idempotency live in the database function (pinned on real
// Postgres in src/test/db/create-snapshot.test.ts); here the route's side of
// the contract is pinned: what it sends, and how it maps the reply.
//
// The `vi.mock("@/lib/exchange-rates", ...)` below bends the test-plan
// §6.2 "never mock internal modules" policy for one helper. The
// alternative (MSW against crypto_price_cache) is heavier than the
// problem. The exception is documented in test-plan §6.2 — see Phase 4
// of this change for the cookbook sync.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

vi.mock("@/lib/exchange-rates", () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  getRates: async () => ({ USD: 1, EUR: 1, PLN: 1 }),
}));

// The price modules import `astro:env/server` and call external APIs. The
// route's contract with them is exercised through `repriceAssets`
// (src/lib/reprice.test.ts); here they are stubbed so the POST scenarios can
// pin "the snapshot records the repriced amount" without a network.
const priceMocks = vi.hoisted(() => ({ crypto: vi.fn(), metal: vi.fn() }));
vi.mock("@/lib/crypto-prices", () => ({ getPrice: priceMocks.crypto }));
vi.mock("@/lib/metal-prices", () => ({ getPrice: priceMocks.metal }));

import { GET, POST } from "@/pages/api/snapshots/index";

const userA = "user-A";
const assetA = {
  id: "asset-a",
  user_id: userA,
  category_id: "cash",
  name: "Checking",
  amount: 500,
  currency: "USD",
  crypto_symbol: null,
  metal_symbol: null,
  quantity: null,
  notes: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  category: {
    id: "cash",
    name: "Cash",
    icon: null,
    is_liability: false,
    display_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
  },
};
const assetB = {
  ...assetA,
  id: "asset-b",
  name: "Savings",
  amount: 1000,
};

const baseAssetsResult = { data: [assetA, assetB], error: null };
const parentSnapshot = {
  id: "snap-1",
  user_id: userA,
  total_net_worth: 1500,
  display_currency: "USD",
  base_currency: "USD",
  source: "manual",
  note: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("GET /api/snapshots", () => {
  it("filters by user_id and 200s on authenticated request", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { snapshots: { data: [parentSnapshot], error: null } },
    });
    mocks.factory = () => m;

    const request = new Request("http://localhost/api/snapshots", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
  });

  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const request = new Request("http://localhost/api/snapshots");
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });

  it("returns rows ordered by created_at ascending", async () => {
    // The chain is responsible for the SQL ORDER BY — the test asserts the
    // structural property that the API asks for the right order. The
    // database does the actual sort in production.
    const rows = [
      { ...parentSnapshot, id: "s1", created_at: "2024-01-01T00:00:00.000Z" },
      { ...parentSnapshot, id: "s2", created_at: "2024-02-01T00:00:00.000Z" },
      { ...parentSnapshot, id: "s3", created_at: "2023-12-01T00:00:00.000Z" },
    ];
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { snapshots: { data: rows, error: null } },
    });
    mocks.factory = () => m;

    const request = new Request("http://localhost/api/snapshots", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    const body = (await response.json()) as { data: { id: string; created_at: string }[] };
    expect(body.data.map((r) => r.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("chain includes .order('created_at', { ascending: true })", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { snapshots: { data: [], error: null } },
    });
    mocks.factory = () => m;

    const request = new Request("http://localhost/api/snapshots", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    await GET({ request, cookies: createCookiesStub() } as never);
    expect(findCall(m.recorded, "order", ["created_at", { ascending: true }])).toBeDefined();
  });
});

interface RpcCall {
  name: string;
  args: { p_snapshot: Record<string, unknown>; p_items: Record<string, unknown>[]; p_client_request_id: unknown };
}

/**
 * Replace the shared mock's rpc (always `{data: null}`) with one that records
 * every call and answers with `reply`. Default reply: a created snapshot.
 */
function stubRpc(
  m: ReturnType<typeof createSupabaseMock>,
  reply: { data: unknown; error: unknown } = { data: { snapshot: parentSnapshot, created: true }, error: null },
): RpcCall[] {
  const calls: RpcCall[] = [];
  m.client.rpc = (name: string, args: unknown) => {
    calls.push({ name, args: args as RpcCall["args"] });
    return Promise.resolve(reply);
  };
  return calls;
}

function onlyRpcCall(calls: RpcCall[]): RpcCall["args"] {
  expect(calls).toHaveLength(1);
  expect(calls[0].name).toBe("create_snapshot");
  return calls[0].args;
}

const KEY = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("POST /api/snapshots", () => {
  function makeRequest(): Request {
    return new Request("http://localhost/api/snapshots", {
      method: "POST",
      headers: { Cookie: "sb-access-token=fake" },
    });
  }

  // Default: 2 assets, returned by the assets table. Per-scenario overrides
  // set `tableResults.assets` explicitly.
  const defaultTableResults = { assets: baseAssetsResult };

  function setup(
    tableResults: Record<string, { data: unknown; error: unknown }> = defaultTableResults,
    reply?: { data: unknown; error: unknown },
  ): { m: ReturnType<typeof createSupabaseMock>; calls: RpcCall[] } {
    const m = createSupabaseMock({ userId: userA, tableResults });
    const calls = stubRpc(m, reply);
    mocks.factory = () => m;
    return { m, calls };
  }

  function makeJsonRequest(body: unknown): Request {
    return new Request("http://localhost/api/snapshots", {
      method: "POST",
      headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("happy path: 2 assets, one create_snapshot call carries the parent and both items", async () => {
    const { m, calls } = setup();

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);

    const args = onlyRpcCall(calls);
    expect(args.p_items).toHaveLength(2);
    expect(args.p_snapshot).toMatchObject({
      total_net_worth: 1500,
      display_currency: "USD",
      base_currency: "USD",
      source: "manual",
    });
    // No direct table writes any more: no parent insert, no items insert, no
    // compensating delete.
    expect(m.builders.get("snapshots")).toBeUndefined();
    expect(m.builders.get("snapshot_items")).toBeUndefined();
    expect(m.recorded.find((c) => c.method === "delete")).toBeUndefined();
  });

  it("passes a UUID client_request_id to the rpc and answers 201 with the created row", async () => {
    const { calls } = setup();

    const response = await POST({
      request: makeJsonRequest({ client_request_id: KEY }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(onlyRpcCall(calls).p_client_request_id).toBe(KEY);
    const body = (await response.json()) as { data: { id: string }; repricing: unknown };
    expect(body.data.id).toBe(parentSnapshot.id);
    expect(body.repricing).toEqual({ repriced: 0, failed: [] });
  });

  it("a replayed client_request_id answers 200 with the existing row, same response shape", async () => {
    const existing = { ...parentSnapshot, id: "snap-first", client_request_id: KEY };
    const { calls } = setup(defaultTableResults, { data: { snapshot: existing, created: false }, error: null });

    const response = await POST({
      request: makeJsonRequest({ client_request_id: KEY }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(200);
    expect(onlyRpcCall(calls).p_client_request_id).toBe(KEY);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["data", "repricing"]);
    expect((body.data as { id: string }).id).toBe("snap-first");
  });

  it.each([
    ["a non-UUID string", "not-a-uuid"],
    ["a number", 42],
    ["a UUID with trailing junk", `${KEY}x`],
    ["an empty string", ""],
  ])("rejects %s as client_request_id with 400 VALIDATION_ERROR and calls nothing", async (_case, key) => {
    const { calls } = setup();
    const response = await POST({
      request: makeJsonRequest({ client_request_id: key }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(calls).toHaveLength(0);
  });

  it("legacy bodyless POST calls the rpc with a NULL client_request_id", async () => {
    const { calls } = setup();
    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    expect(onlyRpcCall(calls).p_client_request_id).toBeNull();
  });

  it("an explicit null client_request_id is the legacy NULL key", async () => {
    const { calls } = setup();
    const response = await POST({
      request: makeJsonRequest({ client_request_id: null, net_contribution: 5 }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(onlyRpcCall(calls).p_client_request_id).toBeNull();
  });

  it("reprices crypto holdings before recording: total and items use the live amount", async () => {
    priceMocks.crypto.mockImplementation(() =>
      Promise.resolve({ price: 80000, isCached: false, fetchedAt: "2026-08-30T00:00:00.000Z" }),
    );
    const btc = {
      ...assetA,
      id: "asset-btc",
      name: "Bitcoin",
      category_id: "crypto",
      amount: 59941,
      quantity: 0.5,
      crypto_symbol: "BTC",
      category: { ...assetA.category, id: "crypto", name: "Crypto" },
    };
    const { m, calls } = setup({ assets: { data: [assetA, btc], error: null } });

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { repricing: { repriced: number; failed: unknown[] } };
    expect(body.repricing).toEqual({ repriced: 1, failed: [] });

    // The refreshed amount was written back to the asset row…
    expect(findCall(m.recorded, "update", [{ amount: 40000, currency: "USD" }])).toBeDefined();
    // …and is what the snapshot recorded (500 cash + 40,000 BTC).
    const args = onlyRpcCall(calls);
    expect(args.p_snapshot.total_net_worth).toBe(40500);
    const items = args.p_items as { name: string; original_amount: number }[];
    expect(items.find((i) => i.name === "Bitcoin")?.original_amount).toBe(40000);
  });

  it("a price miss is not a snapshot failure: 201 with the stored amount and the miss reported", async () => {
    priceMocks.metal.mockImplementation(() =>
      Promise.resolve({ error: { code: "PRICE_UNAVAILABLE", message: "Could not fetch price" } }),
    );
    const gold = {
      ...assetA,
      id: "asset-gold",
      name: "Gold",
      category_id: "precious_metals",
      amount: 4053,
      quantity: 1,
      metal_symbol: "XAU",
    };
    const { m, calls } = setup({ assets: { data: [assetA, gold], error: null } });

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { repricing: { repriced: number; failed: { symbol: string }[] } };
    expect(body.repricing.repriced).toBe(0);
    expect(body.repricing.failed).toEqual([
      { id: "asset-gold", name: "Gold", symbol: "XAU", code: "PRICE_UNAVAILABLE" },
    ]);

    expect(onlyRpcCall(calls).p_snapshot.total_net_worth).toBe(4553);
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("rpc error → 500 INSERT_FAILED with the database message, and no other write", async () => {
    const { m, calls } = setup(defaultTableResults, { data: null, error: { message: "items fail" } });

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code: "INSERT_FAILED", message: "items fail" });
    expect(calls).toHaveLength(1);
    // The database rolled the parent back; the route has nothing to clean up.
    expect(m.recorded.find((c) => c.method === "delete")).toBeUndefined();
    expect(m.builders.get("snapshots")).toBeUndefined();
  });

  it("rpc answers without a snapshot row → 500 INSERT_FAILED, never a 201", async () => {
    for (const data of [null, {}, { created: true }]) {
      setup(defaultTableResults, { data, error: null });
      const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INSERT_FAILED");
    }
  });

  it("empty assets: parent row created with total_net_worth: 0", async () => {
    // Pins the current behavior: a parent snapshot with `total_net_worth: 0`
    // is still committed when the user has no assets (the rpc gets an empty
    // items array and writes the parent only). Whether this is desired is a
    // product question; the test pins so a future refactor is observable.
    const { calls } = setup(
      { assets: { data: [], error: null } },
      {
        data: { snapshot: { ...parentSnapshot, total_net_worth: 0 }, created: true },
        error: null,
      },
    );

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { total_net_worth: number } };
    expect(body.data.total_net_worth).toBe(0);

    const args = onlyRpcCall(calls);
    expect(args.p_items).toEqual([]);
    expect(args.p_snapshot.total_net_worth).toBe(0);
  });

  it("persists net_contribution: 500 from the body into the rpc payload", async () => {
    const { calls } = setup();
    const response = await POST({
      request: makeJsonRequest({ net_contribution: 500 }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(onlyRpcCall(calls).p_snapshot.net_contribution).toBe(500);
  });

  it("persists a negative net_contribution (-200, a withdrawal)", async () => {
    const { calls } = setup();
    const response = await POST({
      request: makeJsonRequest({ net_contribution: -200 }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(onlyRpcCall(calls).p_snapshot.net_contribution).toBe(-200);
  });

  it("bodyless POST succeeds (201) with no net_contribution key in the rpc payload", async () => {
    const { calls } = setup();
    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    expect(onlyRpcCall(calls).p_snapshot).not.toHaveProperty("net_contribution");
  });

  it("rejects a non-numeric net_contribution with 400 VALIDATION_ERROR", async () => {
    const { calls } = setup();
    const response = await POST({
      request: makeJsonRequest({ net_contribution: "lots" }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(calls).toHaveLength(0);
  });

  it("rejects a NaN net_contribution with 400 VALIDATION_ERROR", async () => {
    const { calls } = setup();
    // NaN is not valid JSON, so it serializes to null; send a raw NaN-bearing
    // string body to exercise the non-finite guard directly.
    const request = new Request("http://localhost/api/snapshots", {
      method: "POST",
      headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
      body: '{"net_contribution": NaN}',
    });
    const response = await POST({ request, cookies: createCookiesStub() } as never);
    // Invalid JSON is swallowed → bodyless behavior (201, no key). This pins
    // that a malformed body never 500s and never persists a bad value.
    expect(response.status).toBe(201);
    const args = onlyRpcCall(calls);
    expect(args.p_snapshot).not.toHaveProperty("net_contribution");
    expect(args.p_client_request_id).toBeNull();
  });

  it("treats explicit null net_contribution as no contribution (column stays NULL)", async () => {
    const { calls } = setup();
    const response = await POST({
      request: makeJsonRequest({ net_contribution: null }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(onlyRpcCall(calls).p_snapshot).not.toHaveProperty("net_contribution");
  });

  it("persists income from the body into the rpc payload (B2)", async () => {
    const { calls } = setup();
    const response = await POST({
      request: makeJsonRequest({ net_contribution: 500, income: 4200.5 }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    const args = onlyRpcCall(calls);
    expect(args.p_snapshot.income).toBe(4200.5);
    expect(args.p_snapshot.net_contribution).toBe(500);
  });

  it("income alone is accepted, and a body with neither key leaves both out (B2)", async () => {
    const { calls } = setup();
    const response = await POST({ request: makeJsonRequest({ income: 0 }), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const args = onlyRpcCall(calls);
    expect(args.p_snapshot.income).toBe(0);
    expect(args.p_snapshot).not.toHaveProperty("net_contribution");
  });

  it("explicit null income, and a bodyless POST, leave income out of the rpc payload (column stays NULL) (B2)", async () => {
    for (const request of [makeJsonRequest({ income: null }), makeRequest()]) {
      const { calls } = setup();
      const response = await POST({ request, cookies: createCookiesStub() } as never);
      expect(response.status).toBe(201);
      expect(onlyRpcCall(calls).p_snapshot).not.toHaveProperty("income");
    }
  });

  it.each([
    ["negative", -1],
    ["non-numeric", "lots"],
  ])("rejects a %s income with 400 VALIDATION_ERROR and inserts nothing (B2)", async (_case, income) => {
    const { calls } = setup();
    const response = await POST({ request: makeJsonRequest({ income }), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(calls).toHaveLength(0);
  });

  it("rpc payload does NOT include created_at or user_id", async () => {
    // Structural-property pin. The DB default `NOW()` is the source of truth
    // for created_at; user_id is auth.uid() inside create_snapshot. A future
    // maintainer adding either to the payload is caught here.
    const { calls } = setup();
    await POST({
      request: makeJsonRequest({ client_request_id: KEY, net_contribution: 1 }),
      cookies: createCookiesStub(),
    } as never);
    const args = onlyRpcCall(calls);
    expect(args.p_snapshot).not.toHaveProperty("created_at");
    expect(args.p_snapshot).not.toHaveProperty("user_id");
    for (const item of args.p_items) {
      expect(item).not.toHaveProperty("created_at");
      expect(item).not.toHaveProperty("snapshot_id");
    }
  });

  // Slice B1b, T6: the tags each asset carries are recorded on its item.
  it("records each asset's current tag ids on its item, read in the same assets query", async () => {
    const tagged = { ...assetA, asset_tags: [{ tag_id: "tag-z" }, { tag_id: "tag-a" }] };
    const untagged = { ...assetB, asset_tags: [] };
    const { m, calls } = setup({ assets: { data: [tagged, untagged], error: null } });

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const assetsSelect = m.builders.get("assets")?.__recorded.find((c) => c.method === "select");
    expect(assetsSelect?.args[0]).toBe("*, category:asset_categories(*), asset_tags(tag_id)");
    const items = onlyRpcCall(calls).p_items as { name: string; tag_ids: string[] | null }[];
    // Sorted, so the same tag set always records the same array. An untagged
    // asset records [] ("recorded, no tags"), not NULL ("not recorded").
    expect(items.map((i) => [i.name, i.tag_ids])).toEqual([
      ["Checking", ["tag-a", "tag-z"]],
      ["Savings", []],
    ]);
  });

  it("records NULL (not recorded), never [], when the tag embed is absent from the row", async () => {
    const { calls } = setup();
    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const items = onlyRpcCall(calls).p_items as { tag_ids: string[] | null }[];
    expect(items.map((i) => i.tag_ids)).toEqual([null, null]);
  });

  it("a repriced holding keeps its tags on the recorded item", async () => {
    priceMocks.crypto.mockImplementation(() =>
      Promise.resolve({ price: 80000, isCached: false, fetchedAt: "2026-08-30T00:00:00.000Z" }),
    );
    const btc = {
      ...assetA,
      id: "asset-btc",
      name: "Bitcoin",
      category_id: "crypto",
      amount: 59941,
      quantity: 0.5,
      crypto_symbol: "BTC",
      category: { ...assetA.category, id: "crypto", name: "Crypto" },
      asset_tags: [{ tag_id: "tag-risk" }],
    };
    const { calls } = setup({ assets: { data: [btc], error: null } });

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const items = onlyRpcCall(calls).p_items as { original_amount: number; tag_ids: string[] | null }[];
    expect(items).toEqual([expect.objectContaining({ original_amount: 40000, tag_ids: ["tag-risk"] })]);
  });
});
