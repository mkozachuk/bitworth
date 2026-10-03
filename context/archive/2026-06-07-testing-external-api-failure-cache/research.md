---
date: 2026-06-07T00:00:00+02:00
researcher: Claude (Opus 4)
git_commit: 4f4521ccf2aa5efe72863f4be908e2efc26b526b
branch: feature/pwa
repository: bitworth
topic: "External API failure & cache integrity (test plan Phase 3, Risks #4 + #6)"
tags: [research, test-plan, phase-3, external-api, cache, vitest, risk-4, risk-6]
status: complete
last_updated: 2026-06-07
last_updated_by: Claude (Opus 4)
---

# Research: External API failure & cache integrity (test plan Phase 3, Risks #4 + #6)

**Date**: 2026-06-07 (Europe/Warsaw)
**Researcher**: Claude (Opus 4)
**Git Commit**: 4f4521ccf2aa5efe72863f4be908e2efc26b526b
**Branch**: feature/pwa
**Repository**: bitworth (mkozanchuk/bitworth)

## Research Question

> Per `context/changes/testing-external-api-failure-cache/change.md`: research the codebase to ground test plan §3 Phase 3 (Risks #4 — external API failure with broken UI; #6 — crypto price cache poisoned by upstream 4xx). Goal: identify (1) the load-bearing code blocks the test author must exercise, (2) the ground-truth mismatches between the test plan's stated intent and the actual code, and (3) the established test seams so the new tests fit the project pattern.

## Summary

Phase 3 of the test plan rests on two failure scenarios, and **the code is in two different states of readiness for them**:

- **Risk #4 (rates/crypto fetch failure with broken UI)**: The two helpers behave *very differently* on upstream failure. `getRates` (`src/lib/exchange-rates.ts:46-86`) is **defended** — a `try/catch` returns hard-coded `STATIC_RATES` (`exchange-rates.ts:83-85`), so a Frankfurter 4xx/5xx/timeout results in a usable number on the dashboard, not a crash. `getPrice` (`src/lib/crypto-prices.ts:137-168`) is **not defended** — upstream failure returns `{ error: { code: "PRICE_UNAVAILABLE" } }` (`crypto-prices.ts:167`), no cache fallback, no stale fallback. The dashboard's number is computed from the *server-side* `getRates` call (`dashboard.astro:24`) and is never directly affected by `/api/crypto-price`; that endpoint is consumed only by `AssetForm` on the create/edit asset page (`AssetForm.tsx:211`). The client-side `/api/rates` call inside `NetWorthDisplay` (`NetWorthDisplay.tsx:127-134`) shows a yellow banner on failure but does not crash the total.

- **Risk #6 (crypto cache poisoned by upstream 4xx)**: **The plan's "fallback flag" intent is not implementable as written** — `crypto_price_cache` has no `is_fallback` / `is_stale` / `source` column (`migrations/20260531223101_crypto_price_cache.sql:6-12`), `PriceResult` has no `isFallback` / `isStale` field (`crypto-prices.ts:34-39`), and `crypto-prices.ts` never writes a cache row from a non-2xx response — the invariant "never write a non-200 body" holds, but **only by virtue of `if (!res.ok) return null` (`crypto-prices.ts:104`) short-circuiting before parse**. Stale entries are silently evicted (`crypto-prices.ts:122-123`), not flagged. The "stale cache used because live fetch failed" path the plan's `must challenge` column implies **does not exist**.

The plan's rollout goals are still achievable, but two of the four bullets in the §2 risk-response table need re-phrasing before they can drive test cases. See **Open Questions** at the end.

Test infrastructure: **greenfield for `fetch` stubbing** — zero `vi.mock`/`vi.stubGlobal`/`msw`/`nock` precedent anywhere under `src/`. The Phase 3 test author gets to set the pattern. The closest precedents are the `vi.hoisted` + `vi.mock("@/lib/crypto-prices", ...)` boilerplate in `crypto-price.test.ts:9-22` and the per-handler `createSupabaseMock` pattern in `src/test-utils/supabase-mock.ts`.

## Detailed Findings

### 1. `src/lib/crypto-prices.ts` — the fetcher/cache that drives Risk #6

- **Upstream is Binance, not CoinGecko** despite the function name (`crypto-prices.ts:70-108`). URL is `https://api.binance.com/api/v3/avgPrice?symbol=${binanceSymbol}` (or `${coinId.toUpperCase()}USDT` fallback for unknown coins). Hardcoded, no env var. A separate `lookupCoinIdViaApi` calls CoinGecko's `coins/list` (line 57) only to resolve unknown coin IDs — it is not on the price-fetch hot path.
- **Fetch is bare**: `crypto-prices.ts:103` — `await fetch(url)`, **no `AbortController`, no timeout, no retries, no `signal`**. The full status-handling block is five lines: `if (!res.ok) return null; const json = await res.json(); const price = parseFloat(json.price ?? ""); return isNaN(price) ? null : price;` (`crypto-prices.ts:103-107`).
- **`PriceResult` interface** (`crypto-prices.ts:34-39`): `{ price: number; isCached: boolean; fetchedAt: string; cachedAge?: string }`. **No `isFallback`, `isStale`, or `source` field exists in the codebase vocabulary.**
- **Cache read** (`crypto-prices.ts:110-127`): `select("price_usd, fetched_at").eq("coin_id", coinId).maybeSingle()`. **Stale entries are silently dropped, not flagged** — `if (age > CACHE_TTL_SECONDS) return null;` (`crypto-prices.ts:122-123`). A cache row older than 3600s triggers a re-fetch exactly as if no row existed.
- **Cache write** (`crypto-prices.ts:129-135`): only ever `supabase.rpc("upsert_crypto_price_cache", { p_coin_id, p_coin_symbol, p_price_usd })`. **Reached only on the success branch** (`crypto-prices.ts:162-165`) — `if (fetchedPrice !== null) { await upsertCache(...); ... }`. The fetch-failure path at `crypto-prices.ts:166-167` returns the error without touching the cache.
- **`getPrice` control flow** (`crypto-prices.ts:137-168`):
  1. `INVALID_SYMBOL` if `upper` is empty (line 142-144).
  2. `getCoinId` → `COIN_ID_MAP` lookup or CoinGecko `coins/list` fetch (lines 64-68). On miss → `COIN_NOT_FOUND` (line 148).
  3. `getCachedPrice` (lines 151-159) — if a fresh row exists, return `{ price, isCached: true, fetchedAt, cachedAge }`.
  4. `fetchFromCoinGecko` (line 161) — `null` on 4xx/5xx/timeout/malformed body.
  5. On non-null: `upsertCache` and return `{ price, isCached: false, fetchedAt: <now> }` (lines 162-165).
  6. On null: return `{ error: { code: "PRICE_UNAVAILABLE" } }` (line 167).
- **Critical consequence for the test plan**: there is **no code path that returns a price with a "fallback" / "stale" / "from cache because fetch failed" label**. A test asserting "fetch failed → cache row returned with `isFallback: true`" cannot exist because the field does not exist. The only fallback the implementation provides is the *fresh* cache hit in step 3 (which the test plan already calls "the cache itself returns something usable when fresh" — that one is testable as-is).

### 2. `src/lib/exchange-rates.ts` — the rates fetcher that drives Risk #4

- **Upstream is Frankfurter**: `https://api.frankfurter.app/latest?from=EUR` (`exchange-rates.ts:61`). Hardcoded, no env var. Bare `fetch` (`exchange-rates.ts:61`), **no timeout, no retries, no signal**.
- **Type and shape** (`exchange-rates.ts:1-9`): `type Currency = "PLN" | "USD" | "EUR"`; `STATIC_RATES: { USD: 1.0, EUR: 0.92, PLN: 3.85 }` are the hard-coded fallback values.
- **The whole function is wrapped in `try/catch`** (`exchange-rates.ts:47-86`). The catch returns `{ ...STATIC_RATES }` (line 84). So a Frankfurter 4xx/5xx/timeout, a malformed body, a DNS failure, a thrown error from `.upsert` — all converge to the same usable answer. **This is the test plan's "documented fallback" for Risk #4's rates path** — it exists and is testable.
- **Cache table is `exchange_rate_cache`** (different from `crypto_price_cache`). `getCachedRate` reads `base_currency` + `target_currency` (lines 30-35); `upsertRate` upserts on `("base_currency", "target_currency")` (lines 14-22). Same TTL-based eviction as the crypto cache (`exchange-rates.ts:39-40`).
- **One early-exit optimisation** (`exchange-rates.ts:48-59`): if *both* `EUR→USD` and `EUR→PLN` are cached and fresh, return derived rates without hitting Frankfurter at all. This means a cache-stale scenario requires `Promise.all` to return at least one `null`.
- **The cache write runs unconditionally on a successful fetch** (`exchange-rates.ts:68-76`): all six `(base, target)` pairs get persisted. If the upsert itself throws, the `try/catch` swallows it and the function still returns the live rates (not the cached ones — the user gets the fresh answer that just failed to persist).

### 3. `supabase/migrations/20260531223101_crypto_price_cache.sql` — schema

- Columns (`migration:6-12`): `id UUID PK`, `coin_id TEXT NOT NULL UNIQUE`, `coin_symbol TEXT`, `price_usd NUMERIC(20, 8)`, `fetched_at TIMESTAMPTZ DEFAULT NOW()`. **No `is_fallback`, `is_stale`, `source`, or `error` column.**
- RLS (`migration:18-19`): `SELECT USING (true)` — public read (consistent with the rates table being public per lessons.md §2).
- Writes only via the `SECURITY DEFINER` RPC `upsert_crypto_price_cache(p_coin_id, p_coin_symbol, p_price_usd)` (lines 22-40). The function has `SET search_path = public` (line 29) — good, satisfies the lessons.md §SECURITY DEFINER rule.
- Index on `coin_symbol` (line 14) — symmetric to the `coin_id UNIQUE` constraint; not the lookup path the helper uses.

### 4. The handler layer — what `/api/crypto-price` and `/api/rates` actually do

**`src/pages/api/crypto-price.ts:9-61`**
- Auth: `createClient` + `supabase.auth.getUser()` (lines 9-32). Matches the §6.4 contract test regex.
- Validation: `symbol` required → 400 `MISSING_SYMBOL` (lines 34-46). The test plan's `crypto-price.test.ts:55-65` already pins this.
- Delegation: calls `getPrice(supabase, symbol)` (line 48); on `{ error }`, maps `COIN_NOT_FOUND`/`PRICE_UNAVAILABLE` to 404, anything else to 500 (lines 49-55). On success, returns 200 with the `PriceResult` body (lines 57-60).
- **No fallback logic in the handler** — whatever `getPrice` returns is forwarded as-is. The "fallback" the plan §2 row #4 anticipates lives in `getPrice` (or doesn't — see Finding 1).

**`src/pages/api/rates.ts:7-21`**
- **Intentionally unauthenticated** (per lessons.md §2 and the comment at lines 5-6: "Rates are intentionally unauthenticated — exchange rates are public financial data with no user-specific sensitivity. This is an explicit design decision, not an oversight."). Matches the §6.4 contract-test exemption regex.
- On `createClient` returning `null` (no env), hard-codes `{ USD: 1.0, EUR: 0.92, PLN: 3.85 }` (lines 9-14).
- On success, calls `getRates(supabase)` and returns 200 with `{ rates }` (lines 16-20). **Always 200** — the handler does not surface `getRates` failures as HTTP errors because `getRates` cannot fail (it has the `try/catch`).

### 5. The dashboard render path — what actually breaks the UI on upstream failure

The plan §2 row #4 says "the dashboard still renders a number." Reading the actual render tree, **the dashboard renders a number via two independent code paths**, neither of which can crash on upstream failure:

- **Server-side, before hydration** (`src/pages/dashboard.astro:24`): `const rates = await getRates(supabase)`. The result is passed as a prop to `<NetWorthDisplay rates={rates} client:load />` (line 47). Because `getRates` cannot fail (it has the `try/catch` fallback at `exchange-rates.ts:83-85`), the prop is always a usable `Record<Currency, number>`. The number is always computed in `NetWorthDisplay` at `NetWorthDisplay.tsx:137-149`.
- **Client-side, on hydration** (`NetWorthDisplay.tsx:117-135`): a `useEffect` does `fetch("/api/rates")` and on `.catch` sets `ratesError = "Failed to fetch exchange rates — deltas may be outdated"`. The error is rendered as a yellow banner at line 190. **The total number still renders** because the server-side `rates` prop is unaffected.

**Consequence for the plan's "small integration on dashboard fallback render" intent**: the integration test must target a failure mode that is *actually observable in the render tree*. Candidates, in order of plan alignment:
1. **`/api/rates` 5xx with server-side `getRates` succeeding** — the only observable effect is the `ratesError` yellow banner. The test can assert the banner text appears.
2. **`/api/crypto-price` 4xx/5xx** — observable in `AssetForm.tsx:256-258` as the "Price unavailable" text. The plan's "dashboard fallback render" wording is incorrect — the fallback render lives on the asset form page, not the dashboard. (This is a scope correction, not a discovery — the AssetForm is part of the dashboard's asset-management flow.)
3. **A "broken UI" mode that does not currently exist** — e.g. `getRates` returning a number that the dashboard then can't render. The plan's "blank, NaN, or hard crash" wording presupposes a class of bug that the current code does not have. (See Finding 7 for the test plan correction.)

