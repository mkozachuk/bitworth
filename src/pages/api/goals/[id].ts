import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { TablesUpdate } from "@/lib/database.types";

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

const NAME_MAX = 60;
const VALID_KINDS = ["net_worth", "category"] as const;
const VALID_CURRENCIES = ["PLN", "USD", "EUR"] as const;
const MAX_TARGET_AMOUNT = 1e15;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `user_id` is deliberately absent — see the same note in ./index.ts.
const GOAL_SELECT = "id, name, kind, category_id, target_amount, target_currency, target_date, created_at, updated_at";

// The column is NUMERIC(18,2), so a third decimal place would be silently
// rounded on write. Reject instead (asset-balancer impl-review F4).
function hasMoreThanTwoDecimals(value: number): boolean {
  const text = String(value);
  if (text.includes("e") || text.includes("E")) return true;
  const dot = text.indexOf(".");
  return dot !== -1 && text.length - dot - 1 > 2;
}

// `Date.parse` is lenient ("2026-02-31" rolls over), so round-trip and compare.
function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

type GoalPatch = TablesUpdate<"goals">;

// Validate only the keys actually present — a partial payload leaves the rest
// untouched (no clobber). Coherence between kind and category_id is NOT checked
// here: it has to be checked against the merged row, which needs the stored one.
function parsePatch(body: unknown): { updates: GoalPatch } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be an object" };
  }
  const raw = body as Record<string, unknown>;
  const updates: GoalPatch = {};

  if (raw.name !== undefined) {
    const { name } = raw;
    if (typeof name !== "string" || name.trim().length === 0) {
      return { error: "name must be a non-empty string" };
    }
    if (name.length > NAME_MAX) {
      return { error: `name must be at most ${NAME_MAX} characters` };
    }
    updates.name = name.trim();
  }

  if (raw.kind !== undefined) {
    const { kind } = raw;
    if (typeof kind !== "string" || !VALID_KINDS.includes(kind as (typeof VALID_KINDS)[number])) {
      return { error: `kind must be one of ${VALID_KINDS.join(", ")}` };
    }
    updates.kind = kind;
  }

  if (raw.category_id !== undefined) {
    const categoryId = raw.category_id;
    if (categoryId === null) {
      updates.category_id = null;
    } else if (typeof categoryId !== "string" || categoryId.trim().length === 0) {
      return { error: "category_id must be a non-empty string or null" };
    } else {
      updates.category_id = categoryId.trim();
    }
  }

  if (raw.target_amount !== undefined) {
    const targetAmount = raw.target_amount;
    if (typeof targetAmount !== "number" || !Number.isFinite(targetAmount)) {
      return { error: "target_amount must be a finite number" };
    }
    if (targetAmount <= 0) {
      return { error: "target_amount must be greater than 0" };
    }
    if (targetAmount > MAX_TARGET_AMOUNT) {
      return { error: `target_amount must be at most ${MAX_TARGET_AMOUNT}` };
    }
    if (hasMoreThanTwoDecimals(targetAmount)) {
      return { error: "target_amount must have at most 2 decimal places" };
    }
    updates.target_amount = targetAmount;
  }

  if (raw.target_currency !== undefined) {
    const targetCurrency = raw.target_currency;
    if (
      typeof targetCurrency !== "string" ||
      !VALID_CURRENCIES.includes(targetCurrency as (typeof VALID_CURRENCIES)[number])
    ) {
      return { error: `target_currency must be one of ${VALID_CURRENCIES.join(", ")}` };
    }
    updates.target_currency = targetCurrency;
  }

  if (raw.target_date !== undefined) {
    const targetDate = raw.target_date;
    if (targetDate === null) {
      updates.target_date = null;
    } else if (typeof targetDate !== "string" || !isIsoDate(targetDate)) {
      return { error: "target_date must be an ISO date string (YYYY-MM-DD) or null" };
    } else {
      updates.target_date = targetDate;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { error: "At least one goal field is required" };
  }

  return { updates };
}

// `createClient` is not generic over `Database`, so PostgREST rows arrive as
// `any`. Narrow through `unknown` once, here, rather than trusting the shape at
// each use site.
function readStoredGoal(row: unknown): { kind: string; categoryId: string | null } | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.kind !== "string") return null;
  return {
    kind: record.kind,
    categoryId: typeof record.category_id === "string" ? record.category_id : null,
  };
}

// The DB CHECK is on the resulting row, so the merged kind/category_id pair is
// what must be coherent — patching `kind` to net_worth without clearing
// `category_id` would otherwise surface as a 500 from Postgres.
function coherenceError(kind: string, categoryId: string | null): string | null {
  if (kind === "category" && (categoryId === null || categoryId.length === 0)) {
    return "category_id is required when kind is category";
  }
  if (kind === "net_worth" && categoryId !== null) {
    return "category_id must be null when kind is net_worth";
  }
  return null;
}

// PATCH /api/goals/:id — partially update one goal. Ownership is enforced twice:
// RLS on the table, plus the explicit .eq("id", id).eq("user_id", user.id) belt
// on both the read and the write. A row belonging to someone else simply does
// not match, so it surfaces as 404 — this route never emits 403.
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
    return jsonError("VALIDATION_ERROR", "Invalid goal id", 400);
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
  const { updates } = parsed;

  // Read the stored row first so coherence is checked against the *resulting*
  // row rather than the payload alone. .maybeSingle() keeps an unmatched row a
  // 404 instead of a PostgREST raise landing in the 500 branch.
  const { data: storedRow, error: fetchError } = await supabase
    .from("goals")
    .select("kind, category_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    return jsonError("FETCH_FAILED", fetchError.message, 500);
  }
  const existing = readStoredGoal(storedRow);
  if (!existing) {
    return jsonError("NOT_FOUND", "Goal not found", 404);
  }

  const resultingKind = updates.kind ?? existing.kind;
  const resultingCategoryId = updates.category_id !== undefined ? updates.category_id : existing.categoryId;
  const incoherent = coherenceError(resultingKind, resultingCategoryId ?? null);
  if (incoherent) {
    return jsonError("VALIDATION_ERROR", incoherent, 400);
  }

  const { data, error } = await supabase
    .from("goals")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(GOAL_SELECT)
    .maybeSingle();

  if (error) {
    return jsonError("UPDATE_FAILED", error.message, 500);
  }
  if (!data) {
    return jsonError("NOT_FOUND", "Goal not found", 404);
  }

  return jsonOk(data);
};

// DELETE /api/goals/:id — remove one goal. Same double ownership belt; a row
// that does not match is a 404, never a 403.
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
    return jsonError("VALIDATION_ERROR", "Invalid goal id", 400);
  }

  const { data, error } = await supabase
    .from("goals")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return jsonError("DELETE_FAILED", error.message, 500);
  }
  if (!data) {
    return jsonError("NOT_FOUND", "Goal not found", 404);
  }

  return jsonOk({ id });
};
