# External API Failure & Cache Integrity — Phase 3 Implementation Plan

## Overview

Ship test-plan Phase 3: unit tests on the rates/crypto fetchers and cache
read/write for failure paths, plus a small extension to the existing
`/api/crypto-price` integration test. Protects Risk #4 (external API failure
breaking the dashboard) and Risk #6 (crypto cache poisoned by upstream 4xx).
The team's decision: pin current behavior (no new `isFallback` field), and
introduce the `vi.stubGlobal("fetch", ...)` pattern as the greenfield network
shim for this repo.

## Current State Analysis

- **`getRates` (`src/lib/exchange-rates.ts:46-86`)** is already defensively
  coded: the whole function is wrapped in `try/catch` that returns
  `STATIC_RATES` (`exchange-rates.ts:83-85`). All Frankfurter 4xx/5xx/timeout
  / DNS / malformed-body failures converge to a usable number. Risk #4's
  rates path is satisfied by construction; Phase 3 pins it.
- **`getPrice` (`src/lib/crypto-prices.ts:137-168`)** is not defensive.
  Upstream failure returns `{ error: { code: "PRICE_UNAVAILABLE" } }`. The
  "cache never written from a non-200 body" invariant holds by construction
  via `if (!res.ok) return null` at `crypto-prices.ts:104` (short-circuits
  before `upsertCache` is reachable). Risk #6 protection is *vacuously
  satisfied* today — there are no fallback entries because there is no
  fallback write path. Phase 3 pins the absence of a poisoned write.
- **`PriceResult` interface (`crypto-prices.ts:34-39`)** has no `isFallback`
  / `isStale` / `source` field. The `crypto_price_cache` schema
  (`migrations/20260531223101_crypto_price_cache.sql:6-12`) has no
  `is_fallback` column. **No new fields are added in this plan** — Option A
  decision.
- **Test infrastructure**: vitest ^3.2.6, `environment: "node"`, no DOM, no
  MSW, no `vi.stubGlobal("fetch", ...)` precedent. Phase 3 introduces the
  fetch-stub pattern. The shared `createSupabaseMock` factory
  (`src/test-utils/supabase-mock.ts`) handles `from("crypto_price_cache")`
  and `from("exchange_rate_cache")` via the generic `tableResults` config —
  no factory change needed.
- **Established test shapes** to reuse:
  - `vi.hoisted` + `vi.mock("@/lib/supabase", ...)` + `vi.mock("@/lib/<helper>", ...)` — `src/pages/api/crypto-price.test.ts:9-22`
  - `vi.mock("@/lib/exchange-rates", ...)` documented exception — `src/pages/api/snapshots/index.test.ts:25-28` (per test-plan §6.2)
- **The dashboard's number is always rendered.** The yellow `ratesError`
  banner in `NetWorthDisplay.tsx:190` is the only observable client-side
  fallback for Risk #4's rates path. Server-side `getRates` always succeeds
  (defensive `try/catch`), so the total is unaffected by upstream failure.
  Risk #4's crypto fallback render lives on `AssetForm`, not the dashboard
  (`AssetForm.tsx:250-258`, the `error` status renders "Price unavailable").
  The plan does NOT add a NetWorthDisplay integration test — research
  showed the integration-test target with the most signal is the
  `/api/crypto-price` handler (single failure point, deterministic).

## Desired End State

A second `npm run test:run` invocation that exercises the failure paths the
team cares about — Frankfurter 4xx/5xx/timeout/200-malformed for rates,
Binance 4xx/5xx/timeout/200-malformed for crypto, plus the cache
write/no-write invariant on crypto. After this plan lands, Risk #4 is
protected by tests that fail the day `getRates`'s `try/catch` is removed, and
Risk #6 is protected by tests that fail the day anyone writes
`upsertCache(supabase, ...)` from the `fetchedPrice === null` branch.

### Key Discoveries:

- The "must challenge" column in test-plan §2 row #4 is satisfied vacuously
  by the existing `getRates` defensive code. Pinning it requires asserting
  the `try/catch` return path, not adding fallback behavior.
