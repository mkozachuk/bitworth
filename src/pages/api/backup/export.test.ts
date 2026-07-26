import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// /api/backup/export must satisfy the project API-auth contract (401 when
// unauthenticated) and pin the export-specific shape: a 200 JSON attachment
// (first `Content-Disposition` in the repo) whose body is a serialized
// `BackupEnvelope` scoped to the caller. `snapshot_items` has no `user_id`, so
// the test also pins that it is fetched via `.in("snapshot_id", <user's ids>)`.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { GET } from "@/pages/api/backup/export";

const userA = "user-A";

const prefsRow = {
  user_id: userA,
  display_currency: "USD",
  theme: "dark",
  fire_annual_expenses: null,
  fire_annual_income: null,
  fire_barista_income: null,
  fire_current_age: null,
  fire_expected_return: null,
  fire_inflation_rate: null,
  fire_safe_withdrawal_rate: null,
  fire_starting_principal_override: null,
  fire_traditional_retirement_age: null,
  show_fire_dashboard: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const assetRow = {
  id: "asset-a",
  user_id: userA,
  category_id: "cash",
  name: "Checking",
  amount: 500,
  currency: "USD",
  crypto_symbol: null,
  notes: null,
  quantity: null,
  show_on_chart: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const snapshotRow = {
  id: "snap-1",
  user_id: userA,
  total_net_worth: 500,
  display_currency: "USD",
  base_currency: "USD",
  source: "manual",
  note: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

const snapshotItemRow = {
  id: "item-1",
  snapshot_id: "snap-1",
  category_id: "cash",
  name: "Checking",
  original_amount: 500,
  original_currency: "USD",
  converted_amount: 500,
  display_currency: "USD",
  display_order: 0,
  exchange_rate_usd: 1,
  created_at: "2026-01-01T00:00:00.000Z",
};

const goalRow = {
  id: "goal-1",
  user_id: userA,
  name: "Reach 1M",
  kind: "net_worth",
  category_id: null,
  target_amount: 1000000,
  target_currency: "USD",
  target_date: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function populatedMock() {
  return createSupabaseMock({
    userId: userA,
    tableResults: {
      user_preferences: { data: [prefsRow], error: null },
      assets: { data: [assetRow], error: null },
      snapshots: { data: [snapshotRow], error: null },
      snapshot_items: { data: [snapshotItemRow], error: null },
      goals: { data: [goalRow], error: null },
    },
  });
}

function makeRequest(): Request {
  return new Request("http://localhost/api/backup/export", {
    headers: { Cookie: "sb-access-token=fake" },
  });
}

describe("GET /api/backup/export", () => {
  it("returns 401 when unauthenticated", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const request = new Request("http://localhost/api/backup/export");
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("calls supabase.auth.getUser()", async () => {
    const m = populatedMock();
    const spy = vi.spyOn(m.client.auth, "getUser");
    mocks.factory = () => m;

    await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(spy).toHaveBeenCalled();
  });

  it("returns 200 with a Content-Disposition attachment header when authed", async () => {
    const m = populatedMock();
    mocks.factory = () => m;

    const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="\d{4}-\d{2}-\d{2}-bitworth-export\.json"$/,
    );
  });

  it("scopes each user-owned table to the caller and snapshot_items via snapshot ids", async () => {
    const m = populatedMock();
    mocks.factory = () => m;

    await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);

    expect(findCall(m.builders.get("user_preferences")?.__recorded ?? [], "eq", ["user_id", userA])).toBeDefined();
    expect(findCall(m.builders.get("assets")?.__recorded ?? [], "eq", ["user_id", userA])).toBeDefined();
    expect(findCall(m.builders.get("snapshots")?.__recorded ?? [], "eq", ["user_id", userA])).toBeDefined();
    expect(findCall(m.builders.get("goals")?.__recorded ?? [], "eq", ["user_id", userA])).toBeDefined();
    expect(findCall(m.recorded, "in", ["snapshot_id", ["snap-1"]])).toBeDefined();
  });

  it("returns a serialized envelope with all five tables populated", async () => {
    const m = populatedMock();
    mocks.factory = () => m;

    const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    const body = (await response.json()) as {
      app: string;
      schemaVersion: number;
      exportedAt: string;
      data: Record<string, unknown[]>;
    };
    expect(body.app).toBe("bitworth");
    expect(body.schemaVersion).toBe(2);
    expect(typeof body.exportedAt).toBe("string");
    expect(body.data.user_preferences).toHaveLength(1);
    expect(body.data.assets).toHaveLength(1);
    expect(body.data.snapshots).toHaveLength(1);
    expect(body.data.snapshot_items).toHaveLength(1);
    expect(body.data.goals).toHaveLength(1);
  });

  it("does not fetch snapshot_items when the user has no snapshots", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: {
        user_preferences: { data: [prefsRow], error: null },
        assets: { data: [], error: null },
        snapshots: { data: [], error: null },
        goals: { data: [], error: null },
      },
    });
    mocks.factory = () => m;

    const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    expect(m.builders.get("snapshot_items")).toBeUndefined();
    const body = (await response.json()) as { data: Record<string, unknown[]> };
    expect(body.data.snapshot_items).toHaveLength(0);
  });

  it("returns 500 FETCH_FAILED when a table fetch errors", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: {
        user_preferences: { data: [prefsRow], error: null },
        assets: { data: null, error: { message: "boom" } },
        snapshots: { data: [], error: null },
        goals: { data: [], error: null },
      },
    });
    mocks.factory = () => m;

    const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FETCH_FAILED");
  });

  it("returns 500 FETCH_FAILED when the goals fetch errors", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: {
        user_preferences: { data: [prefsRow], error: null },
        assets: { data: [assetRow], error: null },
        snapshots: { data: [], error: null },
        goals: { data: null, error: { message: "goals boom" } },
      },
    });
    mocks.factory = () => m;

    const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FETCH_FAILED");
    expect(body.error.message).toBe("goals boom");
  });
});
