---
date: 2026-07-12T13:42:05+0200
researcher: maksymkozachuk
git_commit: eb2007b49ee512988c10521ce635a2e67bf6ff35
branch: feature/metal-price-fetch
repository: bitworth
topic: "S-19 precious-metals price fetch on asset entry (crypto S-03 mirror)"
tags: [research, codebase, metal-price-fetch, crypto-prices, cloudflare-workers, supabase, asset-form]
status: complete
last_updated: 2026-07-12
last_updated_by: maksymkozachuk
---

# Research: S-19 Precious-metals price fetch on asset entry

**Date**: 2026-07-12T13:42:05+0200
**Researcher**: maksymkozachuk
**Git Commit**: eb2007b49ee512988c10521ce635a2e67bf6ff35
**Branch**: feature/metal-price-fetch
**Repository**: bitworth

## Research Question

Ground the `metal-price-fetch` change (roadmap slice **S-19**): when a user adds/edits a `precious_metals` asset, auto-fetch the current gold/silver (XAU/XAG) spot price, convert it into the display currency, and auto-calculate value from a quantity in troy ounces — exactly as S-03 does for crypto. Establish (a) the precise S-03 pattern to mirror across schema, lib, API, form, and tests; and (b) which metals spot-price API to use, given the Cloudflare-Workers reachability trap S-03 hit.

**Scope decisions (confirmed with user):**
- **Metals API:** shortlist + recommend a keyless/free-key, Workers-reachable provider (done — see §5).
- **Refresh scope:** entry/edit-time only (strict S-03 clone). Background re-pricing of existing holdings is **explicitly deferred** — it touches the dashboard read path and is a separate slice.

## Summary

S-19 is a near-exact clone of the shipped S-03 crypto flow. Every surface has a direct template, and the `precious_metals` category is **already seeded** (`supabase/seed.sql:15`), so no category migration is needed. The work is: one column-add + one cache-table migration, a hand-edit to `database.types.ts`, a new `src/lib/metal-prices.ts` + `src/pages/api/metal-price.ts`, a new form branch in `AssetForm.tsx` (ideally an extracted shared component), display tweaks, and mirrored tests.

**The single most important finding:** the roadmap's account of the S-03 API decision is **stale and wrong**. The roadmap (`roadmap.md:395,427,432,453`) says "CoinGecko returns 403 from Workers → Binance was used." The shipped code + git history say the opposite: **Binance returns HTTP 451** (geo-block) from Workers, and **keyless CoinGecko returns 429** (shared datacenter-IP throttle) — the fix was a **free per-key CoinGecko Demo key sent via header**. The real, transferable lesson is: *prefer a keyed endpoint (per-key rate limiting) over keyless (shared-IP 429), watch for geo-blocks (451), and verify the chosen metals provider from the actual deployed Worker — not a browser.*