- The "must challenge" column in test-plan §2 row #6 is satisfied vacuously
  by the existing `crypto-prices.ts:104` short-circuit. Pinning it requires
  asserting the *absence* of an `rpc("upsert_crypto_price_cache", ...)` call
  on non-200, not adding a fallback flag.
- The `vi.stubGlobal("fetch", ...)` pattern is greenfield — Phase 3 ships
  the precedent for the next rollout phase that needs network shimming.
- The `exchange-rates` upsert writes 6 `(base, target)` pairs
  (`exchange-rates.ts:68-76`) on every successful fetch, including self-pairs
  (`EUR→EUR = 1.0`). A test asserting "fetching rates writes a single cache
  row" is wrong — it writes six.

## What We're NOT Doing

- **Adding `isFallback` / `isStale` fields** to `PriceResult` or
  `crypto_price_cache` (Option B). Out of scope per the Open Question
  resolution in this plan; if desired, a follow-up change folder
  (`feature/crypto-fallback-price`) will own that work.
- **Adding a NetWorthDisplay component test** (no DOM tooling; the
  ratesError banner path is pinned by the `/api/crypto-price` integration
  test on the consumer side indirectly — a future phase can add DOM tooling
  and target the banner directly).
- **Stubbing `fetch` via MSW.** The `vi.stubGlobal` pattern is sufficient
  for two network surfaces and a handful of failure scenarios; MSW is
  heavier than the problem and would expand Phase 3 beyond the test-only
  contract. Re-evaluate when a third network surface ships.
- **Adding new test infrastructure files** (e.g. `src/mocks/`). The
  `vi.stubGlobal` pattern lives inline in `beforeEach`/`afterEach` for now.
- **Refactoring `getPrice` to handle a stale-cache fallback.** The current
  silent eviction is the chosen behavior; Phase 3 pins it, doesn't change
  it.
- **Tackling other risks from the test plan.** Risks #1, #2, #3, #5 are
  covered by Phases 1 and 2. Risk #4 and #6 are the only Phase 3 targets.

## Implementation Approach

Two phases, each a single commit:

1. **Phase 1 — helper unit tests** (new files). Establishes the
   `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))` pattern with
   `vi.unstubAllGlobals()` cleanup. Covers `getRates` defensive fallback
   and `getPrice` cache + fetch failure paths end-to-end through the
   orchestrators. Test count: 4 scenarios on `getRates`, 5 scenarios on
   `getPrice` (per the Phase 1 split: the orchestrator scenarios that
   exercise the cache `from(...)` chain through `createSupabaseMock`'s
   `tableResults`).
2. **Phase 2 — handler integration test extension.** Reuses the
   `vi.hoisted` + `vi.mock("@/lib/crypto-prices", ...)` pattern at
   `src/pages/api/crypto-price.test.ts:9-22`. Adds 2 scenarios that stub
   `fetch` to return 4xx and 5xx, asserting (a) the handler returns 404
   `PRICE_UNAVAILABLE` and (b) `recorded` does not contain an
   `rpc("upsert_crypto_price_cache", ...)` call. This is the structural
   pin for Risk #6 at the handler boundary.

The cookbook sync to `context/foundation/test-plan.md §6.6` is the closing
mechanic for Phase 2 — adds a "Phase 3" subsection documenting the
`vi.stubGlobal("fetch", ...)` pattern so future rollout phases have a
precedent. This edit lands in the same Phase 2 commit.

## Critical Implementation Details

- **`vi.stubGlobal` lifecycle**: declare the stub in `beforeEach` with
  `vi.stubGlobal("fetch", vi.fn())`. Clean up in `afterEach` with
  `vi.unstubAllGlobals()`. The global is reset between tests by Vitest, but
  `unstubAllGlobals` is the documented hygiene step and prevents leaks if
  a test in the file throws mid-stub.
