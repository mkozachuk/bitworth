import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub, findCall } from "@/test-utils/supabase-mock";

// PUT /api/assets/:id/tags replaces one asset's tag set. A foreign key is
// checked without RLS, so the route itself must refuse to link anything that is
// not the caller's: another user's asset, or another user's tag, is a 404 and
// NOTHING is written to asset_tags.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { PUT } from "@/pages/api/assets/[id]/tags";

const userA = "user-A";
const assetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tag1 = "11111111-1111-4111-8111-111111111111";
const tag2 = "22222222-2222-4222-8222-222222222222";
const foreignTag = "99999999-9999-4999-8999-999999999999";

function putRequest(body: unknown): Request {
  return new Request(`http://localhost/api/assets/${assetId}/tags`, {
    method: "PUT",
    headers: { Cookie: "sb-access-token=fake", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function mockWith(opts: { asset?: unknown; tags?: unknown; links?: { data: unknown; error: unknown }[] }) {
  const m = createSupabaseMock({
    userId: userA,
    tableResults: {
      assets: { data: opts.asset === undefined ? { id: assetId } : opts.asset, error: null },
      tags: { data: opts.tags ?? [], error: null },
    },
    tableResultQueues: { asset_tags: opts.links ?? [] },
  });
  mocks.factory = () => m;
  return m;
}

function linkWrites(m: ReturnType<typeof createSupabaseMock>) {
  return m.builders.get("asset_tags")?.__recorded ?? [];
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

async function put(body: unknown, id = assetId): Promise<Response> {
  return PUT({ request: putRequest(body), cookies: createCookiesStub(), params: { id } } as never);
}

describe("PUT /api/assets/:id/tags", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.factory = () => createSupabaseMock({ userId: null });
    const response = await put({ tag_ids: [] });
    expect(response.status).toBe(401);
  });

  it("verifies the asset and the tags as the caller's, upserts the set, then deletes links not in it", async () => {
    const m = mockWith({ tags: [{ id: tag1 }, { id: tag2 }] });

    const response = await put({ tag_ids: [tag1, tag2] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { asset_id: assetId, tag_ids: [tag1, tag2] } });

    const assetChecks = m.builders.get("assets")?.__recorded ?? [];
    expect(findCall(assetChecks, "eq", ["id", assetId])).toBeDefined();
    expect(findCall(assetChecks, "eq", ["user_id", userA])).toBeDefined();
    const tagChecks = m.builders.get("tags")?.__recorded ?? [];
    expect(findCall(tagChecks, "eq", ["user_id", userA])).toBeDefined();
    expect(findCall(tagChecks, "in", ["id", [tag1, tag2]])).toBeDefined();

    const writes = linkWrites(m);
    expect(writes.map((c) => c.method)).toEqual(["upsert", "delete", "eq", "eq", "not"]);
    expect(writes[0].args).toEqual([
      [
        { asset_id: assetId, tag_id: tag1, user_id: userA },
        { asset_id: assetId, tag_id: tag2, user_id: userA },
      ],
      { onConflict: "asset_id,tag_id", ignoreDuplicates: true },
    ]);
    expect(writes.slice(2).map((c) => c.args)).toEqual([
      ["asset_id", assetId],
      ["user_id", userA],
      ["tag_id", "in", `(${tag1},${tag2})`],
    ]);
  });

  it("an empty set clears the asset's links and reads no tags", async () => {
    const m = mockWith({});
    const response = await put({ tag_ids: [] });
    expect(response.status).toBe(200);
    expect(m.builders.get("tags")).toBeUndefined();
    expect(linkWrites(m).map((c) => c.method)).toEqual(["delete", "eq", "eq"]);
  });

  it("returns 404 for another user's asset, and writes nothing", async () => {
    // The asset lookup is scoped to the caller, so a foreign asset id finds nothing.
    const m = mockWith({ asset: null, tags: [{ id: tag1 }] });
    const response = await put({ tag_ids: [tag1] });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({ code: "NOT_FOUND", message: "Asset not found" });
    expect(linkWrites(m)).toEqual([]);
  });

  it("returns 404 when any tag is another user's, and writes nothing", async () => {
    // Only tag1 comes back from the caller-scoped lookup; foreignTag is not theirs.
    const m = mockWith({ tags: [{ id: tag1 }] });
    const response = await put({ tag_ids: [tag1, foreignTag] });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({ code: "NOT_FOUND", message: "Tag not found" });
    expect(linkWrites(m)).toEqual([]);
  });

  it.each([
    ["a missing tag_ids", {}, "tag_ids must be an array of tag ids"],
    ["a non-array tag_ids", { tag_ids: tag1 }, "tag_ids must be an array of tag ids"],
    ["a non-UUID tag id", { tag_ids: ["etf"] }, "Each tag id must be a valid UUID"],
    ["a duplicate tag id", { tag_ids: [tag1, tag1] }, `Duplicate tag id in payload: ${tag1}`],
  ])("returns 400 for %s, without touching the database", async (_label, body, message) => {
    const m = mockWith({ tags: [{ id: tag1 }] });
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({ code: "VALIDATION_ERROR", message });
    expect(m.recorded).toEqual([]);
  });

  it("returns 400 for a malformed asset id", async () => {
    mockWith({});
    const response = await put({ tag_ids: [] }, "not-a-uuid");
    expect(response.status).toBe(400);
  });

  it("returns 500 UPDATE_FAILED when the upsert fails, and does not delete", async () => {
    const m = mockWith({ tags: [{ id: tag1 }], links: [{ data: null, error: { message: "boom" } }] });
    const response = await put({ tag_ids: [tag1] });
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toEqual({ code: "UPDATE_FAILED", message: "boom" });
    expect(linkWrites(m).map((c) => c.method)).toEqual(["upsert"]);
  });
});
