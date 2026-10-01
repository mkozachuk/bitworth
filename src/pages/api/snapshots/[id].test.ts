import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// PATCH /api/snapshots/:id sets/corrects net_contribution on one snapshot
// (backfill). The write-scope defense is the `.eq("user_id", user.id)` filter
// alongside RLS (lessons.md §"RLS USING-only is not enough"); the update
// payload must never carry user_id. A finite number sets the value; explicit
// `null` clears it; a missing id is a 400 MISSING_ID.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { PATCH } from "@/pages/api/snapshots/[id]";

const userA = "user-A";
const snapshotId = "snap-1";
const updatedSnapshot = {
  id: snapshotId,
  user_id: userA,
  total_net_worth: 1500,
  display_currency: "USD",
  base_currency: "USD",
  source: "manual",
  note: null,
  net_contribution: 500,
  created_at: "2026-01-01T00:00:00.000Z",
};

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost/api/snapshots/${snapshotId}`, {
    method: "PATCH",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updatePayload(m: ReturnType<typeof createSupabaseMock>): Record<string, unknown> {
  const snapshotsBuilder = m.builders.get("snapshots");
  const updateCall = snapshotsBuilder?.__recorded.find((c) => c.method === "update");
  expect(updateCall).toBeDefined();
  return updateCall?.args[0] as Record<string, unknown>;
}

describe("PATCH /api/snapshots/:id", () => {
  it("updates net_contribution scoped to the user (eq id + eq user_id, no user_id in payload)", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { snapshots: { data: updatedSnapshot, error: null } },
    });
    mocks.factory = () => m;

    const response = await PATCH({
      params: { id: snapshotId },
      request: makeRequest({ net_contribution: 500 }),
      cookies: createCookiesStub(),
    } as never);

    expect(response.status).toBe(200);
    expect(findCall(m.recorded, "eq", ["id", snapshotId])).toBeDefined();
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();

    const payload = updatePayload(m);
    expect(payload.net_contribution).toBe(500);
    expect(payload).not.toHaveProperty("user_id");
  });

  it("clears net_contribution when given explicit null", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { snapshots: { data: { ...updatedSnapshot, net_contribution: null }, error: null } },
    });
    mocks.factory = () => m;

    const response = await PATCH({
      params: { id: snapshotId },
      request: makeRequest({ net_contribution: null }),
      cookies: createCookiesStub(),
    } as never);

    expect(response.status).toBe(200);
    const payload = updatePayload(m);
    expect(payload).toHaveProperty("net_contribution", null);
  });

  it("persists a negative net_contribution (withdrawal)", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { snapshots: { data: { ...updatedSnapshot, net_contribution: -200 }, error: null } },
    });
    mocks.factory = () => m;

    const response = await PATCH({
      params: { id: snapshotId },
      request: makeRequest({ net_contribution: -200 }),
      cookies: createCookiesStub(),
    } as never);

    expect(response.status).toBe(200);
    expect(updatePayload(m).net_contribution).toBe(-200);
  });

  it("returns 400 MISSING_ID when id param is absent", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const response = await PATCH({
      params: {},
      request: makeRequest({ net_contribution: 500 }),
      cookies: createCookiesStub(),
    } as never);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MISSING_ID");
  });

  it("returns 400 VALIDATION_ERROR for a non-numeric net_contribution", async () => {
    const m = createSupabaseMock({ userId: userA });
    mocks.factory = () => m;

    const response = await PATCH({
      params: { id: snapshotId },
      request: makeRequest({ net_contribution: "lots" }),
      cookies: createCookiesStub(),
    } as never);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 NOT_FOUND when no row matches the user+id scope", async () => {
    const m = createSupabaseMock({
      userId: userA,
      tableResults: { snapshots: { data: null, error: null } },
    });
    mocks.factory = () => m;

    const response = await PATCH({
      params: { id: snapshotId },
      request: makeRequest({ net_contribution: 500 }),
      cookies: createCookiesStub(),
    } as never);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 401 when unauthenticated", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const response = await PATCH({
      params: { id: snapshotId },
      request: makeRequest({ net_contribution: 500 }),
      cookies: createCookiesStub(),
    } as never);

    expect(response.status).toBe(401);
  });
});

// B2 (R2): the route takes net_contribution, income or both, and writes only the
// keys present, so editing one never clears the other.
describe("PATCH /api/snapshots/:id — income (B2)", () => {
  const userB = "user-B";

  async function patch(body: unknown, m: ReturnType<typeof createSupabaseMock>): Promise<Response> {
    mocks.factory = () => m;
    return PATCH({ params: { id: snapshotId }, request: makeRequest(body), cookies: createCookiesStub() } as never);
  }

  function ok(): ReturnType<typeof createSupabaseMock> {
    return createSupabaseMock({
      userId: userA,
      tableResults: { snapshots: { data: { ...updatedSnapshot, income: 4000 }, error: null } },
    });
  }

  it("shape 1, net_contribution only: writes it and leaves income out of the payload", async () => {
    const m = ok();
    const response = await patch({ net_contribution: 300 }, m);
    expect(response.status).toBe(200);
    expect(updatePayload(m)).toEqual({ net_contribution: 300 });
  });

  it("shape 2, income only: writes it and leaves net_contribution out of the payload", async () => {
    const m = ok();
    const response = await patch({ income: 4000 }, m);
    expect(response.status).toBe(200);
    expect(updatePayload(m)).toEqual({ income: 4000 });
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
  });

  it("shape 3, both: writes both, scoped to the user, never user_id", async () => {
    const m = ok();
    const response = await patch({ net_contribution: -150, income: 3200.5 }, m);
    expect(response.status).toBe(200);
    expect(updatePayload(m)).toEqual({ net_contribution: -150, income: 3200.5 });
    expect(findCall(m.recorded, "eq", ["id", snapshotId])).toBeDefined();
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
  });

  it("explicit null clears income (and only income)", async () => {
    const m = ok();
    const response = await patch({ income: null }, m);
    expect(response.status).toBe(200);
    expect(updatePayload(m)).toEqual({ income: null });
  });

  it("income 0 is accepted (a known zero, which the rate then treats as unknown)", async () => {
    const m = ok();
    expect((await patch({ income: 0 }, m)).status).toBe(200);
    expect(updatePayload(m)).toEqual({ income: 0 });
  });

  it.each([
    ["an empty object", {}],
    ["an unrelated key only", { note: "x" }],
    ["an array", [1]],
    ["a negative income", { income: -1 }],
    ["a string income", { income: "lots" }],
    ["a valid contribution with an invalid income", { net_contribution: 100, income: -5 }],
    ["an invalid contribution with a valid income", { net_contribution: "x", income: 5 }],
  ])("400 VALIDATION_ERROR for %s, and nothing is written", async (_case, body) => {
    const m = createSupabaseMock({ userId: userA });
    const response = await patch(body, m);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(m.builders.get("snapshots")?.__recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("a foreign snapshot (another user's id) is a 404, never another user's row", async () => {
    // Caller is user B; the id belongs to user A. The user_id filter matches no
    // row, so the update returns no data.
    const m = createSupabaseMock({ userId: userB, tableResults: { snapshots: { data: null, error: null } } });
    const response = await patch({ income: 4000 }, m);
    expect(response.status).toBe(404);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
    expect(findCall(m.recorded, "eq", ["user_id", userB])).toBeDefined();
    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeUndefined();
    expect(updatePayload(m)).not.toHaveProperty("user_id");
  });
});