- **Mocking strategy for the rate helper**: `getRates` is async and
  internally orchestrates two `from(...)` reads (`exchange_rate_cache`
  `EUR→USD` and `EUR→PLN`) plus a `fetch` and a 6-pair `Promise.all`
  upsert. Tests pre-populate the cache fast-path via `tableResults` (returning
  `null` for both `exchange_rate_cache` rows triggers the fetch path; returning
  fresh rows triggers the cache fast-path and short-circuits fetch). Use
  `createSupabaseMock`'s `tableResults` for the simple cases; only reach
  for `tableResultQueues` if a test needs the same table awaited multiple
  times (Phase 1's rate tests do not need this).
- **`Date.now()` in cache age checks**: `getCachedPrice` and `getCachedRate`
  use `Date.now()` against the `fetched_at` value from the cache row. Tests
  that exercise the "fresh cache hit" scenario must set `fetched_at` to
  the current ISO string (or near-future); tests that exercise the "stale
  eviction" path must set `fetched_at` to > 3600s ago. Use `new Date(
  Date.now() - 7200 * 1000).toISOString()` for the stale case.
- **Auth/route exemption awareness**: `src/pages/api/rates.ts:5-6` is
  intentionally unauthenticated; `crypto-price.ts:9-32` requires auth. The
  Phase 2 handler test for `/api/crypto-price` already has the auth stub
  at `crypto-price.test.ts:37-53` (test name: "returns the cached price on
  authenticated request"). The new scenarios reuse the same `Cookie:
  "sb-access-token=fake"` header.
- **No new dependencies**. The `vi.stubGlobal` pattern uses vitest's built-in
  API only. No `npm install` in this plan.

## Phase 1: Helper unit tests (rates + crypto)

### Overview

Create `src/lib/exchange-rates.test.ts` and `src/lib/crypto-prices.test.ts`.
Both files introduce the `vi.stubGlobal("fetch", vi.fn())` pattern for this
repo, using `createSupabaseMock` to control cache reads/writes. Total
scenarios: 4 on `getRates`, 5 on `getPrice` (9 scenarios across two files).

### Changes Required:

#### 1. New helper test file: `src/lib/exchange-rates.test.ts`

**File**: `src/lib/exchange-rates.test.ts`

**Intent**: Pin the defensive `try/catch` fallback in `getRates` (Risk #4's
rates path) and the cache fast-path optimization. Each scenario stubs
`fetch` via `vi.stubGlobal` and pre-populates `createSupabaseMock` cache
reads via `tableResults`.

**Contract**: Four scenarios, each one a test case in a single
`describe("getRates", ...)` block:

- `returns STATIC_RATES when fetch throws` — `fetch` rejected with
  `new Error("network down")`; both `exchange_rate_cache` reads return
  `null` (cache empty). Assert result `toEqual({ USD: 1.0, EUR: 0.92, PLN: 3.85 })`.
- `returns STATIC_RATES when fetch returns 503` — `fetch` resolves to
  `Response` with status 503; cache empty. Same assertion.
- `returns STATIC_RATES when fetch returns 200 with malformed body` —
  `fetch` resolves to `new Response("not json", { status: 200 })`. Same
  assertion.
- `skips fetch when both EUR→USD and EUR→PLN are cached and fresh` — cache
  returns `{ data: { rate: 0.92, fetched_at: <now> }, error: null }` for
  both reads; `fetch` is stubbed but **must not be called**. Assert via
  `(fetch as ReturnType<typeof vi.fn>).mock.calls.length === 0`. Assert
  result `toEqual({ USD: 1.0, EUR: 1/0.92, PLN: <derived> })`.

No `vi.mock("@/lib/supabase", ...)` needed for these tests — the helper
imports `SupabaseClient` as a *type* (`exchange-rates.ts:1` is
`import type { SupabaseClient }`). The mock factory's `client` is passed
in directly to `getRates(client)`.

Setup/teardown:

- `beforeEach`: `vi.stubGlobal("fetch", vi.fn())`.
- `afterEach`: `vi.unstubAllGlobals()`.

#### 2. New helper test file: `src/lib/crypto-prices.test.ts`

**File**: `src/lib/crypto-prices.test.ts`

**Intent**: Pin the `getPrice` orchestrator's failure paths and the
cache write invariant for Risk #4 (crypto path) and Risk #6 (cache not
poisoned). Five scenarios covering the cache hit, stale eviction,
fetch success → write, and two fetch failure modes that must not write.

**Contract**: Five scenarios in a `describe("getPrice", ...)` block:

- `returns cached price when fresh cache row exists` — `crypto_price_cache`
  returns `{ data: { price_usd: 50000, fetched_at: <now> }, error: null }`;
  result `toEqual({ price: 50000, isCached: true, fetchedAt: <now>, cachedAge: "0s ago" })`.
  Stub `fetch` and assert it was NOT called.
- `silently evicts stale cache row and fetches` — `crypto_price_cache`
  returns row with `fetched_at: <2 hours ago>`; `fetch` resolves to a
  valid 200 body with price `50000`. Assert result `isCached: false` and
  `fetch` was called once.
- `fetches and writes cache on 200 success` — `crypto_price_cache` read
  returns `null`; `fetch` resolves to 200 with price `50000`; `upsertCache`
  calls `supabase.rpc("upsert_crypto_price_cache", ...)`. Assert
  `findCall(recorded, "rpc", ["upsert_crypto_price_cache", { p_coin_id: "bitcoin", p_coin_symbol: "BTC", p_price_usd: 50000 }])`
  returns a match.
- `does not write cache when fetch returns 503` — `crypto_price_cache` read
  returns `null`; `fetch` resolves to 503. Assert result
  `toEqual({ error: { code: "PRICE_UNAVAILABLE", ... } })` and
  `recorded.filter((c) => c.method === "rpc").length === 0`.
- `does not write cache when fetch returns 200 with malformed body` —
  `crypto_price_cache` read returns `null`; `fetch` resolves to 200 with
  body `"not json"`. Same assertions as the 503 case.

No `vi.mock("@/lib/supabase", ...)` needed (type-only import, same as
exchange-rates). Pass the mock factory's `client` directly to `getPrice(client, "BTC")`.

Setup/teardown: same `vi.stubGlobal` pattern as the rates test file.

### Success Criteria:

#### Automated Verification:

- `npm run test:run` exits 0; the new tests appear in output
  (`src/lib/exchange-rates.test.ts`, `src/lib/crypto-prices.test.ts`).
- The 9 new scenarios pass on first run.
- `npm run lint` exits 0.
- `npx tsc --noEmit` exits 0 (type checks on the new test files).
- `git grep "vi.stubGlobal"` shows the new files as the only matches
  under `src/` (precedent for future rollout phases).

#### Manual Verification:

- Open `src/lib/exchange-rates.test.ts` and `src/lib/crypto-prices.test.ts`;
  confirm the scenarios match the `## Phase 1: Success Criteria` contract
  above (one test per bullet, in the order listed).
