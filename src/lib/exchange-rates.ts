import type { SupabaseClient } from "@supabase/supabase-js";

export type Currency = "PLN" | "USD" | "EUR";

const STATIC_RATES: Record<Currency, number> = {
  USD: 1.0,
  EUR: 0.92,
  PLN: 3.85,
};

const CACHE_TTL_SECONDS = 3600;

/** Frankfurter v2, pinned to the ECB provider: one row per (base, quote) pair. */
const FRANKFURTER_V2_ECB_URL = "https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=PLN,USD";

/** A usable rate: a finite number above zero. Anything else is a bad response. */
function validRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/**
 * Reads EUR->USD and EUR->PLN from the v2 array body. Throws on any other shape,
 * a missing row or an unusable rate, so the caller falls back to STATIC_RATES
 * instead of inventing a rate.
 */
function parseEcbRates(body: unknown): { eurUsd: number; eurPln: number } {
  if (!Array.isArray(body)) throw new Error("frankfurter v2 body is not an array");
  const rows = body as unknown[];
  const rateFor = (quote: Currency): number => {
    const row = rows.find(
      (r): r is { base: unknown; quote: unknown; rate: unknown } =>
        typeof r === "object" &&
        r !== null &&
        (r as { base?: unknown }).base === "EUR" &&
        (r as { quote?: unknown }).quote === quote,
    );
    if (!row) throw new Error(`frankfurter v2 body has no EUR->${quote} row`);
    if (!validRate(row.rate)) throw new Error(`frankfurter v2 EUR->${quote} rate is not a positive number`);
    return row.rate;
  };
  return { eurUsd: rateFor("USD"), eurPln: rateFor("PLN") };
}

async function upsertRate(supabase: SupabaseClient, base: string, target: string, rate: number): Promise<void> {
  // supabase-js resolves with `{ error }` instead of throwing, so a failed
  // cache write is silent unless we read it. Log and carry on: the fetched
  // rates are still correct for this request.
  const { error } = await supabase.from("exchange_rate_cache").upsert(
    {
      base_currency: base,
      target_currency: target,
      rate,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "base_currency,target_currency" },
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`exchange_rate_cache upsert failed for ${base}->${target}: ${error.message}`);
  }
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

    const res = await fetch(FRANKFURTER_V2_ECB_URL);
    if (!res.ok) throw new Error(`frankfurter responded ${res.status}`);
    const { eurUsd, eurPln } = parseEcbRates(await res.json());

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
