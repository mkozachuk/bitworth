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

function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
}

// Card names are free text but bounded so the tab UI stays sane.
const NAME_MAX = 60;

// GET /api/allocation-cards — this user's portfolio cards (ordered) with their
// nested target rows. RLS isolates per user; the explicit .eq("user_id") is the
// handler-level belt that pairs with the policy.
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

  const { data, error } = await supabase
    .from("allocation_cards")
    .select("id, name, position, allocation_targets(asset_id, target_pct)")
    .eq("user_id", user.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return jsonError("FETCH_FAILED", error.message, 500);
  }

  return jsonOk(data);
};

// POST /api/allocation-cards — create one empty portfolio card. Body: { name }.
// Position is appended after the user's current max so a new card lands last.
export const POST: APIRoute = async ({ request, cookies }) => {
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

  // Append after the current max position (defaults to 0 for the first card).
  const { data: last } = await supabase
    .from("allocation_cards")
    .select("position")
    .eq("user_id", user.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = last ? (last.position as number) + 1 : 0;

  const insert: TablesInsert<"allocation_cards"> = { user_id: user.id, name: name.trim(), position };
  const { data, error } = await supabase.from("allocation_cards").insert(insert).select("id, name, position").single();

  if (error) {
    return jsonError("CREATE_FAILED", error.message, 500);
  }

  return jsonOk(data, 201);
};