- Run `npx vitest run src/lib/exchange-rates.test.ts` and
  `npx vitest run src/lib/crypto-prices.test.ts` separately; confirm each
  file is independently runnable.
- Eyeball the `beforeEach`/`afterEach` blocks: `vi.stubGlobal` and
  `vi.unstubAllGlobals` must be present and paired.

---

## Phase 2: Handler integration test extension

### Overview

Extend `src/pages/api/crypto-price.test.ts` with two new scenarios that
exercise the handler's behavior when the upstream returns 4xx and 5xx.
This pins Risk #4 (crypto path) and Risk #6 (handler does not invoke the
cache write RPC) at the request boundary. Closes with a cookbook sync to
`context/foundation/test-plan.md §6.6` documenting the `vi.stubGlobal`
precedent for future rollout phases.

### Changes Required:

#### 1. Extend `src/pages/api/crypto-price.test.ts`

**File**: `src/pages/api/crypto-price.test.ts`

**Intent**: Add two new `it(...)` blocks to the existing
`describe("GET /api/crypto-price", ...)` block (currently 3 scenarios, lines
27-65). Reuse the existing `vi.hoisted` factory at lines 9-22; stub `fetch`
via `vi.stubGlobal` in the new test bodies only.

**Contract**:

- `returns 404 PRICE_UNAVAILABLE when fetch returns 5xx` — set up
  `mocks.getPrice.mockResolvedValue({ error: { code: "PRICE_UNAVAILABLE", message: "..." } })`
  (the helper-level test in Phase 1 owns the "fetch returns 5xx →
  `getPrice` returns the error" assertion; this handler-level test asserts
  the mapping). Request has the `Cookie` header. Assert response
  `status === 404` and body JSON contains `error.code === "PRICE_UNAVAILABLE"`.
  Assert `m.client` was used but **no** `rpc("upsert_crypto_price_cache", ...)`
  call was recorded (assert against `m.recorded`).
