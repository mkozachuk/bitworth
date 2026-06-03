import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

const VALID_CURRENCIES = ["USD", "EUR", "PLN"] as const;
const VALID_THEMES = ["light", "dark", "system"] as const;
type Currency = (typeof VALID_CURRENCIES)[number];
type Theme = (typeof VALID_THEMES)[number];

export const GET: APIRoute = async ({ request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } } satisfies ErrorShape),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } } satisfies ErrorShape),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .select("display_currency, theme")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_FAILED", message: error.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!data) {
    return new Response(
      JSON.stringify({ error: { code: "NOT_FOUND", message: "User preferences not found" } } satisfies ErrorShape),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } } satisfies ErrorShape),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } } satisfies ErrorShape),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" },
      } satisfies ErrorShape),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const raw = (body ?? {}) as { display_currency?: unknown; theme?: unknown };
  const updates: { display_currency?: Currency; theme?: Theme } = {};

  if (raw.display_currency !== undefined) {
    if (typeof raw.display_currency !== "string" || !VALID_CURRENCIES.includes(raw.display_currency as Currency)) {
      return new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: `display_currency must be one of ${VALID_CURRENCIES.join(", ")}`,
          },
        } satisfies ErrorShape),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    updates.display_currency = raw.display_currency as Currency;
  }

  if (raw.theme !== undefined) {
    if (typeof raw.theme !== "string" || !VALID_THEMES.includes(raw.theme as Theme)) {
      return new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: `theme must be one of ${VALID_THEMES.join(", ")}`,
          },
        } satisfies ErrorShape),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    updates.theme = raw.theme as Theme;
  }

  if (Object.keys(updates).length === 0) {
    return new Response(
      JSON.stringify({
        error: { code: "VALIDATION_ERROR", message: "At least one of display_currency or theme is required" },
      } satisfies ErrorShape),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: user.id, ...updates }, { onConflict: "user_id" })
    .eq("user_id", user.id)
    .select("display_currency, theme")
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "UPDATE_FAILED", message: error.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};
