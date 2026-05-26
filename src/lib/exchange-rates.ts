import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export interface ExchangeRate {
  currency_pair: string;
  rate: number;
  fetched_at: string;
}

const FRANKFURTER_BASE = "https://api.frankfurter.app";

export async function fetchExchangeRates(db: SupabaseClient<Database>): Promise<ExchangeRate[]> {
  const targetCurrencies = ["USD", "EUR"];

  const rates: ExchangeRate[] = [];
  const fetchedAt = new Date().toISOString();

  for (const currency of targetCurrencies) {
    try {
      const res = await fetch(`${FRANKFURTER_BASE}/latest?from=PLN&to=${currency}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rates: Record<string, number> };
      const rate = data.rates[currency];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (rate !== undefined) {
        const currencyPair = `PLN/${currency}`;
        rates.push({ currency_pair: currencyPair, rate, fetched_at: fetchedAt });

        await db
          .from("exchange_rates")
          .upsert({ currency_pair: currencyPair, rate, fetched_at: fetchedAt }, { onConflict: "currency_pair" });
      }
    } catch {
      // Fall through to cached data
    }
  }

  // Also fetch PLN/USD and PLN/EUR reverse for direct conversion
  try {
    const res = await fetch(`${FRANKFURTER_BASE}/latest?from=USD&to=EUR`);
    if (res.ok) {
      const data = (await res.json()) as { rates: Record<string, number> };
      const usdToEur = data.rates.EUR;
      if (usdToEur) {
        const currencyPair = "USD/EUR";
        rates.push({ currency_pair: currencyPair, rate: usdToEur, fetched_at: fetchedAt });
        await db
          .from("exchange_rates")
          .upsert(
            { currency_pair: currencyPair, rate: usdToEur, fetched_at: fetchedAt },
            { onConflict: "currency_pair" },
          );
      }
    }
  } catch {
    // Non-critical
  }

  // Fallback: if network failed, fetch from DB
  if (rates.length === 0) {
    const { data } = await db.from("exchange_rates").select("*").order("fetched_at", { ascending: false }).limit(10);

    if (data && data.length > 0) {
      return data;
    }
  }

  return rates;
}

export function getCachedRates(db: SupabaseClient<Database>) {
  return db.from("exchange_rates").select("*").order("fetched_at", { ascending: false }).limit(10);
}

export function isRateStale(fetchedAt: string, maxAgeMs = 3600 * 1000): boolean {
  return Date.now() - new Date(fetchedAt).getTime() > maxAgeMs;
}
