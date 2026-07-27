import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

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

// PATCH /api/assets/order — renumber the caller's assets from an ordered id
// array. The `reorder_assets` RPC (SECURITY DEFINER) is the ownership boundary:
// it scopes every write to auth.uid() and rejects an array that is not a
// complete, duplicate-free cover of the caller's assets, so a stale client
// fails loudly instead of scrambling the list. Renumbering happens in one
// statement — a partial write is impossible (lessons.md §"DB multi-table writes
// must be atomic").
export const PATCH: APIRoute = async ({ request, cookies }) => {
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

  const raw = (body ?? {}) as Record<string, unknown>;
  const ids = raw.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id.length > 0)) {
    return jsonError("VALIDATION_ERROR", "ids must be a non-empty array of asset id strings", 400);
  }

  const { error } = await supabase.rpc("reorder_assets", { p_ids: ids as string[] });
  if (error) {
    return jsonError("REORDER_FAILED", "Failed to reorder assets", 500, error.message);
  }

  return new Response(JSON.stringify({ data: { count: ids.length } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