**Recommended metals API: metals.dev (#1)**, with **GoldAPI.io (#2)** as fallback. Both are free-key REST JSON, troy-oz/USD, no known geo-block. GoldAPI.io's **header-based** key (`x-access-token`) matches the project's established "key never lands in URLs/logs" pattern better than metals.dev's query-param key — a genuine tradeoff called out in Open Questions.

## Detailed Findings

### 1. Schema, migrations & types

**`assets` table** (`supabase/migrations/20260529190856_initial_schema.sql:28-39`):
- `crypto_symbol TEXT` — nullable, no default (`:35`).
- `quantity NUMERIC` — nullable, added later in the crypto-cache migration (`supabase/migrations/20260531223101_crypto_price_cache.sql:43`). **Reused as-is for troy-oz** — no new quantity column.

**`crypto_price_cache` + RPC** (`20260531223101_crypto_price_cache.sql`) is the exact template for `metal_price_cache`:
- Table (`:6-12`): `id UUID PK`, `coin_id TEXT NOT NULL UNIQUE`, `coin_symbol TEXT NOT NULL`, `price_usd NUMERIC(20,8) NOT NULL`, `fetched_at TIMESTAMPTZ DEFAULT NOW()`; index on symbol (`:14`).
- RLS: `ENABLE ROW LEVEL SECURITY` + **public** `FOR SELECT USING (true)` (`:16-19`) — global read-only financial data.
- Write path: `SECURITY DEFINER` RPC `upsert_crypto_price_cache(...)` with **`SET search_path = public`** (`:22-40`, `ON CONFLICT (coin_id) DO UPDATE`). The `search_path` is load-bearing (see lessons.md:81 — omit it and writes silently fail with "relation does not exist").

**`database.types.ts` is hand-written, NOT auto-generated.** `npx astro sync` (CLAUDE.md) regenerates Astro `.astro/` types, not Supabase types; there is no `gen types` script in `package.json`. The `supabase` CLI is available (`npx supabase gen types typescript --local`), but repo convention is to hand-edit. Shapes to add:
- `assets` Row/Insert/Update: `metal_symbol: string | null` (Row `src/lib/database.types.ts:127` mirrors `crypto_symbol`), `?: string | null` (Insert/Update).
- A `metal_price_cache` table block modeled on `crypto_price_cache` (`database.types.ts:175-198`).
- An `upsert_metal_price_cache` entry under `public.Functions` (mirror `:377-380`).

**Env var pattern** (`astro.config.mjs:18-24`): server secrets declared via `envField.string({ context: "server", access: "secret", optional: true })`, consumed via `import { X } from "astro:env/server"`. Add e.g. `METALS_API_KEY`. Prod also needs `wrangler secret put METALS_API_KEY --name bitworth` + the Cloudflare dashboard build env var (per CLAUDE.md), plus `.env`/`.dev.vars` locally.

**Migration naming:** `YYYYMMDDHHMMSS_snake_case.sql`, body wrapped in `BEGIN; … COMMIT;`. Next file e.g. `20260712120000_metal_price_cache.sql`. Column-add template: `20260619120000_assets_show_on_chart.sql`.

### 2. AssetForm crypto flow (the UX to mirror)

File: `src/components/assets/AssetForm.tsx`. Category ids are **literal string slugs**, so the branch is `categoryId === "crypto"` → for metals, `=== "precious_metals"`.

- **State** (`:30-33`): `cryptoSymbol`, `cryptoPrice: {price, isCached} | null`, `priceStatus: "idle"|"loading"|"success"|"cached"|"error"`, `quantity`.
- **Branch points**: validation skip `:44` (`if (categoryId !== "crypto")`), hide normal amount/currency `:124`, render crypto block `:194-311`.
- **Fetch trigger** = `onBlur` of the symbol field (`:208-243`): calls `/api/crypto-price?symbol=…`, sets status, and on success stores `{price, isCached}` and computes `amount`.
- **`amount = qty × price`** appears twice: the blur handler (`:231`) and — the primary path — the quantity field's `onChange` (`:274-282`). Rounding: `Math.round(qty * price * 100) / 100` (2 dp).
- **Status messages** (`:248-259`): "Fetching price…", "SYMBOL — $price (cached · age)", "Price unavailable".
- **Submit** is **form-native** (`new FormData(form)` at `:75`, no hand-built JSON). Crypto stores **`amount` in USD with a hidden `currency=USD`** (`:308`); the Total Value input is `readOnly name="amount"` (`:297-307`). On success, hard-nav to `/dashboard/assets`.
- **react-compiler compliance**: no `useMemo`/`useCallback`/`memo` anywhere; inline handlers + plain `useState` + functional updaters. The mirror must follow suit.

**⚠️ Latent bug to fix in the mirror:** `cachedAge` is returned by the API (`crypto-prices.ts:42-57`) but never stored in form state — `setCryptoPrice` only saves `{price, isCached}` (`:226,235`), so the "(cached · )" label at `:254` always renders an empty age. Store `cachedAge` in the price-state object for metals.

**Reusable extraction (roadmap-preferred):** the crypto block is 100% inline, zero factoring, with duplicated calc math. Recommended: extract a `src/components/assets/PricedQuantityFields.tsx` parameterized by `{ symbolFieldName, quantityLabel, priceEndpoint, symbolPlaceholder }`, lift state `:30-33` + JSX `:194-311`, and render it for both `crypto` and `precious_metals`. Broaden `:44` and `:124` via a `const isPriced = categoryId === "crypto" || categoryId === "precious_metals"` helper.

### 3. Display + API submit path

- **Converted value is currency-agnostic**: `AssetCard.tsx:19` / `AssetRow.tsx:19` run `convertAmount(asset.amount, asset.currency, displayCurrency, rates)`. Because metals store `amount` in USD, the primary value "just works."
- **Secondary "~{quantity} {symbol}" line is crypto-specific**: `AssetCard.tsx:40-53`, `AssetRow.tsx:44-57`, plus the orange-dot `CurrencyBadge.tsx:12-20`. If metals get a distinct `metal_symbol`, these need broadened conditions (and a badge variant); if metals reuse `crypto_symbol`, they render as crypto (orange dot) — visually OK, semantically odd.
- **Assets API is a fixed allow-list, not passthrough** — any new field must be threaded explicitly:
  - POST `src/pages/api/assets/index.ts:85-92` (read) + `:118-132` (insert).
  - PUT `src/pages/api/assets/[id]/index.ts:47-54` (read) + `:76-77` (crypto/quantity update).
- **Backup round-trip**: `src/lib/backup.ts:55` allowlist and the restore RPC migrations (`20260620120000_restore_backup_rpc.sql:111,124`, `20260711130000_restore_backup_pref_booleans.sql:109,122`) enumerate `crypto_symbol`/`quantity` column-by-column. A new `metal_symbol` column must be added there too or it won't survive export/import.

### 4. Test-mirroring recipe

Clone `src/lib/crypto-prices.test.ts` → `metal-prices.test.ts` and `src/pages/api/crypto-price.test.ts` → `api/metal-price.test.ts`.

- **Supabase mock**: `src/test-utils/supabase-mock.ts` (`createSupabaseMock`, `findCall`, `createCookiesStub`), reused as-is. Per-file `asClient` cast helper (`crypto-prices.test.ts:8`) — the `project_tsc_blocker_phase4` memory lesson. Cache rows injected via `tableResults: { metal_price_cache: { data: {...}, error: null } }`.
- **fetch stub**: `vi.stubGlobal("fetch", vi.fn())` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`; responses are real `Response` objects (200 success / 503 down / malformed-200).
- **Paths covered** (the `describe("getPrice")` block): fresh-cache-no-fetch, stale-cache-evict-and-fetch, 200-success-writes-cache, 503-no-write (`PRICE_UNAVAILABLE` + `context.upstreamStatus`), malformed-200-throws-no-write, and an `it.each` regression test asserting the **provider host** (`.toContain(...)`) and `.not.toContain("binance")`. **The metals test must assert its own provider host + `.not.toContain` the wrong one** — this is the regression guard that pins the reachability lesson.
- **Handler test**: `vi.hoisted` + `vi.mock` stubs both `@/lib/supabase` and `@/lib/metal-prices`; covers 401-no-cookie, 200-authed, 400-missing-symbol, 404-on-5xx/4xx. Handler maps `PRICE_UNAVAILABLE`/`*_NOT_FOUND` → 404, else 500 (`crypto-price.ts:50`).
- **Vitest config**: `vitest.config.ts` keeps `tsconfigPaths()` for `@/*` (lessons.md:35). Because the lib imports `astro:env/server`, there is an `astroEnvServerStub()` plugin (`vitest.config.ts:7-25`) — **a new `METALS_API_KEY` must be added to its exported list (`:17-21`)** or the test import fails to resolve.

### 5. Metals spot-price API (web research, July 2026)

Ranked for the constraints (server-side fetch from CF Workers, XAU+XAG in USD/troy-oz, ~1h server cache, keyless-or-free-key, no geo/legal block):

| Rank | Provider | Auth | Free tier | Unit/base | Both metals per call | Workers reachability |
|------|----------|------|-----------|-----------|----------------------|----------------------|
| **#1** | **metals.dev** | free key in **query param** | 100 req/mo, 60s delay | troy-oz, USD (170+ ccy) | **Yes** (`/v1/latest` → `metals.gold`+`metals.silver`) | No known geo-block; key isolates from shared-IP throttle (med-high) |
| **#2** | **GoldAPI.io** | free key in **header** `x-access-token` | 100 req/mo, 30-min cadence | troy-oz, USD | No (1 call per metal) | No known block; header-key matches project pattern (med-high) |
| #3 | metalpriceapi.com | free key (query) | 100 req/mo, daily only | troy-oz, USD | Yes (`currencies=XAU,XAG`) | keyed, no known block; **inverse-rate gotcha** (`1/rates.XAU`) |
| #3 | openexchangerates.org | key (query) | free = USD-base only, hourly | troy-oz, USD | Yes | keyed; workable if already used for FX |
| avoid | api-ninjas | key (header) | rotating **7 commodities/week** — gold+silver NOT guaranteed; batch is paid | troy-oz (futures, not spot) | reachable but free tier unusable for a metals app |
| avoid | metals-api.com | key (query) | minimal, poor cadence | troy-oz | APILayer-family throttling/reliability concerns |
| **avoid** | Yahoo (`GC=F`) / stooq | keyless (unofficial) | — | troy-oz | **ToS violation** + unstable datacenter-IP 429 — same trap class as Binance 451 |
| n/a | Frankfurter | keyless | unlimited | fiat only | **does NOT include XAU/XAG** — unusable |

**Response shape (metals.dev `/v1/latest?currency=USD&unit=toz`):**
```json
{ "status": "success", "currency": "USD", "unit": "toz",
  "metals": { "gold": 1923.86, "silver": 22.905, "platinum": 916.569 },
  "timestamp": "2023-07-05T08:02:02.640Z" }
```

**Free-quota nuance:** 100 req/mo is tight only under a naïve schedule. This app fetches **on demand at entry/edit time and caches globally** (cache keyed by metal, not per-user), so real call volume for a personal app is far below 100/mo. metals.dev's single-call-both-metals design is the most quota-efficient; if cadence ever grows, extend the cache TTL or take the $1.49/mo tier. **Reachability is medium-high, not certified — do a one-off curl-from-deployed-Worker smoke test before committing** (the S-03 lesson: datacenter-IP behavior only proves out from Workers egress).

## Code References

- `supabase/migrations/20260529190856_initial_schema.sql:28-39` — `assets` table; `crypto_symbol` at :35.
- `supabase/migrations/20260531223101_crypto_price_cache.sql:6-40` — cache table + `SECURITY DEFINER` upsert RPC (clone target); `:43` adds `assets.quantity`.
- `supabase/seed.sql:15` — `precious_metals` category (already seeded; id `"precious_metals"`).
- `src/lib/crypto-prices.ts:6-11,82-94,123-160` — `getPrice`, cache TTL, demo-key header, the "reachability truth" comments.
- `src/pages/api/crypto-price.ts:9-61` — auth-gated GET handler; error→status mapping at :50.
- `src/lib/exchange-rates.ts:3,46-86` — `Currency` union, `getRates(supabase)` (USD=1.0); metals convert via `priceUsd * rates[displayCurrency]`.
- `src/components/assets/AssetForm.tsx:30-33,44,124,194-311` — crypto state + branch + fetch/calc block; latent `cachedAge` bug at :254.
- `src/components/assets/AssetCard.tsx:19,40-53` / `AssetRow.tsx:19,44-57` / `CurrencyBadge.tsx:12-20` — display.
- `src/pages/api/assets/index.ts:85-132` / `[id]/index.ts:47-80` — allow-listed submit fields.
- `src/lib/backup.ts:55` + restore RPC migrations — backup column allowlist.
- `src/lib/database.types.ts:122-198,377-380` — assets/cache/RPC type shapes to extend.
- `astro.config.mjs:18-24` — server env schema (add `METALS_API_KEY`).
- `src/lib/crypto-prices.test.ts` / `src/pages/api/crypto-price.test.ts` / `src/test-utils/supabase-mock.ts` / `vitest.config.ts:7-25` — test recipe + env stub.

## Architecture Insights

- **Price layer stores USD only; display conversion is a separate, existing concern** (`exchange-rates.ts`). Never store display-currency in the cache — mirror crypto exactly.
- **Global cache + public-SELECT RLS + SECURITY-DEFINER write** is the canonical shape for non-user global data (shared with `exchange_rate_cache`, `/api/rates`). The `SET search_path = public` on the RPC is mandatory (lessons.md:81).
- **Assets API and backup RPCs are explicit allow-lists**, not passthrough — new columns must be threaded through form field-name, API read+write, and backup SQL, or they silently drop.
- **Keyed > keyless from Cloudflare Workers**: a per-key rate limit sidesteps the shared datacenter-IP throttle that produced CoinGecko's 429; a key is preferred even when the endpoint is nominally keyless.

## Historical Context (from prior changes)

- `context/archive/2026-05-31-crypto-price-fetch/` — the S-03 change. Git history on `src/lib/crypto-prices.ts` shows CoinGecko(keyless) → Binance → CoinGecko(demo key): commit `75b873c` "fetch from CoinGecko instead of geo-blocked Binance", `4b590d7` "CoinGecko demo key". The archive's own `plan.md`/`research.md` and the roadmap note are **stale** on this — trust the shipped code + git history.
- `roadmap.md:395,427,432,453` — the S-19 open-questions and S-03 "Done" note repeat the incorrect "CoinGecko 403 → Binance works" framing. **Correct it when planning.**
- MEMORY `project_tsc_blocker_phase4` — reuse the `asClient` cast helper for any SUT taking the full `SupabaseClient` (applies to `metal-prices.test.ts`).
- `context/foundation/lessons.md` — :81 (SECURITY DEFINER `search_path`), :35 (vitest `vite-tsconfig-paths`), :15 (public endpoints need an explicit auth decision — document the public `metal_price_cache` SELECT), :26 (Currency cast boundary — reuse the `as Currency` boundary if reading rows).

## Related Research

- `context/archive/2026-05-31-crypto-price-fetch/research.md` — original S-03 exploration (note: stale on the API-reachability conclusion).

## Open Questions

Framed for `/eon-plan` (each has a recommendation; the plan owns the final call):

1. **`metal_symbol` column vs reuse `crypto_symbol`.** New nullable `metal_symbol` = clean separation but costs a migration + threading through assets API (4 sites), display branches (5 sites), and **two backup RPCs**. Reusing `crypto_symbol`/`quantity` = zero migration/API change but leaks "crypto" semantics and renders metals with the crypto badge. **Recommendation:** add `metal_symbol` for a clean model, and budget the backup-RPC threading (else metals silently won't survive export/import).

2. **API pick: metals.dev vs GoldAPI.io.** metals.dev = one call returns both metals (quota-efficient) but the key rides in the **query string** (against the project's "key never in URLs/logs" convention, `crypto-prices.ts:9-10`). GoldAPI.io = **header** key matching that convention, but two calls (gold+silver) and 30-min freshness. **Recommendation:** GoldAPI.io if the header-key/no-URL-leak convention is treated as binding; metals.dev if call-efficiency wins. **Resolve with a deployed-Worker smoke test of the chosen provider before committing code** — reachability is medium-high, not certified.

3. **Static fallback prices?** Shipped crypto code returns `PRICE_UNAVAILABLE` (no static fallback), despite the plan mentioning statics. Decide deliberately whether metals should carry a static XAU/XAG fallback or mirror crypto's error-only behavior. **Recommendation:** mirror crypto (error + manual entry), keep the layer honest.

4. **Metal set for v1.** Gold (XAU) + Silver (XAG) only; platinum/palladium (XPT/XPD) are a trivial follow-up map entry. **Recommendation:** ship XAU/XAG, note the extension.

5. **Fix the `cachedAge` display bug in the mirror** (store `cachedAge` in price state) — and consider back-porting the fix to the crypto branch, or leave crypto untouched to keep the slice tight. **Recommendation:** fix in the new metals path; note the crypto back-port as optional cleanup.

6. **Symbol input: free-text (like crypto) vs a 2-option picker.** Crypto uses a free-text uppercased input; metals have exactly two symbols, so a dropdown/segmented control is more constrained and less error-prone. **Recommendation:** a small XAU/XAG picker rather than free text.
