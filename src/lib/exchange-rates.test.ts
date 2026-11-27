import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { getRates } from "@/lib/exchange-rates";

// getRates (NB-156): no Supabase. Order is the edge cache (caches.default),
// then Frankfurter v2 with a cf cacheTtl, then STATIC_RATES. Network and the
// Cache API are stubbed via `vi.stubGlobal` for `fetch` and `caches`; the
// tests never reach Frankfurter.

const V2_ECB_URL = "https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=PLN,USD";

// The body `curl` returned for V2_ECB_URL on 2026-11-27, verbatim.
const RECON_BODY = [
  { date: "2026-11-26", base: "EUR", quote: "PLN", rate: 4.4838 },
  { date: "2026-11-26", base: "EUR", quote: "USD", rate: 1.0975 },
];

const STATIC = { USD: 1.0, EUR: 0.92, PLN: 3.85 };

interface FakeCache {
  match: Mock<(req: Request) => Promise<Response | undefined>>;
  put: Mock<(req: Request, res: Response) => Promise<void>>;
}

function fakeCache(cachedBody?: unknown): FakeCache {
  return {
    match: vi.fn((_req: Request) =>
      Promise.resolve(cachedBody === undefined ? undefined : new Response(JSON.stringify(cachedBody))),
    ),
    put: vi.fn((_req: Request, _res: Response) => Promise.resolve()),
  };
}

function installCache(cache: FakeCache): void {
  vi.stubGlobal("caches", { default: cache });
}

const fetchMock = () => fetch as unknown as Mock;