### 6. `src/components/assets/AssetForm.tsx` — the actual `/api/crypto-price` consumer

- The only production call site is `AssetForm.tsx:211` — `fetch(\`/api/crypto-price?symbol=\${...}\`). Triggered on `onBlur` of the crypto-symbol input (line 207-242).
- The promise chain (`AssetForm.tsx:212-241`):
  1. `setPriceStatus("loading")` (line 210).
  2. Parse JSON, check `data.error` (line 220) → `setPriceStatus("error")`. Renders "Price unavailable" (line 257).
  3. Otherwise extract `data.price` and `data.isCached` (lines 224-226) → `setCryptoPrice(...)`, `setPriceStatus(data.isCached ? "cached" : "success")`. Renders the price line and, on `cached`, the `(cached · <age>)` suffix (line 253).
  4. `.catch(() => setPriceStatus("error"))` (line 239-240) — network-level failure (fetch throws) also produces the "Price unavailable" branch.
- **The "cached" status is the only "fallback" UI the user can see**, and it is the *fresh* cache hit branch from `crypto-prices.ts:151-159`, **not** a "stale cache used because fetch failed" branch. There is no UI label for that case because the code path does not exist.
- **The test plan's "dashboard still renders a number" for crypto** is also a mis-target — the form's amount field is auto-populated from `price * quantity` only on the success branches (lines 227-232). On error, the user is left to type the amount manually. That is the observable fallback, not a cached value being silently substituted.

### 7. Test infrastructure and established patterns

- `vitest.config.ts:1-10`: single config, `environment: "node"`, `include: ["src/**/*.test.ts"]`, plugin is `vite-tsconfig-paths` (satisfies the lessons.md §Vite-tsconfig-paths entry — alias resolution works). No setup files, no separate unit-vs-integration config, no DOM environment.
- `src/test-utils/supabase-mock.ts`: the shared factory from Phase 2. Three exports: `createSupabaseMock(opts)`, `createCookiesStub()`, `findCall(recorded, method, args)`. The mock auto-stubs any chainable method (`supabase-mock.ts:96-101`); per-table results are configured via `tableResults` or `tableResultQueues` (FIFO for repeated awaits in the same handler).
- **No `vi.mock`/`vi.stubGlobal`/`msw`/`nock` precedent for `fetch`** anywhere under `src/`. The Phase 3 test author who needs to stub the real Binance/Frankfurter call is introducing the pattern.
- **Closest precedent for mocking a `lib` module** is `src/pages/api/crypto-price.test.ts:9-22`:
  ```ts
  const mocks = vi.hoisted(() => {
    return {
      factory: () => null as unknown as ReturnType<typeof createSupabaseMock>,
      getPrice: vi.fn(),
    };
  });
  vi.mock("@/lib/supabase", () => ({ createClient: () => mocks.factory().client }));
  vi.mock("@/lib/crypto-prices", () => ({ getPrice: mocks.getPrice }));
  ```
  This is the shape to reuse for the **handler-level** tests. For **unit tests on the helpers themselves** (`crypto-prices.ts`, `exchange-rates.ts`), the only viable option is `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))` — greenfield for this repo.
- **No special branch in `createSupabaseMock` for `from("crypto_price_cache")` or `from("exchange_rate_cache")`**. Both go through the generic `from()`; tests pass results via `tableResults: { crypto_price_cache: { data: { price_usd: 50000, fetched_at: ... }, error: null } }`. The RPC (`upsert_crypto_price_cache`) is a single function that the mock does not special-case; the per-test strategy is either to assert on `recorded[]` for an `rpc("upsert_crypto_price_cache", ...)` call, or to set `client.rpc = vi.fn().mockResolvedValue(...)` if the assertion needs more.

### 8. NetWorthDisplay — the client-side `/api/rates` consumer (subtle)

`NetWorthDisplay.tsx:117-135` is the only client-side `/api/rates` consumer and has a non-obvious sessionStorage cache layer:
- Reads `sessionStorage.getItem("bw_rates")` first. If parseable and all three currencies present, **skips the fetch entirely** (line 122).
- Otherwise: `fetch("/api/rates")` → `sessionStorage.setItem("bw_rates", JSON.stringify(r))` (line 130) → success path. On error: `setRatesError(...)` (line 133) and **no write to sessionStorage**.
- The sessionStorage cache means **a previously-successful fetch shields the UI from later upstream failures** — but only for the session. A test that wants to exercise the error banner has to clear `sessionStorage` first or use a fresh `localStorage`-style mock. (No `sessionStorage` stub is set up in the existing tests; the test author will need to add `vi.stubGlobal("sessionStorage", ...)` or skip this layer entirely.)

This is also a hidden coupling: a test that asserts the dashboard renders a number when `/api/rates` fails is implicitly asserting that **either the server-side `rates` prop is enough (it is) or the sessionStorage cache is enough (it can be)**. The plan's "still renders a number" is true under both conditions, but the test author needs to know which one they're pinning.

## Code References

- `src/lib/crypto-prices.ts:70-108` — `fetchFromCoinGecko` (Binance hot path; the 5-line status-handling block)
- `src/lib/crypto-prices.ts:110-127` — `getCachedPrice` (silent stale eviction)
- `src/lib/crypto-prices.ts:129-135` — `upsertCache` (RPC call, success-only)
- `src/lib/crypto-prices.ts:137-168` — `getPrice` (the orchestrator)
- `src/lib/crypto-prices.ts:34-39` — `PriceResult` interface (no fallback flag)
- `src/lib/exchange-rates.ts:5-9` — `STATIC_RATES` (the fallback values)
- `src/lib/exchange-rates.ts:46-86` — `getRates` (the try/catch wrapper)
- `src/lib/exchange-rates.ts:48-59` — the cache fast-path (both pairs fresh → no Frankfurter hit)
- `src/lib/exchange-rates.ts:61` — the bare Frankfurter fetch (no timeout, no retry)
- `src/lib/exchange-rates.ts:68-76` — the unconditional cache write on success
- `src/lib/exchange-rates.ts:83-85` — the catch returning `STATIC_RATES`
- `src/pages/api/crypto-price.ts:9-61` — handler (auth, validation, delegating to `getPrice`)
- `src/pages/api/crypto-price.ts:49-55` — error → 404/500 mapping
- `src/pages/api/rates.ts:5-6` — the explicit public-route comment
- `src/pages/api/rates.ts:7-21` — handler (no auth, always 200)
- `src/pages/dashboard.astro:24` — server-side `getRates` call
- `src/pages/dashboard.astro:44-53` — `<NetWorthDisplay ... rates={rates} client:load />` prop wiring
- `src/components/NetWorthDisplay.tsx:117-135` — the client-side `/api/rates` fetch + sessionStorage layer
- `src/components/NetWorthDisplay.tsx:127` — the `fetch("/api/rates")` call
- `src/components/NetWorthDisplay.tsx:132-134` — the error branch that sets `ratesError`
- `src/components/NetWorthDisplay.tsx:190` — the yellow error banner
- `src/components/assets/AssetForm.tsx:211` — the only `/api/crypto-price` call site
- `src/components/assets/AssetForm.tsx:220-222` — error branch (`setPriceStatus("error")`)
- `src/components/assets/AssetForm.tsx:239-241` — network-failure branch (`.catch`)
- `src/components/assets/AssetForm.tsx:250-258` — the three observable render branches (`success` / `cached` / `error`)
- `supabase/migrations/20260531223101_crypto_price_cache.sql:6-12` — table schema
- `supabase/migrations/20260531223101_crypto_price_cache.sql:18-19` — RLS (public read)
- `supabase/migrations/20260531223101_crypto_price_cache.sql:22-40` — `upsert_crypto_price_cache` RPC
- `src/test-utils/supabase-mock.ts:59-133` — the factory (no `crypto_price_cache` special branch)
- `src/test-utils/supabase-mock.ts:152-154` — `findCall` (the assertion helper)
- `src/pages/api/crypto-price.test.ts:9-22` — the closest mock-the-helper pattern
- `vitest.config.ts:1-10` — config (no setup files, no DOM, no MSW)

## Architecture Insights

- **The two fetcher modules are not symmetric**. `getRates` is "always returns a number" (defensive), `getPrice` is "errors propagate as HTTP 404" (permissive). This asymmetry is a deliberate product decision — exchange rates are public and the dashboard must always show a number, while a missing crypto price is a per-asset concern that the user is told about via the "Price unavailable" UI. The test plan should reflect this asymmetry: rates → assert fallback renders, crypto → assert error path renders.

- **The cache write is unconditional on success in both helpers**. For `getPrice`, the cache is read-first, write-only-on-fetch. For `getRates`, the cache is read-first for the *fast-path*, but on the slow path the upsert runs for **six `(base, target)` pairs** including self-pairs (`EUR→EUR = 1.0`). A test that asserts "fetching rates writes a single cache row" is wrong — it writes six.

- **The dashboard's number is always computed**. There is no render path where `currentNetWorth` is `NaN` or `undefined` — `convertAmount` (`src/lib/net-worth.ts`, used at `NetWorthDisplay.tsx:141`) and the `for…of` accumulator at `NetWorthDisplay.tsx:139-148` always produce a number. The "blank, NaN, or hard crash" wording in the plan is the failure mode **to defend against**, not the current state. The current state is "always renders a number, sometimes with a yellow banner." The test should pin the "always renders a number" property — i.e. assert that even with a mocked failing `/api/rates` and a mocked failing server-side `getRates`, the number is present and equals the sum from the server-side `STATIC_RATES` baseline.

- **`isCached` is a label, not a fallback flag**. The `cached` UI branch in `AssetForm.tsx:250-258` is reached only when `crypto-prices.ts:151-159` returned a row that is fresh (under TTL). Once a row goes over 3600s old, the silent eviction at `crypto-prices.ts:122-123` makes the helper behave as if no row existed. **The test plan's "fallback entries not returned as authoritative" intent is currently satisfied by silence** — there is no fallback entry to return.

- **The contract test regex from §6.4 applies to `/api/rates`** because of the comment at `src/pages/api/rates.ts:5-6`. If that comment is ever moved or re-worded, the contract test will start failing — a useful structural pin, but worth knowing if the Phase 3 rollout ever changes the public/private decision on this endpoint.

- **No `fetch` stubbing precedent in the repo** means the Phase 3 fetcher-failure unit test is the first to introduce `vi.stubGlobal("fetch", ...)`. The Vitest API for this is stable (3.x); the pattern is `vi.stubGlobal("fetch", vi.fn())` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`, and the global is reset between tests. Worth documenting the pattern in `test-plan.md §6.6` once Phase 3 ships, so the next rollout phase that needs to stub a network call (likely Phase 4 or beyond) has the precedent.

