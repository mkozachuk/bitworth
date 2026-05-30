import type { SupabaseClient } from "@supabase/supabase-js";

export type Currency = "PLN" | "USD" | "EUR";

const STATIC_RATES: Record<Currency, number> = {
  USD: 1.0,
  EUR: 0.92,
  PLN: 3.85,
};

const CACHE_TTL_SECONDS = 3600;

async function upsertRate(supabase: SupabaseClient, base: string, target: string, rate: number): Promise<void> {
  await supabase.from("exchange_rate_cache").upsert(
    {
      base_currency: base,
      target_currency: target,
      rate,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "base_currency,target_currency" },
  );
}

async function getCachedRate(
  supabase: SupabaseClient,
  base: string,
  target: string,
): Promise<{ rate: number; fetched_at: string } | null> {
  const { data } = await supabase
    .from("exchange_rate_cache")
    .select("rate, fetched_at")
    .eq("base_currency", base)
    .eq("target_currency", target)
    .maybeSingle();

  if (!data) return null;

  const age = (Date.now() - new Date(String(data.fetched_at)).getTime()) / 1000;
  if (age > CACHE_TTL_SECONDS) return null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return { rate: data.rate, fetched_at: data.fetched_at };
}

export async function getRates(supabase: SupabaseClient): Promise<Record<Currency, number>> {
  try {
    const [cachedEUR_USD, cachedEUR_PLN] = await Promise.all([
      getCachedRate(supabase, "EUR", "USD"),
      getCachedRate(supabase, "EUR", "PLN"),
    ]);

    if (cachedEUR_USD && cachedEUR_PLN) {
      return {
        USD: 1.0,
        EUR: 1 / cachedEUR_USD.rate,
        PLN: cachedEUR_PLN.rate / cachedEUR_USD.rate,
      };
    }

    const res = await fetch("https://api.frankfurter.app/latest?from=EUR");
    if (!res.ok) throw new Error(`frankfurter responded ${res.status}`);
    const json = (await res.json()) as { rates: Record<string, number | undefined> };

    const eurUsd = json.rates.USD ?? 1.0;
    const eurPln = json.rates.PLN ?? STATIC_RATES.PLN;

    await Promise.all([
      upsertRate(supabase, "EUR", "USD", eurUsd),
      upsertRate(supabase, "EUR", "PLN", eurPln),
      upsertRate(supabase, "EUR", "EUR", 1.0),
      upsertRate(supabase, "USD", "EUR", 1 / eurUsd),
      upsertRate(supabase, "USD", "PLN", eurPln / eurUsd),
      upsertRate(supabase, "PLN", "EUR", 1 / eurPln),
      upsertRate(supabase, "PLN", "USD", eurUsd / eurPln),
    ]);

    return {
      USD: 1.0,
      EUR: 1 / eurUsd,
      PLN: eurPln / eurUsd,
    };
  } catch {
    return { ...STATIC_RATES };
  }
}
