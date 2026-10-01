import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { TablesInsert } from "@/lib/database.types";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

function jsonError(code: string, message: string, status: number, context?: unknown): Response {
  const error = context === undefined ? { code, message } : { code, message, context };
  return new Response(JSON.stringify({ error } satisfies ErrorShape), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Ids are interpolated into the delete-missing PostgREST `in` filter, so they
// must be UUIDs, not just strings (same reason as allocation-targets).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBody(body: unknown): { tagIds: string[] } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be an object with tag_ids" };
  }
  const { tag_ids } = body as Record<string, unknown>;
  if (!Array.isArray(tag_ids)) {
    return { error: "tag_ids must be an array of tag ids" };
  }
  const seen = new Set<string>();
  for (const id of tag_ids) {
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return { error: "Each tag id must be a valid UUID" };
    }
    if (seen.has(id)) {
      return { error: `Duplicate tag id in payload: ${id}` };
    }
    seen.add(id);
  }
  return { tagIds: [...seen] };
}

// PUT /api/assets/:id/tags — replace one asset's tag set. Body: { tag_ids }.
//
// A foreign key is checked without RLS, so a forged id could otherwise link the
// caller's asset to another user's tag (or the reverse). Both sides are
// therefore verified as the caller's before any write: an asset or a tag that
// is not theirs is a 404, and nothing is written.
//
// Save = upsert-then-delete-missing, the allocation-targets pattern: the upsert
// first, so a change never transiently empties the set, then the asset's links
// to tags absent from the payload are deleted. An empty array clears the set.
export const PUT: APIRoute = async ({ request, cookies, params }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return jsonError("UNAUTHORIZED", "Not authenticated", 401);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("UNAUTHORIZED", "Not authenticated", 401);
  }

  const assetId = params.id;
  if (typeof assetId !== "string" || !UUID_RE.test(assetId)) {
    return jsonError("VALIDATION_ERROR", "Invalid asset id", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  const parsed = parseBody(body);
  if ("error" in parsed) {
    return jsonError("VALIDATION_ERROR", parsed.error, 400);
  }
  const { tagIds } = parsed;

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("id")
    .eq("id", assetId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (assetError) {
    return jsonError("FETCH_FAILED", assetError.message, 500);
  }
  if (!asset) {
    return jsonError("NOT_FOUND", "Asset not found", 404);
  }

  if (tagIds.length > 0) {
    const { data: owned, error: tagsError } = await supabase
      .from("tags")
      .select("id")
      .eq("user_id", user.id)
      .in("id", tagIds);
    if (tagsError) {
      return jsonError("FETCH_FAILED", tagsError.message, 500);
    }
    const ownedIds = new Set((owned as { id: string }[]).map((t) => t.id));
    if (tagIds.some((id) => !ownedIds.has(id))) {
      return jsonError("NOT_FOUND", "Tag not found", 404);
    }

    const rows: TablesInsert<"asset_tags">[] = tagIds.map((tagId) => ({
      asset_id: assetId,
      tag_id: tagId,
      user_id: user.id,
    }));
    const { error: upsertError } = await supabase
      .from("asset_tags")
      .upsert(rows, { onConflict: "asset_id,tag_id", ignoreDuplicates: true });
    if (upsertError) {
      return jsonError("UPDATE_FAILED", upsertError.message, 500);
    }
  }

  let clear = supabase.from("asset_tags").delete().eq("asset_id", assetId).eq("user_id", user.id);
  if (tagIds.length > 0) clear = clear.not("tag_id", "in", `(${tagIds.join(",")})`);
  const { error: deleteError } = await clear;
  if (deleteError) {
    return jsonError("UPDATE_FAILED", deleteError.message, 500);
  }

  return new Response(JSON.stringify({ data: { asset_id: assetId, tag_ids: tagIds } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