- `returns 404 PRICE_UNAVAILABLE when fetch returns 4xx` — same shape as
  the 5xx case. Helper returns `{ error: { code: "PRICE_UNAVAILABLE" } }`.
  Assert 404, no cache write RPC.

Use the existing `mocks.factory = () => m` reassignment at the top of
each test (matches lines 29-30, 39-40, 56-57). The 2 new tests each create
a fresh `createSupabaseMock({ userId: "user-A" })` so `m.recorded` is
isolated per test.

No new `vi.mock` declarations — the existing `vi.mock("@/lib/crypto-prices", ...)`
at lines 20-22 already routes `getPrice` to the test-controlled `mocks.getPrice`.
The handler does not call `fetch` directly; the fetch stub lives in
`crypto-prices.ts`, which the handler does not exercise in this test
(file under test is the handler, not the helper — the helper is mocked).

#### 2. Cookbook sync: `context/foundation/test-plan.md`

**File**: `context/foundation/test-plan.md`

**Intent**: Document the `vi.stubGlobal("fetch", ...)` pattern in §6.6 as
the established network shim for future rollout phases. The current §6.6
ends at line 146 (Phase 2 section). Add a new **Phase 3** subsection
below it.

**Contract**: A new `### Phase 3` subsection with two paragraphs:

- One paragraph explaining the pattern: `vi.stubGlobal("fetch", vi.fn(...))`
  in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`. The pattern was
  introduced by Phase 3 of this change folder; it is the precedent for any
  future test that needs to control network responses.
- One paragraph linking to the helper test files as the reference
  implementation: `src/lib/exchange-rates.test.ts` (4 scenarios on
  `getRates`) and `src/lib/crypto-prices.test.ts` (5 scenarios on
  `getPrice`).

No other §6.6 changes. The "documented exception" at §6.2 for
`vi.mock("@/lib/exchange-rates", ...)` is unchanged. The §6.6 change
preserves the existing Phase 2 block verbatim.

### Success Criteria:

#### Automated Verification:

- `npm run test:run` exits 0; total scenario count for
  `crypto-price.test.ts` is now 5 (3 existing + 2 new).
- `npm run lint` exits 0.
- `npx tsc --noEmit` exits 0.
- `git grep "vi.stubGlobal"` still shows only the two helper test files
  (handler test does not need its own `vi.stubGlobal` — `getPrice` is
  mocked at the module level).

#### Manual Verification:

- Run `npx vitest run src/pages/api/crypto-price.test.ts`; confirm the 5
  scenarios run and pass in < 1 second.
- Eyeball the new scenarios: each must assert both the response shape
  (`status === 404`, body contains `error.code === "PRICE_UNAVAILABLE"`)
  AND the structural property (`recorded` has no
  `rpc("upsert_crypto_price_cache", ...)` call).
- Open `context/foundation/test-plan.md`; confirm §6.6 has a new
  "Phase 3" subsection below the existing "Phase 2" block, with the
  two paragraphs described in the contract above.
- Confirm no other sections of the test plan were modified.

---

## Testing Strategy

### Unit Tests:

- **`src/lib/exchange-rates.test.ts`** — 4 scenarios on `getRates`:
  fetch throws, fetch 503, fetch 200-malformed, cache fast-path skip.
- **`src/lib/crypto-prices.test.ts`** — 5 scenarios on `getPrice`:
  fresh cache hit, stale eviction + fetch, fetch success + cache write,
  fetch 503 + no cache write, fetch 200-malformed + no cache write.

### Integration Tests:

- **`src/pages/api/crypto-price.test.ts`** (extension) — 2 new scenarios:
  5xx → 404 `PRICE_UNAVAILABLE` + no cache write RPC; 4xx → same.

### Manual Testing Steps:

1. Read `src/lib/exchange-rates.test.ts` and `src/lib/crypto-prices.test.ts`;
   confirm scenarios match the `## Phase 1: Success Criteria` contract.
