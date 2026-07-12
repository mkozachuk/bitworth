import type { SupabaseClient } from "@supabase/supabase-js";
import { METALS_API_KEY } from "astro:env/server";

const CACHE_TTL_SECONDS = 3600;

// GoldAPI.io is rate-limited per-key. The key is sent via header so it never
// lands in URLs, cache keys, or logs (mirrors the crypto-prices convention and
// the "key never in URLs/logs" rule). Reachability from Cloudflare Workers
// egress is verified out-of-band before shipping — see the plan's Phase 2
// manual verification (the exact trap S-03 hit: Binance 451, keyless CoinGecko 429).
const metalHeaders: HeadersInit = METALS_API_KEY ? { "x-access-token": METALS_API_KEY } : {};

// XAU/XAG only in v1. `id` is the stable cache key (mirrors crypto's coin id),
// `path` is the GoldAPI.io symbol segment.
const METAL_MAP: Record<string, { id: string; path: string }> = {
  XAU: { id: "gold", path: "XAU" },
  XAG: { id: "silver", path: "XAG" },
};

export interface PriceResult {
  price: number;
  isCached: boolean;
  fetchedAt: string;
  cachedAge?: string;
}

function cachedAge(fetchedAt: string): string {
  const diffMs = Date.now() - new Date(fetchedAt).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function getMetalId(symbol: string): string | null {
  const key = symbol.toUpperCase();
  return key in METAL_MAP ? METAL_MAP[key].id : null;
}

type LivePriceResult = { price: number } | { upstreamStatus?: number };

async function fetchLivePrice(symbol: string): Promise<LivePriceResult> {
  // GoldAPI.io — one call per metal to /api/{XAU|XAG}/USD. The key rides in the
  // `x-access-token` header, never the URL. `price` is USD per troy ounce.
  const key = symbol.toUpperCase();
  if (!(key in METAL_MAP)) return {};
  const path = METAL_MAP[key].path;

  const url = `https://www.goldapi.io/api/${path}/USD`;

  const res = await fetch(url, { headers: metalHeaders });
  if (!res.ok) return { upstreamStatus: res.status };
  const json = (await res.json()) as { price?: number };
  const price = json.price;
  return typeof price === "number" && !isNaN(price) ? { price } : {};
}

async function getCachedPrice(
  supabase: SupabaseClient,
  metalId: string,
): Promise<{ price: number; fetched_at: string } | null> {
  const { data } = await supabase
    .from("metal_price_cache")
    .select("price_usd, fetched_at")
    .eq("metal_id", metalId)
    .maybeSingle();

  if (!data) return null;

  const age = (Date.now() - new Date(String(data.fetched_at)).getTime()) / 1000;
  if (age > CACHE_TTL_SECONDS) return null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return { price: data.price_usd, fetched_at: data.fetched_at };
}

async function upsertCache(supabase: SupabaseClient, metalId: string, symbol: string, price: number): Promise<void> {
  await supabase.rpc("upsert_metal_price_cache", {
    p_metal_id: metalId,
    p_metal_symbol: symbol.toUpperCase(),
    p_price_usd: price,
  });
}

export async function getPrice(
  supabase: SupabaseClient,
  symbol: string,
): Promise<PriceResult | { error: { code: string; message: string; context?: unknown } }> {
  const upper = symbol.toUpperCase().trim();
  if (!upper) {
    return { error: { code: "INVALID_SYMBOL", message: "Symbol is required" } };
  }

  const metalId = getMetalId(upper);
  if (!metalId) {
    return { error: { code: "METAL_NOT_FOUND", message: `No metal found for symbol "${upper}"` } };
  }

  const cached = await getCachedPrice(supabase, metalId);
  if (cached) {
    return {
      price: cached.price,
      isCached: true,
      fetchedAt: cached.fetched_at,
      cachedAge: cachedAge(cached.fetched_at),
    };
  }

  const fetched = await fetchLivePrice(upper);
  if ("price" in fetched) {
    await upsertCache(supabase, metalId, upper, fetched.price);
    return { price: fetched.price, isCached: false, fetchedAt: new Date().toISOString() };
  }

  return {
    error: {
      code: "PRICE_UNAVAILABLE",
      message: `Could not fetch price for "${upper}"`,
      context: { metalId, upstreamStatus: fetched.upstreamStatus },
    },
  };
}
