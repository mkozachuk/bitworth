import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getRates } from "@/lib/exchange-rates";
import type { Tables } from "@/lib/database.types";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

export const GET: APIRoute = async ({ request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not configured" } } satisfies ErrorShape),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } } satisfies ErrorShape),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const { data, error } = await supabase
    .from("snapshots")
    .select("id, total_net_worth, display_currency, source, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_FAILED", message: error.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ data }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not configured" } } satisfies ErrorShape),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } } satisfies ErrorShape),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // Fetch current assets
  const { data: assets, error: assetsError } = await supabase
    .from("assets")
    .select("*, category:asset_categories(*)")
    .eq("user_id", user.id);

  if (assetsError) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_FAILED", message: assetsError.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Fetch user display currency preference
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("display_currency")
    .eq("user_id", user.id)
    .maybeSingle();

  const displayCurrency = (prefs?.display_currency as "USD" | "EUR" | "PLN") ?? "USD";

  // Compute net worth via getRates (server-side, can use existing logic)
  const rates = await getRates(supabase);

  type AssetRow = Tables<"assets"> & { category: Tables<"asset_categories"> };

  function convertAmount(
    amount: number,
    fromCurrency: string,
    toCurrency: "USD" | "EUR" | "PLN",
    r: Record<"USD" | "EUR" | "PLN", number>,
  ): number {
    if (fromCurrency === toCurrency) return amount;
    const inUSD = amount / r[fromCurrency as "USD" | "EUR" | "PLN"];
    return inUSD * r[toCurrency];
  }

  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const asset of assets as AssetRow[]) {
    const converted = convertAmount(asset.amount, asset.currency, displayCurrency, rates);
    if (asset.category.is_liability) {
      totalLiabilities += converted;
    } else {
      totalAssets += converted;
    }
  }
  const totalNetWorth = totalAssets - totalLiabilities;

  // Insert snapshot
  const { data: snapshot, error: snapshotError } = await supabase
    .from("snapshots")
    .insert({
      user_id: user.id,
      total_net_worth: totalNetWorth,
      display_currency: displayCurrency,
      base_currency: "USD",
      source: "manual",
    })
    .select()
    .single();

  if (snapshotError) {
    return new Response(
      JSON.stringify({ error: { code: "INSERT_FAILED", message: snapshotError.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Insert snapshot_items for each asset
  if (assets && assets.length > 0) {
    const items = (assets as AssetRow[]).map((asset, idx) => ({
      snapshot_id: snapshot.id,
      category_id: asset.category_id,
      name: asset.name,
      original_amount: asset.amount,
      original_currency: asset.currency,
      converted_amount: convertAmount(asset.amount, asset.currency, displayCurrency, rates),
      display_currency: displayCurrency,
      exchange_rate_usd: rates[asset.currency as "USD" | "EUR" | "PLN"],
      display_order: idx,
    }));

    const { error: itemsError } = await supabase.from("snapshot_items").insert(items);
    if (itemsError) {
      return new Response(
        JSON.stringify({ error: { code: "INSERT_FAILED", message: itemsError.message } } satisfies ErrorShape),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  return new Response(
    JSON.stringify({ data: snapshot as Tables<"snapshots"> }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
};