function respondWith(body: unknown, status = 200): void {
  fetchMock().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

function expectLiveRecon(result: Awaited<ReturnType<typeof getRates>>): void {
  expect(result.approximate).toBe(false);
  expect(result.rates.USD).toBe(1.0);
  expect(result.rates.EUR).toBeCloseTo(1 / 1.0975, 6);
  expect(result.rates.PLN).toBeCloseTo(4.4838 / 1.0975, 6);
}

type WarnSpy = Mock<(...args: unknown[]) => void>;

function warnedWith(warn: WarnSpy, ...parts: string[]): boolean {
  return warn.mock.calls.some((args: unknown[]) => parts.every((p) => String(args[0]).includes(p)));
}

describe("getRates", () => {
  let warn: WarnSpy;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it("serves a cache hit with no fetch and approximate false", async () => {
    const cache = fakeCache([
      { date: "2026-11-25", base: "EUR", quote: "PLN", rate: 4.4 },
      { date: "2026-11-25", base: "EUR", quote: "USD", rate: 1.1 },
    ]);
    installCache(cache);

    const result = await getRates();

    expect(fetchMock()).not.toHaveBeenCalled();
    expect(cache.match).toHaveBeenCalledTimes(1);
    const key = cache.match.mock.calls[0][0];
    expect(key.method).toBe("GET");
    expect(result.approximate).toBe(false);
    expect(result.rates.USD).toBe(1.0);
    expect(result.rates.EUR).toBeCloseTo(1 / 1.1, 6);
    expect(result.rates.PLN).toBeCloseTo(4.4 / 1.1, 6);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("on a miss fetches the v2 URL with cf.cacheTtl 3600 and stores the body with max-age=3600", async () => {
    const cache = fakeCache();
    installCache(cache);
    respondWith(RECON_BODY);

    const result = await getRates();

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock().mock.calls[0] as [
      string,
      { cf?: { cacheTtl?: number; cacheEverything?: boolean } },
    ];
    expect(url).toBe(V2_ECB_URL);
    expect(init.cf?.cacheTtl).toBe(3600);
    expect(init.cf?.cacheEverything).toBe(true);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const [putKey, stored] = cache.put.mock.calls[0];
    expect(putKey.url).toBe(cache.match.mock.calls[0][0].url);
    expect(stored.headers.get("cache-control")).toContain("max-age=3600");
    expect(await stored.json()).toEqual(RECON_BODY);
    expectLiveRecon(result);
  });

  it("goes straight to the fetch when caches is undefined", async () => {
    respondWith(RECON_BODY);

    const result = await getRates();

    expect(typeof caches).toBe("undefined");
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expectLiveRecon(result);
  });

  it("goes straight to the fetch when caches has no default", async () => {
    vi.stubGlobal("caches", {});
    respondWith(RECON_BODY);

    const result = await getRates();

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expectLiveRecon(result);
  });

  it("logs a cache match throw and still uses the fetch", async () => {
    const cache = fakeCache();
    cache.match.mockRejectedValue(new Error("match exploded"));
    installCache(cache);
    respondWith(RECON_BODY);

    const result = await getRates();

    expect(warnedWith(warn, "cache match", "match exploded")).toBe(true);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expectLiveRecon(result);
  });

  it("logs a cache put throw and keeps the live rates", async () => {
    const cache = fakeCache();
    cache.put.mockRejectedValue(new Error("put exploded"));
    installCache(cache);
    respondWith(RECON_BODY);

    const result = await getRates();

    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(warnedWith(warn, "cache put", "put exploded")).toBe(true);
    expectLiveRecon(result);
  });

  it("returns STATIC_RATES, approximate, a fetch warn and no put when fetch throws", async () => {
    const cache = fakeCache();
    installCache(cache);
    fetchMock().mockRejectedValue(new Error("network down"));

    const result = await getRates();

    expect(result).toEqual({ rates: STATIC, approximate: true });
    expect(warnedWith(warn, "fetch", "network down")).toBe(true);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("returns STATIC_RATES, approximate, a status warn and no put on 503", async () => {
    const cache = fakeCache();
    installCache(cache);
    respondWith("service unavailable", 503);

    const result = await getRates();

    expect(result).toEqual({ rates: STATIC, approximate: true });
    expect(warnedWith(warn, "status 503")).toBe(true);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("returns STATIC_RATES, approximate, a parse warn and no put on a malformed 200 body", async () => {
    const cache = fakeCache();
    installCache(cache);
    respondWith("not json");

    const result = await getRates();

    expect(result).toEqual({ rates: STATIC, approximate: true });
    expect(warnedWith(warn, "parse")).toBe(true);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ["a v1-shaped object body", { rates: { USD: 1.1, PLN: 4.4 } }],
    ["an array missing the PLN row", [{ date: "2026-11-26", base: "EUR", quote: "USD", rate: 1.0975 }]],
    [
      "a rate of 0",
      [
        { date: "2026-11-26", base: "EUR", quote: "PLN", rate: 4.4838 },
        { date: "2026-11-26", base: "EUR", quote: "USD", rate: 0 },
      ],
    ],
    [
      "a rate given as a string",
      [
        { date: "2026-11-26", base: "EUR", quote: "PLN", rate: "4.4838" },
        { date: "2026-11-26", base: "EUR", quote: "USD", rate: 1.0975 },
      ],
    ],
  ])("returns STATIC_RATES, approximate and no put for %s", async (_case, body) => {
    const cache = fakeCache();
    installCache(cache);
    respondWith(body);

    const result = await getRates();

    expect(result).toEqual({ rates: STATIC, approximate: true });
    expect(warnedWith(warn, "parse")).toBe(true);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("treats a cached body that fails the parse as a miss", async () => {
    const cache = fakeCache({ rates: { USD: 1.1, PLN: 4.4 } });
    installCache(cache);
    respondWith(RECON_BODY);

    const result = await getRates();

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(warnedWith(warn, "parse", "cached body")).toBe(true);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expectLiveRecon(result);
  });

  it("derives USD/EUR/PLN from the recon body", async () => {
    respondWith(RECON_BODY);

    const result = await getRates();

    expectLiveRecon(result);
  });
});
