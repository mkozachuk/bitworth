import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { TablesUpdate } from "@/lib/database.types";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_SELECT = "id, name, show_on_dashboard";
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

// Validate only the keys present: a rename, a toggle, or both.
function parsePatch(body: unknown): { updates: TablesUpdate<"tags"> } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be an object" };
  }
  const raw = body as Record<string, unknown>;
  const updates: TablesUpdate<"tags"> = {};

  if (raw.name !== undefined) {
    const checked = validateTagName(raw.name);
    if (!checked.ok) return { error: checked.message };
    updates.name = checked.name;
  }
  if (raw.show_on_dashboard !== undefined) {
    if (typeof raw.show_on_dashboard !== "boolean") return { error: "show_on_dashboard must be a boolean" };
    updates.show_on_dashboard = raw.show_on_dashboard;
  }
  if (Object.keys(updates).length === 0) {
    return { error: "At least one of name or show_on_dashboard is required" };
  }
  return { updates };
}

// PATCH /api/tags/:id — rename a tag and/or set show_on_dashboard. Ownership is
// enforced twice: RLS, plus .eq("id").eq("user_id") on the write. Another
// user's tag simply does not match, so it is a 404, never a 403 and never their
// row. A rename onto a name the user already has (ignoring case) is a 409.
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
    return jsonError("VALIDATION_ERROR", "Invalid tag id", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  const parsed = parsePatch(body);
  if ("error" in parsed) {
    return jsonError("VALIDATION_ERROR", parsed.error, 400);
  }

  const { data, error } = await supabase
    .from("tags")
    .update(parsed.updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(TAG_SELECT)
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError("DUPLICATE_TAG", `A tag named "${parsed.updates.name ?? ""}" already exists`, 409);
    }
    return jsonError("UPDATE_FAILED", error.message, 500);
  }
  if (!data) {
    return jsonError("NOT_FOUND", "Tag not found", 404);
  }

  return jsonOk(data);
};

// DELETE /api/tags/:id — remove a tag. Its asset links cascade away via the FK.
// Same double ownership belt; a row that does not match is a 404.
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
    return jsonError("VALIDATION_ERROR", "Invalid tag id", 400);
  }

  const { data, error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return jsonError("DELETE_FAILED", error.message, 500);
  }
  if (!data) {
    return jsonError("NOT_FOUND", "Tag not found", 404);
  }

  return jsonOk({ id });
};
