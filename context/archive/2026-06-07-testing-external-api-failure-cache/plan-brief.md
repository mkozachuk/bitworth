# External API Failure & Cache Integrity — Plan Brief

> Full plan: `context/changes/testing-external-api-failure-cache/plan.md`
> Research: `context/changes/testing-external-api-failure-cache/research.md`

## What & Why

Phase 3 of the test plan ships tests that protect against two
failure scenarios: (1) external API failure breaking the dashboard UI
(Risk #4), and (2) the crypto price cache being poisoned by a non-200
upstream response (Risk #6). The motivation: both risks are anchored
in the recent rates/crypto rollout (roadmap §S-03) and the existing
code defends against them by *silence* — the "fallback" the plan
language describes is partly the existing `STATIC_RATES` return in
`getRates`, and partly the "no write" short-circuit in `crypto-prices.ts`.
Phase 3 pins both properties with tests.

## Starting Point

- `getRates` (`src/lib/exchange-rates.ts:46-86`) is defensively coded —
  a `try/catch` returns `STATIC_RATES` on any upstream failure. Risk #4's
  rates path is satisfied by construction.
- `getPrice` (`src/lib/crypto-prices.ts:137-168`) is not defensive — it
  returns `{ error: { code: "PRICE_UNAVAILABLE" } }` on upstream failure.
  The cache is never written from a non-200 body (the `if (!res.ok)
  return null` at line 104 short-circuits before `upsertCache` is
  reachable). Risk #6 protection is vacuously satisfied.
- Test infrastructure: vitest ^3.2.6, node environment, no DOM, no MSW,
  no `vi.stubGlobal("fetch", ...)` precedent. The existing test seam
  is `createSupabaseMock` at `src/test-utils/supabase-mock.ts` with
  per-table `tableResults` / `tableResultQueues` config.
- Established test shapes: the `vi.hoisted` + `vi.mock` pattern at
  `crypto-price.test.ts:9-22`; the documented `vi.mock("@/lib/exchange-rates")`
  exception at `snapshots/index.test.ts:25-28`.

## Desired End State

A future change that removes `getRates`'s `try/catch` (or, equivalently,
replaces `return { ...STATIC_RATES }` with `throw`) will fail the new
`exchange-rates.test.ts` scenarios. A future change that calls
`upsertCache(...)` from the `fetchedPrice === null` branch in `getPrice`
will fail the new `crypto-prices.test.ts` and `crypto-price.test.ts`
scenarios. After this plan lands, Risk #4 and Risk #6 are protected by
test coverage, and the `vi.stubGlobal("fetch", ...)` pattern is
documented for future rollout phases.

## Key Decisions Made

| Decision                       | Choice            | Why (1 sentence)  | Source           |
| ------------------------------ | ----------------- | ----------------- | ---------------- |
| Risk #6 scope                  | Option A: pin current behavior | No new `isFallback` field — the existing "no write on non-200" invariant is the protection. | Plan |
| Network shim                   | `vi.stubGlobal("fetch", vi.fn())` | 5-line pattern, no install, sufficient for two network surfaces. | Plan |
| Integration test target        | Extend `crypto-price.test.ts` (no DOM test) | Single failure point, deterministic; NetWorthDisplay test would need DOM tooling not in scope. | Plan |
| Failure surface coverage       | fetch throws + 5xx + 4xx + 200-malformed | Mirrors test-plan §2 "must challenge" column; covers DNS / timeout / rate limit / body corruption. | Plan |
| Phase shape                    | 2 phases (helper tests, then handler tests) | Clean separation; each phase independently testable and reviewable. | Plan |
| Cookbook sync                  | Add Phase 3 subsection to test-plan §6.6 | Documents the `vi.stubGlobal` precedent for future rollout phases. | Plan |

## Scope

**In scope:**
- New `src/lib/exchange-rates.test.ts` (4 scenarios on `getRates`)
- New `src/lib/crypto-prices.test.ts` (5 scenarios on `getPrice`)
- 2 new scenarios in `src/pages/api/crypto-price.test.ts` (5xx and 4xx)
- Cookbook sync: new Phase 3 subsection in `context/foundation/test-plan.md §6.6`

**Out of scope:**
- Adding `isFallback` / `isStale` fields to `PriceResult` or `crypto_price_cache`
  (would belong in a follow-up `feature/crypto-fallback-price` change)
- MSW or any other network-shim library
- NetWorthDisplay component tests (would require DOM tooling)
- Database migrations, schema changes, new env vars
- Refactoring `getPrice` to handle a stale-cache fallback

## Architecture / Approach

Phase 3 is test-only. No production code changes. The test files use
`createSupabaseMock` to control cache reads/writes, `vi.stubGlobal` to
control network responses, and the existing `vi.hoisted` +
`vi.mock("@/lib/<helper>", ...)` pattern for handler tests. The flow:

```
src/lib/<helper>.test.ts
  → createSupabaseMock (controls from("..._cache") reads + rpc() writes)
  → vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))  (controls network)
  → call getRates(client) / getPrice(client, symbol)
  → assert return shape + assert recorded rpc() calls (or absence thereof)

src/pages/api/crypto-price.test.ts (extension)
  → reuse existing vi.mock("@/lib/crypto-prices", ...)  (helper is mocked)
  → mocks.getPrice.mockResolvedValue({ error: ... })   (4xx/5xx shape)
  → call GET({ request, cookies })
  → assert response status + body + assert recorded rpc() absence
```

## Phases at a Glance

| Phase     | What it delivers       | Key risk                  |
| --------- | ---------------------- | ------------------------- |
| 1. Helper unit tests | 9 scenarios across `exchange-rates.test.ts` and `crypto-prices.test.ts`; introduces the `vi.stubGlobal("fetch", ...)` pattern. | Date.now() staleness calculations off-by-one if `fetched_at` is set wrong; the cache eviction tests must use `Date.now() - 7200 * 1000`. |
| 2. Handler integration extension | 2 new scenarios in `crypto-price.test.ts` pinning the 4xx/5xx → 404 `PRICE_UNAVAILABLE` mapping AND the structural property that no `rpc("upsert_crypto_price_cache", ...)` is recorded. Plus the test-plan §6.6 cookbook sync. | Forgetting to assert the structural property (just asserting response status) would miss Risk #6 — the test passes the day someone adds a bad write. |

**Prerequisites:** None. Phase 1 starts immediately. Phase 2 depends on
Phase 1's pattern being in place (or the author can start fresh — the
handler test mocks `getPrice` at the module level, so it does not depend
on the helper test files).

