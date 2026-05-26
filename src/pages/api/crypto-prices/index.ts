import type { APIRoute } from "astro";
import { createDbClient } from "@/lib/db";
import { fetchCryptoPrices, isPriceStale } from "@/lib/crypto-prices";

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

  const { data: cachedPrices, error } = await db
    .from("crypto_prices")
    .select("*")
    .order("fetched_at", { ascending: false });

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_ERROR", message: "Failed to fetch crypto prices", context: error } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const needsRefresh =
    cachedPrices.length === 0 || cachedPrices.some((r) => isPriceStale(r.fetched_at, STALE_THRESHOLD_MS));

  const prices = cachedPrices;

  if (needsRefresh) {
    fetchCryptoPrices(db).catch(() => {
      // Non-critical
    });
  }

  return new Response(JSON.stringify({ data: prices }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
