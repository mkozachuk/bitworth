import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall, type RecordedCall } from "@/test-utils/supabase-mock";

// P3: POST /api/assets/reprice. Mocked at the request boundary (Supabase) and
// at the price-module boundary, the same exception reprice.test.ts and the
// snapshot route test make. Fixtures are synthetic.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

const priceMocks = vi.hoisted(() => ({ crypto: vi.fn(), metal: vi.fn() }));
vi.mock("@/lib/crypto-prices", () => ({ getPrice: priceMocks.crypto }));
vi.mock("@/lib/metal-prices", () => ({ getPrice: priceMocks.metal }));

import { POST } from "@/pages/api/assets/reprice";

const userA = "user-A";

const base = { currency: "USD", quantity: null as number | null, crypto_symbol: null, metal_symbol: null };
const cash = { ...base, id: "cash-a", name: "Checking", amount: 500 } as const;
const btc = { ...base, id: "btc-a", name: "Hot wallet", amount: 30000, quantity: 0.5, crypto_symbol: "BTC" };
const gold = { ...base, id: "gold-a", name: "Coins", amount: 4000, quantity: 1, metal_symbol: "XAU" };

function ok(price: number) {
  return Promise.resolve({ price, isCached: false, fetchedAt: "2026-06-15T00:00:00.000Z" });
}

function unavailable() {
  return Promise.resolve({ error: { code: "PRICE_UNAVAILABLE", message: "Could not fetch price" } });
}

/** The caller's rows come back from the first read; every later write succeeds. */
function mockWith(rows: unknown[], userId: string | null = userA) {
  const m = createSupabaseMock({
    userId,
    tableResultQueues: { assets: [{ data: rows, error: null }] },
    tableResults: { assets: { data: null, error: null } },
  });
  mocks.factory = () => m;
  return m;
}

function call() {
  const request = new Request("http://localhost/api/assets/reprice", {
    method: "POST",
    headers: { Cookie: "sb-access-token=fake" },
  });
  return POST({ request, cookies: createCookiesStub() } as never);
}

/** The id each `update` on `assets` was scoped to, in order. */
function updatedIds(records: RecordedCall[]): string[] {
  const ids: string[] = [];
  records.forEach((c, i) => {
    if (c.method !== "update") return;
    const scope = records.slice(i + 1).find((n) => n.method === "eq" && n.args[0] === "id");
    ids.push(String(scope?.args[1]));
  });
  return ids;
}

interface Body {
  data: {
    repriced: { id: string; newAmount: number }[];
    unchanged: { id: string; symbol: string }[];
    failed: { id: string; symbol: string; code: string }[];
  };
}

beforeEach(() => {
  priceMocks.crypto.mockReset();
  priceMocks.metal.mockReset();
});