## Historical Context (from prior changes)

- `context/changes/testing-runner-bootstrap/` — Phase 1 of the test plan. Shipped `src/lib/net-worth.test.ts` (the §6.5 oracle pattern with three cases) and `vitest.config.ts` (the §6.1 config with `vite-tsconfig-paths`). Established the co-located `*.test.ts` convention.
- `context/changes/testing-critical-path-api-integration/` — Phase 2. Shipped the per-handler integration tests, the `src/test-utils/supabase-mock.ts` factory, the contract test on `src/pages/api/api-auth-contract.test.ts`, and the `crypto-price.test.ts` (3 scenarios per the §6.6 scope addendum — the 400-missing-symbol case was added beyond the original 2). The `vi.mock("@/lib/supabase", ...)` boilerplate + `vi.hoisted` factory pattern in `crypto-price.test.ts:9-22` is the closest precedent for a Phase 3 helper-mock test. The RLS `WITH CHECK` migration (`supabase/migrations/20260602235644_rls_with_check.sql`) is unrelated to Phase 3 but ships in the same git history.
- `context/foundation/lessons.md` — §Vite-tsconfig-paths is satisfied by the current `vitest.config.ts`. §SECURITY DEFINER is satisfied by `upsert_crypto_price_cache`'s `SET search_path = public` (`migrations/20260531223101_crypto_price_cache.sql:29`). §Public API endpoints need explicit auth decisions is satisfied by the comment at `src/pages/api/rates.ts:5-6`. No new lessons are triggered by Phase 3 *as currently scoped* — but the absence of a fallback flag in the cache is a non-obvious design choice that arguably warrants a new entry ("cache write never originates from a failed fetch — silence, not a flag, is the fallback sentinel").
- The roadmap reference for the crypto cache is `context/foundation/roadmap.md` §S-03 (rates/crypto just shipped) — not re-read in this research because the relevant data is in the migration and the helper. Future readers who need the roadmap context can pick it up from the change's source commit.

