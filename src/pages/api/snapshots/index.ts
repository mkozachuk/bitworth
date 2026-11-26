import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getRates } from "@/lib/exchange-rates";
import { computeNetWorth, convertAmount, type Currency } from "@/lib/net-worth";
import { repriceAssets } from "@/lib/reprice";
import type { Json, Tables } from "@/lib/database.types";
import type { PostgrestError } from "@supabase/supabase-js";

// A client_request_id is any RFC 4122-shaped UUID (crypto.randomUUID() mints v4).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

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
    .from("snapshots")
    .select("id, total_net_worth, display_currency, source, created_at, net_contribution")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_FAILED", message: error.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};

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

  // Parse optional JSON body defensively: a bodyless legacy call must still
  // succeed, so missing/empty/invalid JSON is treated as no contribution and no
  // income. Each key is optional; `null` leaves its column NULL (omitted).
  let netContribution: number | undefined;
  let income: number | undefined;
  // Idempotency key (NB-060): one per save intent, minted by the client. A
  // second POST with the same key returns the first snapshot instead of saving
  // the month twice. Absent/null → NULL → always creates (legacy callers).
  let clientRequestId: string | null = null;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      const fields = body as Record<string, unknown>;
      if ("net_contribution" in fields) {
        const raw = fields.net_contribution;
        // Signed values allowed (negatives are withdrawals); reject only
        // non-finite / non-numeric.
        if (raw !== null && raw !== undefined) {
          if (typeof raw !== "number" || !Number.isFinite(raw)) {
            return new Response(
              JSON.stringify({
                error: { code: "VALIDATION_ERROR", message: "net_contribution must be a finite number" },
              } satisfies ErrorShape),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          netContribution = raw;
        }
      }
      if ("income" in fields) {
        const raw = fields.income;
        // Income earned in the interval ending at this snapshot (S-24), in the
        // display currency. Never negative (the column's CHECK agrees).
        if (raw !== null && raw !== undefined) {
          if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
            return new Response(
              JSON.stringify({
                error: { code: "VALIDATION_ERROR", message: "income must be a finite number >= 0" },
              } satisfies ErrorShape),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          income = raw;
        }
      }
      if ("client_request_id" in fields) {
        const raw = fields.client_request_id;
        if (raw !== null && raw !== undefined) {
          if (typeof raw !== "string" || !UUID_RE.test(raw)) {
            return new Response(
              JSON.stringify({
                error: { code: "VALIDATION_ERROR", message: "client_request_id must be a UUID" },
              } satisfies ErrorShape),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          clientRequestId = raw;
        }
      }
    }
  } catch {
    // No body / invalid JSON → treat as no contribution (legacy bodyless call).
  }

  // Fetch current assets, with each asset's tag links embedded in the same read
  // so the tags recorded below are the ones the asset had at this moment.
  const { data: storedAssets, error: assetsError } = await supabase
    .from("assets")
    .select("*, category:asset_categories(*), asset_tags(tag_id)")
    .eq("user_id", user.id);

  if (assetsError) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_FAILED", message: assetsError.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  type AssetRow = Tables<"assets"> & {
    category: Tables<"asset_categories">;
    asset_tags?: Pick<Tables<"asset_tags">, "tag_id">[] | null;
  };

  // Refresh priced holdings (crypto / metals) from live prices before recording
  // anything — their stored `amount` is frozen at the last edit. A price that
  // cannot be fetched is not a snapshot failure: the stored amount is used and
  // the miss is reported back so the UI can say so.
  const repricing = await repriceAssets(supabase, storedAssets as AssetRow[]);
  const assets = repricing.assets;

  // Fetch user display currency preference
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("display_currency")
    .eq("user_id", user.id)
    .maybeSingle();

  const validCurrencies = ["USD", "EUR", "PLN"] as const;
  const rawCurrency = (prefs as { display_currency?: string } | null)?.display_currency;
  const displayCurrency: Currency = validCurrencies.includes(rawCurrency as (typeof validCurrencies)[number])
    ? (rawCurrency as Currency)
    : "USD";

  const rates = await getRates(supabase);

  const totalNetWorth = computeNetWorth(
    assets.map((a) => ({
      amount: a.amount,
      currency: a.currency as Currency,
      category: { is_liability: a.category.is_liability },
    })),
    displayCurrency,
    rates,
  ).netWorth;

  // Parent and items are written by one database function call, so one
  // transaction: an item failure rolls the parent back (no orphan, no cleanup
  // call), and a replayed client_request_id inserts nothing and returns the
  // existing row. user_id is auth.uid() inside the function, never sent.
  const items = assets.map((asset, idx) => ({
    category_id: asset.category_id,
    name: asset.name,
    original_amount: asset.amount,
    original_currency: asset.currency,
    converted_amount: convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates),
    display_currency: displayCurrency,
    exchange_rate_usd: rates[asset.currency as Currency],
    display_order: idx,
    // Tags recorded at save time (B1b). [] = recorded, no tags. If the embed
    // is somehow absent, record NULL ("not recorded") rather than a false [].
    tag_ids: Array.isArray(asset.asset_tags) ? asset.asset_tags.map((t) => t.tag_id).sort() : null,
  }));

  const rpcResponse: { data: unknown; error: PostgrestError | null } = await supabase.rpc("create_snapshot", {
    p_snapshot: {
      total_net_worth: totalNetWorth,
      display_currency: displayCurrency,
      base_currency: "USD",
      source: "manual",
      // Only set the key when a finite number was provided; omitting it
      // leaves the nullable column NULL (unknown split).
      ...(netContribution !== undefined ? { net_contribution: netContribution } : {}),
      // Same rule for income: omitted unless a number was sent.
      ...(income !== undefined ? { income } : {}),
    },
    p_items: items as unknown as Json,
    p_client_request_id: clientRequestId,
  });
  const { data: result, error: rpcError } = rpcResponse;

  if (rpcError) {
    return new Response(
      JSON.stringify({ error: { code: "INSERT_FAILED", message: rpcError.message } } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const saved = result as { snapshot?: Tables<"snapshots">; created?: boolean } | null;
  const snapshot = saved?.snapshot;
  if (!snapshot) {
    return new Response(
      JSON.stringify({
        error: { code: "INSERT_FAILED", message: "Snapshot insert returned no row" },
      } satisfies ErrorShape),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      data: snapshot,
      repricing: { repriced: repricing.repriced.length, failed: repricing.failed },
    }),
    {
      // 201 for a new snapshot; 200 for a replayed key (nothing was written).
      status: saved.created === false ? 200 : 201,
      headers: { "Content-Type": "application/json" },
    },
  );
};