2. Run `npm run test:run` after each phase; confirm 0 failures.
3. Eyeball the new `vi.stubGlobal` lifecycle (`beforeEach` / `afterEach`
   pairing).
4. Eyeball the handler test extension; confirm the two new scenarios
   both assert the structural property (no cache write RPC) — not just
   the response status.
5. Eyeball the test-plan §6.6 cookbook sync; confirm only §6.6 was
   modified, and the new "Phase 3" subsection is below the existing
   "Phase 2" block.

## Performance Considerations

- `vi.stubGlobal("fetch", ...)` is a global override, reset by
  `vi.unstubAllGlobals()` per test. No measurable overhead at the test
  count this plan introduces (11 new scenarios).
- The handler test does not need its own `vi.stubGlobal` because
  `getPrice` is mocked at the module level — the test author must
  remember to not accidentally stub `fetch` in the handler file
  (would be a no-op, but pollutes the lifecycle).

## Migration Notes

- No database migration. No schema change. No new env vars.
- The `crypto_price_cache` table, `exchange_rate_cache` table, and
  `upsert_crypto_price_cache` RPC remain untouched. Phase 3 is
  test-only.

## References

- Test plan: `context/foundation/test-plan.md` (§2 risk rows #4, #6; §3
  Phase 3 row; §6.2 mock-internal-modules exception; §6.6 to be extended)
- Research: `context/changes/testing-external-api-failure-cache/research.md`
- Lessons: `context/foundation/lessons.md` (§Vite-tsconfig-paths is
  satisfied by current `vitest.config.ts`; no new lessons triggered)
- Load-bearing source files: `src/lib/exchange-rates.ts`,
  `src/lib/crypto-prices.ts`, `src/pages/api/crypto-price.ts`,
  `src/pages/api/rates.ts`
- Established test seams: `src/test-utils/supabase-mock.ts`,
  `src/pages/api/crypto-price.test.ts:9-22`,
  `src/pages/api/snapshots/index.test.ts:25-28`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Helper unit tests (rates + crypto)

#### Automated

- [x] 1.1 Create `src/lib/exchange-rates.test.ts` with 4 scenarios on `getRates` — 18207c1
- [x] 1.2 Create `src/lib/crypto-prices.test.ts` with 5 scenarios on `getPrice` — 18207c1
- [x] 1.3 `npm run test:run` passes (9 new scenarios + all existing) — 18207c1
- [x] 1.4 `npm run lint` passes — 18207c1
- [x] 1.5 `npx tsc --noEmit` passes — 18207c1
- [x] 1.6 `git grep "vi.stubGlobal"` shows only the two new files under `src/` — 18207c1

#### Manual

- [x] 1.7 Eyeball scenario coverage matches Phase 1 contract — 18207c1
- [x] 1.8 Eyeball `beforeEach`/`afterEach` lifecycle pairs the `vi.stubGlobal` / `vi.unstubAllGlobals` — 18207c1

### Phase 2: Handler integration test extension

#### Automated

- [x] 2.1 Extend `src/pages/api/crypto-price.test.ts` with 2 new scenarios (5xx and 4xx) — 4e9d26c
- [x] 2.2 `npm run test:run` passes (5 scenarios in `crypto-price.test.ts`) — 4e9d26c
- [x] 2.3 `npm run lint` passes — 4e9d26c
- [x] 2.4 `npx tsc --noEmit` passes — 4e9d26c
- [x] 2.5 Add Phase 3 subsection to `context/foundation/test-plan.md` §6.6 — 4e9d26c

#### Manual

- [x] 2.6 Eyeball new scenarios assert both response shape AND structural property — 4e9d26c
- [x] 2.7 Eyeball test-plan §6.6 modification is additive (Phase 2 block unchanged) — 4e9d26c