## Related Research

- `context/changes/testing-runner-bootstrap/` — Phase 1 research that established the runner and the net worth test base.
- `context/changes/testing-critical-path-api-integration/` — Phase 2 research that established the per-handler + contract test pattern and the Supabase mock factory.
- `context/foundation/test-plan.md` §2 row #4 and #6 — the source of truth for what the rollout is meant to prove. The "must challenge" and "anti-pattern" columns are the load-bearing constraints; the "what would prove protection" column needs the rewording suggested in **Open Questions** below.
- `context/foundation/lessons.md` §1 (multi-table writes) and §2 (public API auth) — referenced by Phase 2; not directly triggered by Phase 3.

## Open Questions

These need answers before the Phase 3 implementer can write a spec the test cases can actually exercise. The test plan's current language is forward-leaning (it implies future fallback behaviour); the code as it stands is past-tense (it has no fallback, but the dashboard still works because of `getRates`'s `try/catch`). The implementer should clarify which of these the team wants to ship.

1. **Does Risk #4's "documented fallback" mean the existing `STATIC_RATES` fallback in `getRates` (Risk #4's rates path) is enough, or does the team want a new fallback behaviour for the crypto path too?**
   The current code: `getRates` has a fallback, `getPrice` does not. A test that asserts "rates fetch failure → STATIC_RATES returned" is straightforward. A test that asserts "crypto fetch failure → cache row served with `isFallback: true`" cannot be written because `isFallback` does not exist.
   - **Option A (no new feature)**: Phase 3 pins the current behaviour — rates falls back, crypto returns an error. Tests are: `getRates` returns `STATIC_RATES` on Frankfurter 5xx/timeout/4xx; `getPrice` returns `PRICE_UNAVAILABLE` when both cache and fetch fail; the dashboard renders a number in both cases; `AssetForm` shows "Price unavailable" in the crypto-error case.
   - **Option B (new fallback flag)**: Phase 3 adds an `isFallback` field to `PriceResult` and a new `is_fallback` column to `crypto_price_cache`. `getPrice` would, on upstream failure, still return a cached price *if one exists at any age*, marked `isFallback: true`. This is a real feature add, not a test-only change, and probably belongs in a separate change folder (e.g. `feature/crypto-fallback-price`) with the test rollout following behind.

