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

const NAME_MAX = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/allocation-cards/:id — rename one card. Body: { name }.
export const PATCH: APIRoute = async ({ request, cookies, params }) => {
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
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return jsonError("VALIDATION_ERROR", "Invalid card id", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError("VALIDATION_ERROR", "Request body must be an object with name", 400);
  }
  const name = (body as Record<string, unknown>).name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError("VALIDATION_ERROR", "name must be a non-empty string", 400);
  }
  if (name.length > NAME_MAX) {
    return jsonError("VALIDATION_ERROR", `name must be at most ${NAME_MAX} characters`, 400);
  }

  // .eq("user_id") is the ownership belt alongside RLS; an unmatched row returns
  // no data, which we surface as 404 rather than a silent success.
  const { data, error } = await supabase
    .from("allocation_cards")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name, position")
    .maybeSingle();

  if (error) {
    return jsonError("UPDATE_FAILED", error.message, 500);
  }
  if (!data) {
    return jsonError("NOT_FOUND", "Card not found", 404);
  }

  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};

// DELETE /api/allocation-cards/:id — remove one card. Its target rows cascade
// away via the FK (ON DELETE CASCADE), so no compensating delete is needed.
export const DELETE: APIRoute = async ({ request, cookies, params }) => {
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
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return jsonError("VALIDATION_ERROR", "Invalid card id", 400);
  }

  const { error } = await supabase.from("allocation_cards").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    return jsonError("DELETE_FAILED", error.message, 500);
  }

  return new Response(JSON.stringify({ data: { id } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
