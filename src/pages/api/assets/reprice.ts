import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { priceKeyFor } from "@/lib/priced-holding";
import { repriceAssets, type RepriceableAsset, type RepriceFailure } from "@/lib/reprice";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

export interface UnchangedEntry {
  id: string;
  name: string;
  symbol: string;
}

/**
 * POST /api/assets/reprice: refresh the stored `amount` of the caller's priced
 * holdings from live prices, through the same `repriceAssets` the snapshot save
 * uses, so the written amount and currency are identical. It never creates a
 * snapshot. A holding whose price cannot be fetched keeps its stored amount
 * and is listed in `failed`.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
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

  const { data: rows, error: fetchError } = await supabase
    .from("assets")
    .select("id, name, amount, currency, quantity, crypto_symbol, metal_symbol")
    .eq("user_id", user.id);

  if (fetchError) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_FAILED", message: fetchError.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Only the caller's priced holdings go to the reprice helper; RLS backs the
  // `user_id` filter above.
  const priced = ((rows as RepriceableAsset[] | null) ?? []).filter((asset) => priceKeyFor(asset) !== null);
  const { repriced, failed } = await repriceAssets(supabase, priced);

  // `repriceAssets` skips the write when the price has not moved, which would
  // leave `updated_at` (the staleness clock) where it was. The amount was just
  // confirmed against a live price, so re-write the same values to stamp it.
  // Without this, a holding whose price is flat (a stablecoin, or a second
  // click inside the 1h price cache) would keep the banner up forever.
  const handled = new Set([...repriced.map((r) => r.id), ...failed.map((f) => f.id)]);
  const unchanged: UnchangedEntry[] = [];
  const failures: RepriceFailure[] = [...failed];
  for (const asset of priced) {
    if (handled.has(asset.id)) continue;
    const symbol = priceKeyFor(asset)?.symbol ?? "";
    const { error } = await supabase
      .from("assets")
      .update({ amount: asset.amount, currency: "USD" })
      .eq("id", asset.id)
      .eq("user_id", user.id);
    if (error) {
      failures.push({ id: asset.id, name: asset.name, symbol, code: error.code || "UPDATE_FAILED" });
      continue;
    }
    unchanged.push({ id: asset.id, name: asset.name, symbol });
  }

  return new Response(JSON.stringify({ data: { repriced, unchanged, failed: failures } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
