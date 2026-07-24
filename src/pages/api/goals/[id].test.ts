import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";
import type { TableResult } from "@/test-utils/supabase-mock";

// Per-handler coverage for /api/goals/:id. Beyond the validation matrix, three
// properties carry the weight here:
//   1. the double ownership belt — every chain filters .eq("id").eq("user_id"),
//      in that order (risk #2, cross-tenant leak);
//   2. the 404-not-403 convention for a foreign row, which falls out of
//      .maybeSingle() returning no data rather than raising; and
//   3. PATCH coherence checked against the MERGED row, not the payload — the
//      case that would otherwise reach Postgres as a 500 from the CHECK.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { PATCH, DELETE } from "@/pages/api/goals/[id]";

const userA = "user-A";
const goalId = "11111111-1111-4111-8111-111111111111";

const netWorthGoal = { kind: "net_worth", category_id: null };
const categoryGoal = { kind: "category", category_id: "cash" };

const updatedRow = {
  id: goalId,
  name: "Renamed",
  kind: "net_worth",
  category_id: null,
  target_amount: 50000,
  target_currency: "EUR",
  target_date: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/goals/${goalId}`, {
    method: "PATCH",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request(`http://localhost/api/goals/${goalId}`, {
    method: "DELETE",
    headers: { Cookie: "sb-access-token=fake" },
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

// PATCH awaits `goals` twice: first the coherence read, then the update.
function patchMock(existing: TableResult, update: TableResult) {
  const m = createSupabaseMock({ userId: userA, tableResultQueues: { goals: [existing, update] } });
  mocks.factory = () => m;
  return m;
}

// Positions of the recorded .eq calls, used for the filter-ordering assertion.
function eqArgs(m: ReturnType<typeof createSupabaseMock>): unknown[][] {
  return m.recorded.filter((c) => c.method === "eq").map((c) => c.args);
}

describe("PATCH /api/goals/:id", () => {
  it("updates a goal and returns 200", async () => {
    const m = patchMock({ data: netWorthGoal, error: null }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { name: string } };
    expect(body.data.name).toBe("Renamed");
    expect(m.recorded.find((c) => c.method === "update")?.args[0]).toEqual({ name: "Renamed" });
  });

  it("applies only the keys present in a partial payload", async () => {
    const m = patchMock({ data: netWorthGoal, error: null }, { data: updatedRow, error: null });

    await PATCH({
      request: patchRequest({ target_amount: 1234.56 }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(m.recorded.find((c) => c.method === "update")?.args[0]).toEqual({ target_amount: 1234.56 });
  });

  it("filters by both id and user_id, in that order, on the read and the write", async () => {
    const m = patchMock({ data: netWorthGoal, error: null }, { data: updatedRow, error: null });

    await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);

    expect(findCall(m.recorded, "eq", ["user_id", userA])).toBeDefined();
    // Two chains (read + update), each filtering id then user_id.
    expect(eqArgs(m)).toEqual([
      ["id", goalId],
      ["user_id", userA],
      ["id", goalId],
      ["user_id", userA],
    ]);
  });

  it("never selects user_id, so the tenant key cannot leak into a response body", async () => {
    const m = patchMock({ data: netWorthGoal, error: null }, { data: updatedRow, error: null });

    await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    for (const call of m.recorded.filter((c) => c.method === "select")) {
      expect(String(call.args[0])).not.toContain("user_id");
    }
  });

  it("returns 404 NOT_FOUND for another user's goal — never 403", async () => {
    // A foreign row simply does not match .eq("user_id"), so the read comes
    // back empty. 404 is the convention; the route emits no 403 at all.
    const m = patchMock({ data: null, error: null }, { data: null, error: null });

    const response = await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("returns 404 when the update itself matches no row", async () => {
    patchMock({ data: netWorthGoal, error: null }, { data: null, error: null });

    const response = await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
  });

  it("returns 401 UNAUTHORIZED when there is no session", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const response = await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("UNAUTHORIZED");
  });

  it("returns 400 for a non-UUID id", async () => {
    const m = patchMock({ data: netWorthGoal, error: null }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: "not-a-uuid" },
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("returns 400 on a malformed JSON body", async () => {
    patchMock({ data: netWorthGoal, error: null }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest("{not json"),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when the payload carries no updatable field", async () => {
    patchMock({ data: netWorthGoal, error: null }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest({}),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
  });

  const rejections: { title: string; body: Record<string, unknown> }[] = [
    { title: "an empty name", body: { name: "   " } },
    { title: "a name longer than 60 characters", body: { name: "x".repeat(61) } },
    { title: "an unknown kind", body: { kind: "retirement" } },
    { title: "a non-numeric target_amount", body: { target_amount: "50000" } },
    { title: "target_amount: 0", body: { target_amount: 0 } },
    { title: "a negative target_amount", body: { target_amount: -1 } },
    { title: "a target_amount with 3 decimal places", body: { target_amount: 100.123 } },
    { title: "an unsupported target_currency", body: { target_currency: "GBP" } },
    { title: "a non-ISO target_date", body: { target_date: "31/12/2027" } },
    { title: "a calendar-invalid target_date", body: { target_date: "2026-02-31" } },
    { title: "an empty-string category_id", body: { category_id: "  " } },
  ];

  for (const { title, body } of rejections) {
    it(`rejects ${title} with 400 VALIDATION_ERROR`, async () => {
      const m = patchMock({ data: categoryGoal, error: null }, { data: updatedRow, error: null });

      const response = await PATCH({
        request: patchRequest(body),
        cookies: createCookiesStub(),
        params: { id: goalId },
      } as never);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
      expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
    });
  }

  it("rejects patching kind to net_worth while the stored category_id remains", async () => {
    // The payload alone looks valid — it is only incoherent once merged with
    // the stored row. Without the merged check this reaches the DB CHECK as 500.
    const m = patchMock({ data: categoryGoal, error: null }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest({ kind: "net_worth" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("accepts patching kind to net_worth when category_id is cleared in the same payload", async () => {
    const m = patchMock({ data: categoryGoal, error: null }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest({ kind: "net_worth", category_id: null }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(200);
    expect(m.recorded.find((c) => c.method === "update")?.args[0]).toEqual({
      kind: "net_worth",
      category_id: null,
    });
  });

  it("rejects patching kind to category on a stored row with no category_id", async () => {
    const m = patchMock({ data: netWorthGoal, error: null }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest({ kind: "category" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("rejects clearing category_id on a stored category goal", async () => {
    const m = patchMock({ data: categoryGoal, error: null }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest({ category_id: null }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(m.recorded.find((c) => c.method === "update")).toBeUndefined();
  });

  it("returns 500 FETCH_FAILED when the coherence read errors", async () => {
    patchMock({ data: null, error: { message: "read boom" } }, { data: updatedRow, error: null });

    const response = await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("FETCH_FAILED");
  });

  it("returns 500 UPDATE_FAILED when the update errors", async () => {
    patchMock({ data: netWorthGoal, error: null }, { data: null, error: { message: "update boom" } });

    const response = await PATCH({
      request: patchRequest({ name: "Renamed" }),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("UPDATE_FAILED");
  });
});

describe("DELETE /api/goals/:id", () => {
  function deleteMock(result: TableResult) {
    const m = createSupabaseMock({ userId: userA, tableResults: { goals: result } });
    mocks.factory = () => m;
    return m;
  }

  it("deletes a goal and returns 200 with its id", async () => {
    deleteMock({ data: { id: goalId }, error: null });

    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string } };
    expect(body.data).toEqual({ id: goalId });
  });

  it("filters by both id and user_id, in that order", async () => {
    const m = deleteMock({ data: { id: goalId }, error: null });

    await DELETE({ request: deleteRequest(), cookies: createCookiesStub(), params: { id: goalId } } as never);
    expect(eqArgs(m)).toEqual([
      ["id", goalId],
      ["user_id", userA],
    ]);
  });

  it("returns 404 NOT_FOUND for another user's goal — never 403", async () => {
    deleteMock({ data: null, error: null });

    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
  });

  it("returns 401 UNAUTHORIZED when there is no session", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("UNAUTHORIZED");
  });

  it("returns 400 for a non-UUID id", async () => {
    const m = deleteMock({ data: { id: goalId }, error: null });

    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: "not-a-uuid" },
    } as never);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(m.recorded.find((c) => c.method === "delete")).toBeUndefined();
  });

  it("returns 500 DELETE_FAILED when the delete errors", async () => {
    deleteMock({ data: null, error: { message: "delete boom" } });

    const response = await DELETE({
      request: deleteRequest(),
      cookies: createCookiesStub(),
      params: { id: goalId },
    } as never);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("DELETE_FAILED");
  });
});
