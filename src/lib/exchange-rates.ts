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

/**
 * Workers Cache API, typed locally: the project has no @cloudflare/workers-types,
 * and the DOM lib's CacheStorage has no `default`. Only the two calls used here.
 */
interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Constant key for the edge copy of the Frankfurter body (a GET Request URL). */
const CACHE_KEY_URL = "https://bitworth.cache/fx/frankfurter-v2-ecb-eur-pln-usd";

export interface RatesResult {
  rates: Record<Currency, number>;
  /** True exactly when the hard-coded STATIC_RATES are returned. */
  approximate: boolean;
}

function warn(stage: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.warn(`exchange-rates: ${stage} failed: ${message}`);
}

/** caches.default on Workers; null under Node/vitest, where there is no Cache API. */
function edgeCache(): EdgeCache | null {
  if (typeof caches === "undefined") return null;
  const storage = caches as unknown as { default?: EdgeCache };
  return storage.default ?? null;
}

function toRates({ eurUsd, eurPln }: { eurUsd: number; eurPln: number }): Record<Currency, number> {
  return {
    USD: 1.0,
    EUR: 1 / eurUsd,
    PLN: eurPln / eurUsd,
  };
}

/** A cached copy that is missing, unreadable or fails parseEcbRates is a miss. */
async function fromCache(cache: EdgeCache, key: Request): Promise<Record<Currency, number> | null> {
  let hit: Response | undefined;
  try {
    hit = await cache.match(key);
  } catch (err) {
    warn("cache match", err);
    return null;
  }
  if (!hit) return null;
  try {
    return toRates(parseEcbRates(await hit.json()));
  } catch (err) {
    warn("parse", new Error(`cached body: ${err instanceof Error ? err.message : String(err)}`));
    return null;
  }
}

/**
 * EUR-based ECB rates, converted to a USD base. Order: the edge cache
 * (caches.default), then Frankfurter with a cf cache TTL as a second layer,
 * then STATIC_RATES. Every failure is logged; only a 2xx body that passes
 * parseEcbRates is stored, and the fallback never is.
 */
export async function getRates(): Promise<RatesResult> {
  const cache = edgeCache();
  const key = new Request(CACHE_KEY_URL, { method: "GET" });

  if (cache) {
    const cached = await fromCache(cache, key);
    if (cached) return { rates: cached, approximate: false };
  }

  // `cf` is a Workers-only fetch option; Node's fetch ignores it.
  const init: RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } } = {
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
  };

  let res: Response;
  try {
    res = await fetch(FRANKFURTER_V2_ECB_URL, init);
  } catch (err) {
    warn("fetch", err);
    return { rates: { ...STATIC_RATES }, approximate: true };
  }
  if (!res.ok) {
    warn(`status ${res.status}`, new Error(`frankfurter responded ${res.status}`));
    return { rates: { ...STATIC_RATES }, approximate: true };
  }

  let text: string;
  let parsed: { eurUsd: number; eurPln: number };
  try {
    text = await res.text();
    parsed = parseEcbRates(JSON.parse(text));
  } catch (err) {
    warn("parse", err);
    return { rates: { ...STATIC_RATES }, approximate: true };
  }

  if (cache) {
    try {
      await cache.put(
        key,
        new Response(text, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `max-age=${CACHE_TTL_SECONDS}`,
          },
        }),
      );
    } catch (err) {
      // The fetched rates are still correct for this request.
      warn("cache put", err);
    }
  }

  return { rates: toRates(parsed), approximate: false };
}
