import type { SupabaseClient } from "@supabase/supabase-js";

// Static fallback prices — used when both CoinGecko and DB cache fail
const STATIC_PRICE: Record<string, number> = {
  BTC: 95000,
  ETH: 3000,
  SOL: 180,
  ADA: 0.45,
  BNB: 600,
};

const CACHE_TTL_SECONDS = 3600;

// Hardcoded coin ID map for top coins
const COIN_ID_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  USDC: "usd-coin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOGE: "dogecoin",
  TRX: "tron",
  DOT: "polkadot",
  LINK: "chainlink",
  MATIC: "matic-network",
  SHIB: "shiba-inu",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  UNI: "uniswap",
  ATOM: "cosmos",
  XLM: "stellar",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  PEPE: "pepe",
};

export interface PriceResult {
  price: number;
  isCached: boolean;
  fetchedAt: string;
}

interface CoinListEntry {
  id: string;
  symbol: string;
}

async function lookupCoinIdViaApi(symbol: string): Promise<string | null> {
  const res = await fetch("https://api.coingecko.com/api/v3/coins/list?include_platform=false");
  if (!res.ok) return null;
  const coins = (await res.json()) as CoinListEntry[];
  const match = coins.find((c) => c.symbol.toLowerCase() === symbol.toLowerCase());
  return match?.id ?? null;
}

async function getCoinId(supabase: SupabaseClient, symbol: string): Promise<string | null> {
  const upper = symbol.toUpperCase();
  if (COIN_ID_MAP[upper]) return COIN_ID_MAP[upper];
  return lookupCoinIdViaApi(symbol);
}

async function fetchFromCoinGecko(coinId: string): Promise<number | null> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
  const res = await fetch(url);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    const retry = await fetch(url);
    if (!retry.ok) return null;
    const json = (await retry.json()) as Record<string, Record<string, number | undefined>>;
    return json[coinId]?.usd ?? null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, Record<string, number | undefined>>;
  return json[coinId]?.usd ?? null;
}

async function getCachedPrice(
  supabase: SupabaseClient,
  coinId: string,
): Promise<{ price: number; fetched_at: string } | null> {
  const { data } = await supabase
    .from("crypto_price_cache")
    .select("price_usd, fetched_at")
    .eq("coin_id", coinId)
    .maybeSingle();

  if (!data) return null;

  const age = (Date.now() - new Date(String(data.fetched_at)).getTime()) / 1000;
  if (age > CACHE_TTL_SECONDS) return null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return { price: data.price_usd, fetched_at: data.fetched_at };
}

async function upsertCache(supabase: SupabaseClient, coinId: string, symbol: string, price: number): Promise<void> {
  await supabase.rpc("upsert_crypto_price_cache", {
    p_coin_id: coinId,
    p_coin_symbol: symbol.toUpperCase(),
    p_price_usd: price,
  });
}

export async function getPrice(
  supabase: SupabaseClient,
  symbol: string,
): Promise<PriceResult | { error: { code: string; message: string } }> {
  const upper = symbol.toUpperCase().trim();
  if (!upper) {
    return { error: { code: "INVALID_SYMBOL", message: "Symbol is required" } };
  }

  const coinId = await getCoinId(supabase, upper);
  if (!coinId) {
    return { error: { code: "COIN_NOT_FOUND", message: `No coin found for symbol "${upper}"` } };
  }

  const cached = await getCachedPrice(supabase, coinId);
  if (cached) {
    return { price: cached.price, isCached: true, fetchedAt: cached.fetched_at };
  }

  const fetchedPrice = await fetchFromCoinGecko(coinId);
  if (fetchedPrice !== null) {
    await upsertCache(supabase, coinId, upper, fetchedPrice);
    return { price: fetchedPrice, isCached: false, fetchedAt: new Date().toISOString() };
  }

  const staticPrice = STATIC_PRICE[upper];
  if (staticPrice !== undefined) {
    return { price: staticPrice, isCached: false, fetchedAt: "" };
  }

  return { error: { code: "PRICE_UNAVAILABLE", message: `Could not fetch price for "${upper}"` } };
}
