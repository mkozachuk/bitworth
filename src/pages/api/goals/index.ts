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

// Goal names are free text but bounded so the list and card layouts stay sane.
const NAME_MAX = 60;
const VALID_KINDS = ["net_worth", "category"] as const;
const VALID_CURRENCIES = ["PLN", "USD", "EUR"] as const;
// `target_amount` is NUMERIC(18,2): 16 integer digits max. The bound keeps the
// value well inside that and, as a side effect, out of exponent notation.
const MAX_TARGET_AMOUNT = 1e15;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Columns echoed back to the client. `user_id` is deliberately absent — the
// caller is the owner by construction, so returning the tenant key would be
// pure leakage. Any future column must be added here explicitly.
const GOAL_SELECT = "id, name, kind, category_id, target_amount, target_currency, target_date, created_at, updated_at";

// The column is NUMERIC(18,2), so a third decimal place would be silently
// rounded on write. Reject instead of storing something the user did not type
// (asset-balancer impl-review F4: validation looser than the column drifts).
function hasMoreThanTwoDecimals(value: number): boolean {
  const text = String(value);
  if (text.includes("e") || text.includes("E")) return true;
  const dot = text.indexOf(".");
  return dot !== -1 && text.length - dot - 1 > 2;
}

// `Date.parse` is lenient — "2026-02-31" rolls over to March rather than
// failing — so round-trip the parsed value back to an ISO day and compare.
function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

interface GoalFields {
  name: string;
  kind: string;
  category_id: string | null;
  target_amount: number;
  target_currency: string;
  target_date: string | null;
}

// Hand-rolled validation (no Zod anywhere — mirrors the asset/preference/
// allocation handlers). The kind/category_id coherence rule mirrors the DB
// CHECK so an incoherent body gets a 400 here rather than a 500 from Postgres.
function parseBody(body: unknown): { fields: GoalFields } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be an object" };
  }
  const raw = body as Record<string, unknown>;

  const { name } = raw;
  if (typeof name !== "string" || name.trim().length === 0) {
    return { error: "name must be a non-empty string" };
  }
  if (name.length > NAME_MAX) {
    return { error: `name must be at most ${NAME_MAX} characters` };
  }

  const { kind } = raw;
  if (typeof kind !== "string" || !VALID_KINDS.includes(kind as (typeof VALID_KINDS)[number])) {
    return { error: `kind must be one of ${VALID_KINDS.join(", ")}` };
  }

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

  const targetCurrency = raw.target_currency;
  if (
    typeof targetCurrency !== "string" ||
    !VALID_CURRENCIES.includes(targetCurrency as (typeof VALID_CURRENCIES)[number])
  ) {
    return { error: `target_currency must be one of ${VALID_CURRENCIES.join(", ")}` };
  }

  const categoryResult = parseCategoryId(kind, raw.category_id);
  if ("error" in categoryResult) return categoryResult;

  const targetDate = raw.target_date;
  let normalisedDate: string | null = null;
  if (targetDate !== undefined && targetDate !== null) {
    if (typeof targetDate !== "string" || !isIsoDate(targetDate)) {
      return { error: "target_date must be an ISO date string (YYYY-MM-DD)" };
    }
    normalisedDate = targetDate;
  }

  return {
    fields: {
      name: name.trim(),
      kind,
      category_id: categoryResult.categoryId,
      target_amount: targetAmount,
      target_currency: targetCurrency,
      target_date: normalisedDate,
    },
  };
}

// Mirrors `CHECK ((kind = 'category' AND category_id IS NOT NULL) OR (kind =
// 'net_worth' AND category_id IS NULL))`. Exported-in-spirit: `[id].ts` carries
// its own copy, applied to the *resulting* row rather than the payload.
function parseCategoryId(kind: string, value: unknown): { categoryId: string | null } | { error: string } {
  if (kind === "category") {
    if (typeof value !== "string" || value.trim().length === 0) {
      return { error: "category_id is required and must be a non-empty string when kind is category" };
    }
    return { categoryId: value.trim() };
  }
  if (value !== undefined && value !== null) {
    return { error: "category_id must be absent when kind is net_worth" };
  }
  return { categoryId: null };
}

// GET /api/goals — this user's savings goals, oldest first. RLS isolates rows
// per user; the explicit .eq("user_id", user.id) is the handler-level belt that
// pairs with the policy.
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
    .from("goals")
    .select(GOAL_SELECT)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return jsonError("FETCH_FAILED", error.message, 500);
  }

  return jsonOk(data);
};

// POST /api/goals — create one savings goal. Body: { name, kind,
// target_amount, target_currency, category_id?, target_date? }. A target below
// the user's current value is allowed on purpose: it renders as a goal that is
// already complete.
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

  const parsed = parseBody(body);
  if ("error" in parsed) {
    return jsonError("VALIDATION_ERROR", parsed.error, 400);
  }

  const insert: TablesInsert<"goals"> = { user_id: user.id, ...parsed.fields };
  const { data, error } = await supabase.from("goals").insert(insert).select(GOAL_SELECT).single();

  if (error) {
    return jsonError("CREATE_FAILED", error.message, 500);
  }

  return jsonOk(data, 201);
};
