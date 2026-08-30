import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// /api/snapshots is the only handler exercising Risks #2 AND #3 together:
// the GET filter (cross-tenant) AND the POST atomicity (orphan worst case
// per lessons.md §1) AND the sort order (chart's defensive re-sort is
// load-bearing per research §3). This file ships in two passes: Phase 2
// adds the GET filter assertions, Phase 3 extends with the 6 POST
// scenarios and the sort-order assertions.
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

  it("happy path: 2 assets, both inserts succeed", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: {
        // snapshots: parent insert succeeds (single)
        snapshots: [{ data: parentSnapshot, error: null }],
      },
    });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);

    // The items insert was awaited with a 2-element array
    const itemsInsert = m.recorded.find(
      (c) => c.method === "insert" && m.builders.get("snapshot_items")?.__recorded.includes(c),
    );
    expect(itemsInsert).toBeDefined();
    const items = itemsInsert?.args[0] as unknown[];
    expect(items).toHaveLength(2);
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
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: [assetA, btc], error: null } },
      tableResultQueues: { snapshots: [{ data: parentSnapshot, error: null }] },
    });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { repricing: { repriced: number; failed: unknown[] } };
    expect(body.repricing).toEqual({ repriced: 1, failed: [] });

    // The refreshed amount was written back to the asset row…
    expect(findCall(m.recorded, "update", [{ amount: 40000, currency: "USD" }])).toBeDefined();
    // …and is what the snapshot recorded (500 cash + 40,000 BTC).
    const parentInsert = m.recorded.find(
      (c) => c.method === "insert" && m.builders.get("snapshots")?.__recorded.includes(c),
    );
    expect((parentInsert?.args[0] as { total_net_worth: number }).total_net_worth).toBe(40500);
    const itemsInsert = m.recorded.find(
      (c) => c.method === "insert" && m.builders.get("snapshot_items")?.__recorded.includes(c),
    );
    const items = itemsInsert?.args[0] as { name: string; original_amount: number }[];
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
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: [assetA, gold], error: null } },
      tableResultQueues: { snapshots: [{ data: parentSnapshot, error: null }] },
    });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { repricing: { repriced: number; failed: { symbol: string }[] } };
    expect(body.repricing.repriced).toBe(0);
    expect(body.repricing.failed).toEqual([
      { id: "asset-gold", name: "Gold", symbol: "XAU", code: "PRICE_UNAVAILABLE" },
    ]);

    const parentInsert = m.recorded.find(
      (c) => c.method === "insert" && m.builders.get("snapshots")?.__recorded.includes(c),
    );
    expect((parentInsert?.args[0] as { total_net_worth: number }).total_net_worth).toBe(4553);
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("items insert fails, compensating delete succeeds", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: {
        // snapshots: parent insert succeeds, then compensating delete succeeds
        snapshots: [
          { data: parentSnapshot, error: null },
          { data: null, error: null },
        ],
        // snapshot_items: items insert fails
        snapshot_items: [{ data: null, error: { message: "items fail" } }],
      },
    });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);

    // The compensating delete.eq("id", snapshot.id) was invoked
    const deleteCall = m.recorded.find((c) => c.method === "delete");
    expect(deleteCall).toBeDefined();
    expect(findCall(m.recorded, "eq", ["id", parentSnapshot.id])).toBeDefined();
  });

  it("items insert fails AND compensating delete fails (lesson §1 worst case)", async () => {
    // TODO: replace with a Postgres function or supabase.rpc wrapping both
    // inserts so the lesson §1 worst case is structurally impossible. The
    // test currently pins the orphan-on-failure behavior; once the fix
    // lands, this test should be updated to assert the new (no-orphan)
    // behavior, not removed.
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: {
        snapshots: [
          { data: parentSnapshot, error: null },
          { data: null, error: { message: "compensating delete fails" } },
        ],
        snapshot_items: [{ data: null, error: { message: "items fail" } }],
      },
    });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    // Both fail → handler returns 500 with the itemsError message; the
    // parent row remains in the DB. The test pins this current behavior.
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("items fail");

    // The delete was attempted (it failed, but it was attempted)
    const deleteCall = m.recorded.find((c) => c.method === "delete");
    expect(deleteCall).toBeDefined();
  });

  it("items insert silently no-ops (error: null but no rows)", async () => {
    // The most insidious failure: items insert returns `{error: null}` but
    // writes zero rows. The handler does not enter the compensating-delete
    // branch because it sees no error. The parent row is committed, the
    // items are absent — an orphan by another name.
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: {
        snapshots: [{ data: parentSnapshot, error: null }],
        snapshot_items: [{ data: [], error: null }],
      },
    });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);

    // The compensating-delete branch was NOT entered
    const deleteCall = m.recorded.find((c) => c.method === "delete");
    expect(deleteCall).toBeUndefined();
  });

  it("empty assets: parent row created with total_net_worth: 0", async () => {
    // Pins the current behavior at src/pages/api/snapshots/index.ts:140 —
    // a parent snapshot with `total_net_worth: 0` is still committed when
    // the user has no assets. The chart would render a single zero point.
    // Whether this is desired is a product question; the test pins so a
    // future refactor is observable.
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: [], error: null } },
      tableResultQueues: {
        snapshots: [{ data: { ...parentSnapshot, total_net_worth: 0 }, error: null }],
      },
    });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { total_net_worth: number } };
    expect(body.data.total_net_worth).toBe(0);

    // The snapshot_items builder was never called (no items insert at all)
    const itemsBuilder = m.builders.get("snapshot_items");
    expect(itemsBuilder).toBeUndefined();
  });

  function makeJsonRequest(body: unknown): Request {
    return new Request("http://localhost/api/snapshots", {
      method: "POST",
      headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function snapshotInsertPayload(m: ReturnType<typeof createSupabaseMock>): Record<string, unknown> {
    const snapshotsBuilder = m.builders.get("snapshots");
    const snapshotInsert = snapshotsBuilder?.__recorded.find((c) => c.method === "insert");
    expect(snapshotInsert).toBeDefined();
    return snapshotInsert?.args[0] as Record<string, unknown>;
  }

  it("persists net_contribution: 500 from the body into the insert payload", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: { snapshots: [{ data: parentSnapshot, error: null }] },
    });
    mocks.factory = () => m;

    const response = await POST({
      request: makeJsonRequest({ net_contribution: 500 }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(snapshotInsertPayload(m).net_contribution).toBe(500);
  });

  it("persists a negative net_contribution (-200, a withdrawal)", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: { snapshots: [{ data: parentSnapshot, error: null }] },
    });
    mocks.factory = () => m;

    const response = await POST({
      request: makeJsonRequest({ net_contribution: -200 }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(snapshotInsertPayload(m).net_contribution).toBe(-200);
  });

  it("bodyless POST succeeds (201) with no net_contribution key in the insert payload", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: { snapshots: [{ data: parentSnapshot, error: null }] },
    });
    mocks.factory = () => m;

    const response = await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(201);
    expect(snapshotInsertPayload(m)).not.toHaveProperty("net_contribution");
  });

  it("rejects a non-numeric net_contribution with 400 VALIDATION_ERROR", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: { snapshots: [{ data: parentSnapshot, error: null }] },
    });
    mocks.factory = () => m;

    const response = await POST({
      request: makeJsonRequest({ net_contribution: "lots" }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a NaN net_contribution with 400 VALIDATION_ERROR", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: { snapshots: [{ data: parentSnapshot, error: null }] },
    });
    mocks.factory = () => m;

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
    expect(snapshotInsertPayload(m)).not.toHaveProperty("net_contribution");
  });

  it("treats explicit null net_contribution as no contribution (column stays NULL)", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: { snapshots: [{ data: parentSnapshot, error: null }] },
    });
    mocks.factory = () => m;

    const response = await POST({
      request: makeJsonRequest({ net_contribution: null }),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(201);
    expect(snapshotInsertPayload(m)).not.toHaveProperty("net_contribution");
  });

  it("insert payload does NOT include created_at", async () => {
    // Structural-property pin for the DB-default contract. The handler
    // must never set `created_at` on the insert payload; the DB default
    // `NOW()` is the source of truth. A future maintainer adding a
    // client-derived timestamp is caught here.
    const m = createSupabaseMock({
      userId: userA,
      tableResults: defaultTableResults,
      tableResultQueues: {
        snapshots: [{ data: parentSnapshot, error: null }],
      },
    });
    mocks.factory = () => m;

    await POST({ request: makeRequest(), cookies: createCookiesStub() } as never);

    const snapshotsBuilder = m.builders.get("snapshots");
    const snapshotInsert = snapshotsBuilder?.__recorded.find((c) => c.method === "insert");
    expect(snapshotInsert).toBeDefined();
    const payload = snapshotInsert?.args[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("created_at");
  });
});