describe("POST /api/assets/reprice (P3)", () => {
  it("returns 401 when the caller is not authenticated, and touches nothing", async () => {
    const m = mockWith([btc], null);

    const response = await call();

    expect(response.status).toBe(401);
    expect(m.builders.size).toBe(0);
    expect(priceMocks.crypto).not.toHaveBeenCalled();
  });

  it("reads only the caller's rows and writes only the caller's priced rows", async () => {
    priceMocks.crypto.mockImplementation(() => ok(80000));
    priceMocks.metal.mockImplementation(() => ok(4500));
    const m = mockWith([cash, btc, gold]);

    const response = await call();

    expect(response.status).toBe(200);
    const assetCalls = m.builders.get("assets")?.__recorded ?? [];
    // The read is scoped to the caller before anything else happens.
    expect(assetCalls[0].method).toBe("select");
    expect(assetCalls[1]).toEqual({ method: "eq", args: ["user_id", userA] });
    // Writes land on the caller's priced rows only, never on the unpriced one.
    expect(updatedIds(assetCalls).sort()).toEqual(["btc-a", "gold-a"]);
    expect(m.builders.size).toBe(1);
  });

  it("writes amount and currency exactly as the snapshot path does (quantity × price, cents, USD)", async () => {
    priceMocks.crypto.mockImplementation(() => ok(78636.123));
    const m = mockWith([btc]);

    const response = await call();
    const body = (await response.json()) as Body;

    expect(findCall(m.recorded, "update", [{ amount: 39318.06, currency: "USD" }])).toBeDefined();
    expect(body.data.repriced).toEqual([expect.objectContaining({ id: "btc-a", newAmount: 39318.06 })]);
    expect(body.data.failed).toEqual([]);
  });

  it("keeps the stored amount and reports a price-source failure, while repricing the rest", async () => {
    priceMocks.crypto.mockImplementation(unavailable);
    priceMocks.metal.mockImplementation(() => ok(4500));
    const m = mockWith([btc, gold]);

    const response = await call();
    const body = (await response.json()) as Body;

    expect(response.status).toBe(200);
    expect(body.data.failed).toEqual([{ id: "btc-a", name: "Hot wallet", symbol: "BTC", code: "PRICE_UNAVAILABLE" }]);
    expect(body.data.repriced.map((r) => r.id)).toEqual(["gold-a"]);
    // No write of any kind reached the failed row.
    expect(updatedIds(m.builders.get("assets")?.__recorded ?? [])).toEqual(["gold-a"]);
  });

  it("inserts no snapshot: no call reaches snapshots, snapshot_items or any RPC", async () => {
    priceMocks.crypto.mockImplementation(() => ok(80000));
    const m = mockWith([btc, cash]);

    await call();

    expect(m.builders.has("snapshots")).toBe(false);
    expect(m.builders.has("snapshot_items")).toBe(false);
    expect(m.recorded.find((c) => c.method === "insert")).toBeUndefined();
    expect(m.recorded.find((c) => c.method === "rpc")).toBeUndefined();
  });

  it("re-writes a holding whose price has not moved, so its staleness clock restarts", async () => {
    priceMocks.crypto.mockImplementation(() => ok(60000)); // 0.5 × 60000 = 30000, the stored amount
    const m = mockWith([btc]);

    const response = await call();
    const body = (await response.json()) as Body;

    const assetCalls = m.builders.get("assets")?.__recorded ?? [];
    expect(assetCalls.filter((c) => c.method === "update")).toEqual([
      { method: "update", args: [{ amount: 30000, currency: "USD" }] },
    ]);
    expect(findCall(assetCalls, "eq", ["id", "btc-a"])).toBeDefined();
    expect(assetCalls.filter((c) => c.method === "eq" && c.args[0] === "user_id")).toHaveLength(2);
    expect(body.data.unchanged).toEqual([{ id: "btc-a", name: "Hot wallet", symbol: "BTC" }]);
    expect(body.data.repriced).toEqual([]);
  });

  it("reports a failed re-write of an unchanged holding instead of claiming it", async () => {
    priceMocks.crypto.mockImplementation(() => ok(60000));
    const m = createSupabaseMock({
      userId: userA,
      tableResultQueues: {
        assets: [
          { data: [btc], error: null },
          { data: null, error: { code: "42501", message: "permission denied" } },
        ],
      },
    });
    mocks.factory = () => m;

    const body = (await (await call()).json()) as Body;

    expect(body.data.unchanged).toEqual([]);
    expect(body.data.failed).toEqual([{ id: "btc-a", name: "Hot wallet", symbol: "BTC", code: "42501" }]);
  });

  it("does nothing for a caller with no priced holdings", async () => {
    const m = mockWith([cash]);

    const body = (await (await call()).json()) as Body;

    expect(body.data).toEqual({ repriced: [], unchanged: [], failed: [] });
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
    expect(priceMocks.crypto).not.toHaveBeenCalled();
  });

  it("returns 500 FETCH_FAILED when the read fails", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { assets: { data: null, error: { code: "XX000", message: "boom" } } },
    });
    mocks.factory = () => m;

    const response = await call();

    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("FETCH_FAILED");
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });
});
