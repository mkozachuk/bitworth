---
change_id: testing-external-api-failure-cache
title: External API failure & cache integrity
status: shipped
created: 2026-06-07
updated: 2026-06-07
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "External API failure & cache integrity".
Risks covered: #4 (external API failure with broken UI — fetch 4xx/5xx/timeout returns blank/NaN/crash instead of cached or documented fallback), #6 (crypto price cache poisoned by upstream 4xx — a non-200 body is written into the cache and read back as authoritative).
Test types planned: unit (with `fetch` stub) for the rates/crypto fetcher + cache read/write; small integration on dashboard fallback render.
Risk response intent:
- Risk #4: prove that when rates/crypto fetch returns 4xx/5xx/timeout, the app uses the cached value (or a documented fallback) and the dashboard still renders a number. Challenge "it worked in staging" — failures include timeouts, DNS errors, rate limits, 4xx, and 200-with-malformed-body. Avoid testing only the happy path.
- Risk #6: prove that when the upstream returns 4xx/5xx, the cache either does not write a new entry or writes one explicitly marked as fallback, and that fallback entries are not returned as authoritative on read. Challenge "we got a response, we cached it" — 4xx bodies are not prices. Avoid stubbing the fetch to return a successful price and asserting the cache is populated.
Hot-spot directories that raised these risks (likelihood evidence — NOT anchors): src/lib/ (rates + crypto helpers), supabase/migrations/ (crypto_price_cache schema).
Stack: Vitest ^3.2.6, MSW TBD per §4. crypto-price.test.ts already exists at src/pages/api/crypto-price.test.ts (3 scenarios per §6.6 scope addendum) — review it as the established shape; Phase 3 may add scenarios and a dedicated cache module test.