**Estimated effort:** ~1 short session for both phases. Phase 1 is the
larger of the two (9 scenarios, two new files, the greenfield pattern).
Phase 2 is mechanical (2 scenarios + a doc sync).

## Open Risks & Assumptions

- **Assumption**: the `createSupabaseMock` factory's `tableResults` config
  is sufficient for the cache read scenarios in Phase 1 (no test needs
  `tableResultQueues`). If a test turns out to need the same table awaited
  multiple times in a single `getPrice` call, the factory's queue API is
  ready (`supabase-mock.ts:65-66, 130-131`).
- **Assumption**: the `vi.stubGlobal` pattern does not interfere with the
  handler test's existing `vi.mock("@/lib/crypto-prices", ...)` — the
  handler does not call `fetch` directly, so no fetch stub is needed in
  the handler test. Confirmed by reading `crypto-price.ts:48`
  (`const result = await getPrice(supabase, symbol);` — only `getPrice`
  is called; the `fetch` lives inside `crypto-prices.ts`).
- **Risk**: if the team later decides the Option B `isFallback` feature
  is needed, this plan does not deliver it. The follow-up is its own
  change folder; the test-plan §2 row #6 wording will need to be updated
  in a `--refresh` cycle.

## Success Criteria (Summary)

- `npm run test:run` exits 0 with 11 new scenarios passing (9 helper + 2 handler).
- `npm run lint` and `npx tsc --noEmit` exit 0.
- `git grep "vi.stubGlobal"` shows the new helper test files as the only matches.
- The structural property (no `rpc("upsert_crypto_price_cache", ...)` on fetch failure) is asserted in **both** the helper test (`crypto-prices.test.ts`) AND the handler test (`crypto-price.test.ts`), so Risk #6 protection fails closed from either side.
