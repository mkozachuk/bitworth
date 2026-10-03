import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// GET /api/snapshots/export.csv: 401 without a user, the caller's rows only
// (`user_id` filter on snapshots and tags, snapshot_items through the caller's
// snapshot ids), CSV attachment headers, and a body that starts with a BOM.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { GET } from "@/pages/api/snapshots/export.csv";

const userA = "user-A";

const snapshotRow = {
  id: "snap-1",
  created_at: "2026-01-31T10:00:00+00:00",
  total_net_worth: 1500,
  display_currency: "USD",
  net_contribution: 200,
  income: null,
};

const itemRow = {
  snapshot_id: "snap-1",
  name: "Checking",
  category_id: "cash",
  original_amount: 1500,
  original_currency: "USD",
  converted_amount: 1500,
  display_currency: "USD",
  display_order: 0,
  tag_ids: ["tag-1"],
};

function populatedMock() {
  return createSupabaseMock({
    userId: userA,
    tableResults: {
      snapshots: { data: [snapshotRow], error: null },
      snapshot_items: { data: [itemRow], error: null },
      tags: { data: [{ id: "tag-1", name: "Core" }], error: null },
      asset_categories: { data: [{ id: "cash", name: "Cash" }], error: null },
    },
  });
}

function makeRequest(): Request {
  return new Request("http://localhost/api/snapshots/export.csv", {
    headers: { Cookie: "sb-access-token=fake" },
  });
}

describe("GET /api/snapshots/export.csv", () => {
  it("returns 401 when unauthenticated", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const response = await GET({
      request: new Request("http://localhost/api/snapshots/export.csv"),
      cookies: createCookiesStub(),
    } as never);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(m.builders.size).toBe(0);
  });

  it("returns a UTF-8 CSV attachment named bitworth-snapshots-YYYY-MM-DD.csv", async () => {
    mocks.factory = populatedMock;

    const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="bitworth-snapshots-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
  });

  it("scopes snapshots and tags to the caller and items to the caller's snapshot ids", async () => {
    const m = populatedMock();
    mocks.factory = () => m;

    await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);

    expect(findCall(m.builders.get("snapshots")?.__recorded ?? [], "eq", ["user_id", userA])).toBeDefined();
    expect(findCall(m.builders.get("tags")?.__recorded ?? [], "eq", ["user_id", userA])).toBeDefined();
    expect(
      findCall(m.builders.get("snapshot_items")?.__recorded ?? [], "in", ["snapshot_id", ["snap-1"]]),
    ).toBeDefined();
  });

  it("serialises the caller's rows with a BOM, header and resolved names", async () => {
    mocks.factory = populatedMock;

    const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.slice(3));
    const lines = text.split("\r\n");
    expect(lines[0]).toBe(
      "snapshot_date,snapshot_id,total_net_worth,snapshot_currency,net_contribution,income,item_name,category,original_amount,original_currency,converted_amount,display_currency,tags",
    );
    expect(lines[1]).toBe("2026-01-31T10:00:00.000Z,snap-1,1500,USD,200,,Checking,Cash,1500,USD,1500,USD,Core");
    expect(lines).toHaveLength(3);
  });

  it("returns the header only and skips snapshot_items when there is no history", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: {
        snapshots: { data: [], error: null },
        tags: { data: [], error: null },
        asset_categories: { data: [], error: null },
      },
    });
    mocks.factory = () => m;

    const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    expect(m.builders.get("snapshot_items")).toBeUndefined();
    const text = await response.text();
    expect(
      text
        .replace(/^\uFEFF/, "")
        .split("\r\n")
        .filter(Boolean),
    ).toHaveLength(1);
  });

  it.each(["snapshots", "tags", "asset_categories", "snapshot_items"])(
    "returns 500 FETCH_FAILED when the %s fetch errors",
    async (table) => {
      const m = createSupabaseMock({
        userId: userA,
        tableResults: {
          snapshots: { data: [snapshotRow], error: null },
          snapshot_items: { data: [itemRow], error: null },
          tags: { data: [], error: null },
          asset_categories: { data: [], error: null },
          [table]: { data: null, error: { message: `${table} boom` } },
        },
      });
      mocks.factory = () => m;

      const response = await GET({ request: makeRequest(), cookies: createCookiesStub() } as never);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error).toEqual({ code: "FETCH_FAILED", message: `${table} boom` });
    },
  );
});
