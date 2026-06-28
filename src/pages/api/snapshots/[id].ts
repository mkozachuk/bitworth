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

// PATCH /api/snapshots/:id — set or correct net_contribution on one snapshot
// (enables backfilling history). Body: { net_contribution: number | null }.
// A finite number sets the value; explicit `null` clears it back to unknown.
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

  if (typeof body !== "object" || body === null || !("net_contribution" in body)) {
    return jsonError("VALIDATION_ERROR", "net_contribution is required", 400);
  }

  const raw = (body as Record<string, unknown>).net_contribution;
  // Distinguish "key present and null" (clear) from invalid (reject). Signed
  // numbers are allowed (negatives are withdrawals); reject only non-finite.
  let netContribution: number | null;
  if (raw === null) {
    netContribution = null;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    netContribution = raw;
  } else {
    return jsonError("VALIDATION_ERROR", "net_contribution must be a finite number or null", 400);
  }

  // The update payload deliberately never includes user_id; the .eq("user_id")
  // filter is the write-scope defense alongside RLS (lessons.md §"RLS
  // USING-only is not enough"). An unmatched row returns no data → 404.
  const { data, error }: { data: Tables<"snapshots"> | null; error: null | PostgrestError } = await supabase
    .from("snapshots")
    .update({ net_contribution: netContribution })
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
