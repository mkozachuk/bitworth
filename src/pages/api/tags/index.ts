import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { TablesInsert } from "@/lib/database.types";
import { validateTagName } from "@/lib/tags";

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

// `user_id` is deliberately never selected, so the tenant key cannot leak into
// a response body.
const TAG_SELECT = "id, name, show_on_dashboard";

// Postgres unique_violation. The only unique key a tag write can hit is the
// per-user, case-insensitive name index, so this always means "name taken".
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

// GET /api/tags — this user's tags, by name. RLS isolates rows per user; the
// explicit .eq("user_id") is the handler-level belt that pairs with the policy.
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
    .from("tags")
    .select(TAG_SELECT)
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error) {
    return jsonError("FETCH_FAILED", error.message, 500);
  }

  return jsonOk(data);
};

// POST /api/tags — create one tag. Body: { name, show_on_dashboard? }. The name
// is trimmed and must be 1–32 characters. Uniqueness (per user, ignoring case)
// is decided by the database's unique index, not by a read-then-write check,
// so two concurrent creates cannot both succeed; the loser gets 409.
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

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError("VALIDATION_ERROR", "Request body must be an object with name", 400);
  }
  const raw = body as Record<string, unknown>;

  const checked = validateTagName(raw.name);
  if (!checked.ok) {
    return jsonError("VALIDATION_ERROR", checked.message, 400);
  }
  if (raw.show_on_dashboard !== undefined && typeof raw.show_on_dashboard !== "boolean") {
    return jsonError("VALIDATION_ERROR", "show_on_dashboard must be a boolean", 400);
  }

  const insert: TablesInsert<"tags"> = { user_id: user.id, name: checked.name };
  if (typeof raw.show_on_dashboard === "boolean") insert.show_on_dashboard = raw.show_on_dashboard;

  const { data, error } = await supabase.from("tags").insert(insert).select(TAG_SELECT).single();

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError("DUPLICATE_TAG", `A tag named "${checked.name}" already exists`, 409);
    }
    return jsonError("CREATE_FAILED", error.message, 500);
  }

  return jsonOk(data, 201);
};
