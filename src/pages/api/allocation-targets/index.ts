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

// GET /api/allocation-targets — return this user's saved target percentages.
// RLS isolates rows per user; the explicit .eq("user_id", user.id) is the
// handler-level belt that pairs with the policy's belt-and-suspenders.
export const GET: APIRoute = async ({ request, cookies }) => {
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

  const { data, error } = await supabase.from("allocation_targets").select("*").eq("user_id", user.id);

  if (error) {
    return jsonError("FETCH_FAILED", error.message, 500);
  }

  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};

// One submitted target row, after validation. `target_pct` is on a 0–100 scale
// (the storage scale matches the math layer — no ×100/÷100 at the DB boundary).
interface TargetRow {
  asset_id: string;
  target_pct: number;
}

// asset_id / card_id must be a UUID, not just any string: ids are interpolated
// into the delete-missing PostgREST `in` filter, so a non-UUID value would be
// both an invalid FK and a filter-syntax hazard. Validate so the filter is
// self-defending regardless of statement order.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate the raw body into the target card id plus the submitted target rows,
// or an error message describing the first failing field. Hand-rolled (no Zod
// anywhere — mirrors the asset/preference handlers). Bounds mirror the
// migration's CHECK constraint. Body shape: { card_id, targets: [{...}] }.
function parseBody(body: unknown): { cardId: string; rows: TargetRow[] } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Request body must be an object with card_id and targets" };
  }
  const { card_id, targets } = body as Record<string, unknown>;

  if (typeof card_id !== "string" || !UUID_RE.test(card_id)) {
    return { error: "card_id must be a valid UUID" };
  }
  if (!Array.isArray(targets)) {
    return { error: "targets must be an array of { asset_id, target_pct }" };
  }

  const rows: TargetRow[] = [];
  const seen = new Set<string>();

  for (const raw of targets) {
    if (typeof raw !== "object" || raw === null) {
      return { error: "Each target must be an object with asset_id and target_pct" };
    }
    const { asset_id, target_pct } = raw as Record<string, unknown>;

    if (typeof asset_id !== "string" || asset_id.length === 0) {
      return { error: "asset_id must be a non-empty string" };
    }
    if (!UUID_RE.test(asset_id)) {
      return { error: "asset_id must be a valid UUID" };
    }
    if (typeof target_pct !== "number" || !Number.isFinite(target_pct)) {
      return { error: "target_pct must be a finite number" };
    }
    if (target_pct < 0 || target_pct > 100) {
      return { error: "target_pct must be between 0 and 100" };
    }
    if (seen.has(asset_id)) {
      return { error: `Duplicate asset_id in payload: ${asset_id}` };
    }
    seen.add(asset_id);

    rows.push({ asset_id, target_pct });
  }

  return { cardId: card_id, rows };
}

// PUT /api/allocation-targets — replace ONE card's target set with the submitted
// targets. Body: { card_id, targets: [{ asset_id, target_pct }] }. Save =
// upsert-then-delete-missing (two RLS-filtered statements, order-safe but not
// jointly transactional): upsert first so a percentage-only change never
// transiently empties the card, then delete this card's rows for assets absent
// from the payload. An empty `targets` array clears that card.
export const PUT: APIRoute = async ({ request, cookies }) => {
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
  const { cardId, rows } = parsed;

  // Verify the card belongs to this user before writing targets against it. RLS
  // protects allocation_targets by user_id, but the FK alone would happily let a
  // forged card_id point at another user's card; this is the ownership belt.
  const { data: card } = await supabase
    .from("allocation_cards")
    .select("id")
    .eq("id", cardId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!card) {
    return jsonError("NOT_FOUND", "Card not found", 404);
  }

  // Empty payload clears the card — skip the upsert (Supabase rejects an empty
  // upsert) and delete every row in this card.
  if (rows.length === 0) {
    const { error: clearError } = await supabase.from("allocation_targets").delete().eq("card_id", cardId);
    if (clearError) {
      return jsonError("UPDATE_FAILED", clearError.message, 500);
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // Stamp user_id (for RLS) and card_id from the verified card onto every row.
  const insertRows: TablesInsert<"allocation_targets">[] = rows.map((r) => ({
    user_id: user.id,
    card_id: cardId,
    asset_id: r.asset_id,
    target_pct: r.target_pct,
  }));

  const { data, error: upsertError } = await supabase
    .from("allocation_targets")
    .upsert(insertRows, { onConflict: "card_id,asset_id" })
    .select("*");

  if (upsertError) {
    return jsonError("UPDATE_FAILED", upsertError.message, 500);
  }

  // Delete this card's rows for assets not in the submitted payload (de-select).
  const submittedIds = rows.map((r) => r.asset_id);
  const { error: deleteError } = await supabase
    .from("allocation_targets")
    .delete()
    .eq("card_id", cardId)
    .not("asset_id", "in", `(${submittedIds.join(",")})`);

  if (deleteError) {
    return jsonError("UPDATE_FAILED", deleteError.message, 500);
  }

  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};
