import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import type { PostgrestError } from "@supabase/supabase-js";

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

// PATCH /api/snapshots/:id — set or correct the interval inputs recorded on one
// snapshot (enables backfilling history). Body: any of
//   { net_contribution: number | null, income: number | null }
// with at least one key present. Only the keys present are written, so editing
// one never touches the other. A finite number sets the value; explicit `null`
// clears it back to unknown. `net_contribution` is signed (negatives are
// withdrawals); `income` must be >= 0 (the column's CHECK says the same).
export const PATCH: APIRoute = async ({ params, request, cookies }) => {
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

  const id = params.id;
  if (!id) {
    return jsonError("MISSING_ID", "Snapshot ID is required", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError("VALIDATION_ERROR", "net_contribution or income is required", 400);
  }
  const fields = body as Record<string, unknown>;

  // Distinguish "key present and null" (clear) from invalid (reject), and an
  // absent key (leave the column as it is) from both.
  const update: { net_contribution?: number | null; income?: number | null } = {};
  if ("net_contribution" in fields) {
    const raw = fields.net_contribution;
    if (raw !== null && !(typeof raw === "number" && Number.isFinite(raw))) {
      return jsonError("VALIDATION_ERROR", "net_contribution must be a finite number or null", 400);
    }
    update.net_contribution = raw;
  }
  if ("income" in fields) {
    const raw = fields.income;
    if (raw !== null && !(typeof raw === "number" && Number.isFinite(raw) && raw >= 0)) {
      return jsonError("VALIDATION_ERROR", "income must be a finite number >= 0, or null", 400);
    }
    update.income = raw;
  }
  if (Object.keys(update).length === 0) {
    return jsonError("VALIDATION_ERROR", "net_contribution or income is required", 400);
  }

  // The update payload deliberately never includes user_id; the .eq("user_id")
  // filter is the write-scope defense alongside RLS (lessons.md §"RLS
  // USING-only is not enough"). An unmatched row returns no data → 404.
  const { data, error }: { data: Tables<"snapshots"> | null; error: null | PostgrestError } = await supabase
    .from("snapshots")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return jsonError("UPDATE_FAILED", error.message, 500);
  }

  if (!data) {
    return jsonError("NOT_FOUND", "Snapshot not found", 404);
  }

  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
