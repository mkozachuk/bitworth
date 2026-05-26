import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export interface CryptoPrice {
  symbol: string;
  price_usd: number;
  fetched_at: string;
}

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

export async function fetchCryptoPrices(db: SupabaseClient<Database>): Promise<CryptoPrice[]> {
  const symbols = ["bitcoin", "ethereum"];

  const prices: CryptoPrice[] = [];
  const fetchedAt = new Date().toISOString();

  try {
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=${symbols.join(",")}&vs_currencies=usd`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, { usd: number }>;

    for (const [coinId, priceData] of Object.entries(data)) {
      const symbolMap: Record<string, string> = {
        bitcoin: "BTC",
        ethereum: "ETH",
      };
      const symbol = symbolMap[coinId];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (symbol && priceData.usd !== undefined) {
        const price: CryptoPrice = {
          symbol,
          price_usd: priceData.usd,
          fetched_at: fetchedAt,
        };
        prices.push(price);

        await db.from("crypto_prices").upsert(price, { onConflict: "symbol" });
      }
    }
  } catch {
    // Fall through to cached
  }

  if (prices.length === 0) {
    const { data } = await db.from("crypto_prices").select("*").order("fetched_at", { ascending: false });

    if (data != null && data.length > 0) {
      return data;
    }
  }

  return prices;
}

export function getCachedCryptoPrices(db: SupabaseClient<Database>) {
  return db.from("crypto_prices").select("*").order("fetched_at", { ascending: false });
}

export function isPriceStale(fetchedAt: string, maxAgeMs = 3600 * 1000): boolean {
  return Date.now() - new Date(fetchedAt).getTime() > maxAgeMs;
}
