import type { APIRoute } from "astro";
import { createDbClient } from "@/lib/db";
import { fetchExchangeRates, isRateStale } from "@/lib/exchange-rates";

const STALE_THRESHOLD_MS = 3600 * 1000; // 1 hour

export const GET: APIRoute = async ({ request, cookies }) => {
  const db = createDbClient(request.headers, cookies);
  if (!db) {
    return new Response(JSON.stringify({ error: { code: "SERVER_ERROR", message: "Database unavailable" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get cached rates
  const { data: cachedRates, error } = await db
    .from("exchange_rates")
    .select("*")
    .order("fetched_at", { ascending: false });

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_ERROR", message: "Failed to fetch exchange rates", context: error } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const needsRefresh =
    cachedRates.length === 0 || cachedRates.some((r) => isRateStale(r.fetched_at, STALE_THRESHOLD_MS));

  const rates = cachedRates;

  // Trigger background refresh if stale
  if (needsRefresh) {
    fetchExchangeRates(db).catch(() => {
      // Non-critical: if refresh fails, return cached data
    });
  }

  return new Response(JSON.stringify({ data: rates }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