2. **Does Risk #6's "fallback entries not returned as authoritative" mean a flagged `is_fallback` cache row, or is the current silent-eviction behaviour the intended protection?**
   The current code: `crypto-prices.ts:122-123` evicts stale rows by returning `null`, which the caller treats as "no cache, fetch from upstream." A non-200 body is *never* written — the invariant holds by construction (the `if (!res.ok) return null` at `crypto-prices.ts:104` short-circuits before parse, so `upsertCache` is never called on a non-200 body). A test that asserts "the cache is never written from a non-200 body" is testable today (e.g. `vi.stubGlobal("fetch", ...)` returning 503, then assert `recorded` does not include `rpc("upsert_crypto_price_cache", ...)`).
   - The "fallback entries not returned as authoritative" intent is satisfied vacuously today — there are no fallback entries because there is no fallback write. If the team agrees this is the desired end state, the test is simply "no `rpc("upsert_crypto_price_cache")` call is made when fetch returns non-200."

3. **Should the "small integration on dashboard fallback render" test target `NetWorthDisplay` (the client-side `/api/rates` consumer) or `AssetForm` (the `/api/crypto-price` consumer)?**
   The plan wording implies the former ("dashboard still renders a number"), but the only observable fallback in the dashboard tree is the yellow `ratesError` banner — the number itself is unaffected. The most informative render-path test is on `AssetForm` because that is where the user-facing fallback text appears.
   - Recommendation: write the integration test on `AssetForm` (clear fallback text, single failure point), and on `NetWorthDisplay` write a smaller test that asserts the yellow banner appears on `/api/rates` failure. The dashboard's main number is already covered by the §6.1 reference test on `computeNetWorth` (Risk #1).

4. **Should the Phase 3 test author introduce a `vi.stubGlobal("fetch", ...)` helper (greenfield) or use `msw` (also greenfield, but heavier)?**
   The repo currently has neither. `vi.stubGlobal` is a 5-line pattern; `msw` is a real network shim with handlers. For two network surfaces (Binance, Frankfurter) and a handful of failure scenarios, `vi.stubGlobal` is the lower-friction choice. If the team prefers `msw` for symmetry with the future Phase 4+ work, that is a one-time install and a documented pattern in `test-plan.md §6.6`.

5. **Is the `sessionStorage` cache in `NetWorthDisplay` a feature to pin, or an implementation detail to ignore?**
   The current code reads `sessionStorage` first and short-circuits the fetch (line 122). A test that mocks `fetch` and asserts it was called will fail on the second page load in the same session. The test author should either `vi.stubGlobal("sessionStorage", ...)` or accept that the test only exercises the cold-cache path. Pinning the sessionStorage behaviour is a separate, smaller test.
