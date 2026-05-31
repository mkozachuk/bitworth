import type { SupabaseClient } from "@supabase/supabase-js";

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
  // Binance public API — works without auth, no CORS issues from Cloudflare Workers
  const symbolMap: Record<string, string> = {
    bitcoin: "BTCUSDT",
    ethereum: "ETHUSDT",
    binancecoin: "BNBUSDT",
    solana: "SOLUSDT",
    ripple: "XRPUSDT",
    cardano: "ADAUSDT",
    avalanche: "AVAXUSDT",
    dogecoin: "DOGEUSDT",
    tron: "TRXUSDT",
    polkadot: "DOTUSDT",
    chainlink: "LINKUSDT",
    "matic-network": "MATICUSDT",
    "shiba-inu": "SHIBUSDT",
    litecoin: "LTCUSDT",
    "bitcoin-cash": "BCHUSDT",
    uniswap: "UNIUSDT",
    cosmos: "ATOMUSDT",
    stellar: "XLMUSDT",
    near: "NEARUSDT",
    aptos: "APTUSDT",
    arbitrum: "ARBUSDT",
    optimism: "OPUSDT",
    pepe: "PEPEUSDT",
  };

  const binanceSymbol = symbolMap[coinId];
  const url = binanceSymbol
    ? `https://api.binance.com/api/v3/avgPrice?symbol=${binanceSymbol}`
    : `https://api.binance.com/api/v3/avgPrice?symbol=${coinId.toUpperCase()}USDT`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { price?: string };
  const price = parseFloat(json.price ?? "");
  return isNaN(price) ? null : price;
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
    return {
      price: cached.price,
      isCached: true,
      fetchedAt: cached.fetched_at,
      cachedAge: cachedAge(cached.fetched_at),
    };
  }

  const fetchedPrice = await fetchFromCoinGecko(coinId);
  if (fetchedPrice !== null) {
    await upsertCache(supabase, coinId, upper, fetchedPrice);
    return { price: fetchedPrice, isCached: false, fetchedAt: new Date().toISOString() };
  }

  return { error: { code: "PRICE_UNAVAILABLE", message: `Could not fetch price for "${upper}"` } };
}
