import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

const VALID_CURRENCIES = ["USD", "EUR", "PLN"] as const;
const VALID_THEMES = ["light", "dark", "system"] as const;
type Currency = (typeof VALID_CURRENCIES)[number];
type Theme = (typeof VALID_THEMES)[number];

// Columns returned by both GET and PUT — kept in one constant so the read and
// write projections never drift. Mirrors the user_preferences table.
const PREFS_SELECT =
  "display_currency, theme, show_fire_dashboard, fire_current_age, fire_annual_income, fire_annual_expenses, " +
  "fire_expected_return, fire_inflation_rate, fire_safe_withdrawal_rate, fire_starting_principal_override, " +
  "fire_traditional_retirement_age, fire_barista_income";

// FIRE input fields persisted on user_preferences (roadmap slice S-09). The
// codebase validates by hand (no Zod anywhere — see the asset/preference
// handlers); these bounds mirror the migration's CHECK constraints. Rates are
// fractions in [0, 1] (SWR strictly > 0); money is non-negative; ages are
// integers in a sane band.
interface FireUpdates {
  fire_current_age?: number;
  fire_annual_income?: number;
  fire_annual_expenses?: number;
  fire_expected_return?: number;
  fire_inflation_rate?: number;
  fire_safe_withdrawal_rate?: number;
  fire_starting_principal_override?: number;
  fire_traditional_retirement_age?: number;
  fire_barista_income?: number;
}

interface FireFieldSpec {
  key: keyof FireUpdates;
  min: number;
  max: number;
  exclusiveMin?: boolean;
  integer?: boolean;
}

const MAX_MONEY = 1e15;

const FIRE_FIELD_SPECS: readonly FireFieldSpec[] = [
  { key: "fire_current_age", min: 0, max: 120, integer: true },
  { key: "fire_traditional_retirement_age", min: 0, max: 120, integer: true },
  { key: "fire_annual_income", min: 0, max: MAX_MONEY },
  { key: "fire_annual_expenses", min: 0, max: MAX_MONEY },
  { key: "fire_starting_principal_override", min: 0, max: MAX_MONEY },
  { key: "fire_barista_income", min: 0, max: MAX_MONEY },
  { key: "fire_expected_return", min: 0, max: 1 },
  { key: "fire_inflation_rate", min: 0, max: 1 },
  { key: "fire_safe_withdrawal_rate", min: 0, max: 1, exclusiveMin: true },
];

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } } satisfies ErrorShape), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Validate the FIRE fields on the raw body, returning either the validated
// subset or an error message describing the first failing field. Only fields
// present on the body are validated/returned — partial payloads leave the rest
// untouched (no clobber).
function parseFireUpdates(raw: Record<string, unknown>): { updates: FireUpdates } | { error: string } {
  const updates: FireUpdates = {};

  for (const spec of FIRE_FIELD_SPECS) {
    const value = raw[spec.key];
    if (value === undefined) continue;

    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { error: `${spec.key} must be a finite number` };
    }
    if (spec.integer && !Number.isInteger(value)) {
      return { error: `${spec.key} must be an integer` };
    }
    const belowMin = spec.exclusiveMin ? value <= spec.min : value < spec.min;
    if (belowMin || value > spec.max) {
      const lowerBound = spec.exclusiveMin ? `greater than ${spec.min}` : `at least ${spec.min}`;
      return { error: `${spec.key} must be ${lowerBound} and at most ${spec.max}` };
    }
    updates[spec.key] = value;
  }

  // Cross-field check only when both ages are present in the same payload;
  // a partial payload (one age) is validated against its own bounds only.
  if (
    updates.fire_current_age !== undefined &&
    updates.fire_traditional_retirement_age !== undefined &&
    updates.fire_traditional_retirement_age <= updates.fire_current_age
  ) {
    return { error: "fire_traditional_retirement_age must be greater than fire_current_age" };
  }

  return { updates };
}

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
    .from("user_preferences")
    .select(PREFS_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return jsonError("FETCH_FAILED", error.message, 500);
  }

  if (!data) {
    return jsonError("NOT_FOUND", "User preferences not found", 404);
  }

  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};

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

  const raw = (body ?? {}) as Record<string, unknown>;
  const updates: { display_currency?: Currency; theme?: Theme; show_fire_dashboard?: boolean } & FireUpdates = {};

  if (raw.display_currency !== undefined) {
    if (typeof raw.display_currency !== "string" || !VALID_CURRENCIES.includes(raw.display_currency as Currency)) {
      return jsonError("VALIDATION_ERROR", `display_currency must be one of ${VALID_CURRENCIES.join(", ")}`, 400);
    }
    updates.display_currency = raw.display_currency as Currency;
  }

  if (raw.theme !== undefined) {
    if (typeof raw.theme !== "string" || !VALID_THEMES.includes(raw.theme as Theme)) {
      return jsonError("VALIDATION_ERROR", `theme must be one of ${VALID_THEMES.join(", ")}`, 400);
    }
    updates.theme = raw.theme as Theme;
  }

  if (raw.show_fire_dashboard !== undefined) {
    if (typeof raw.show_fire_dashboard !== "boolean") {
      return jsonError("VALIDATION_ERROR", "show_fire_dashboard must be a boolean", 400);
    }
    updates.show_fire_dashboard = raw.show_fire_dashboard;
  }

  const fireResult = parseFireUpdates(raw);
  if ("error" in fireResult) {
    return jsonError("VALIDATION_ERROR", fireResult.error, 400);
  }
  Object.assign(updates, fireResult.updates);

  if (Object.keys(updates).length === 0) {
    return jsonError("VALIDATION_ERROR", "At least one preference field is required", 400);
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: user.id, ...updates }, { onConflict: "user_id" })
    .eq("user_id", user.id)
    .select(PREFS_SELECT)
    .single();

  if (error) {
    return jsonError("UPDATE_FAILED", error.message, 500);
  }

  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};
