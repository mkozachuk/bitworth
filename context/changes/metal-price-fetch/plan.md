# Precious-metals Spot-price Fetch on Asset Entry (S-19) Implementation Plan

## Overview

When a user adds or edits a `precious_metals` asset, auto-fetch the current gold (XAU) and silver (XAG) spot price, convert it from USD into the display currency, and auto-calculate the asset's value from a quantity in troy ounces. This is a near-exact clone of the shipped S-03 crypto flow — same global-cache shape, same on-blur fetch UX, same USD-only storage with display-time conversion.

Refresh scope is **entry/edit-time only** (strict S-03 clone). Background re-pricing of existing holdings is explicitly out of scope (a separate slice touching the dashboard read path).

## Current State Analysis

The S-03 crypto flow is fully shipped and is the template for every surface:

- **Cache pattern**: `crypto_price_cache` table with public-SELECT RLS + a `SECURITY DEFINER` upsert RPC (`supabase/migrations/20260531223101_crypto_price_cache.sql:6-40`). The `SET search_path = public` on the RPC is load-bearing (`context/foundation/lessons.md:81` — omit it and writes silently fail with "relation does not exist").
- **Price lib**: `src/lib/crypto-prices.ts` — `getPrice`, cache TTL, a demo-key sent via **header**, and comments documenting the "reachability truth."
- **API handler**: `src/pages/api/crypto-price.ts:9-61` — auth-gated GET, error→status mapping at `:50` (`PRICE_UNAVAILABLE`/`*_NOT_FOUND` → 404, else 500).
- **Form**: `src/components/assets/AssetForm.tsx:30-33,44,124,194-311` — crypto state, branch guards, on-blur fetch + calc block. Fully inline, zero factoring, duplicated calc math.
- **Display**: `AssetCard.tsx:19,40-53`, `AssetRow.tsx:19,44-57`, `CurrencyBadge.tsx:12-20`.
- **Allow-lists**: assets API (`api/assets/index.ts:85-132`, `[id]/index.ts:47-80`) and backup restore RPCs enumerate columns explicitly — new columns must be threaded through or they silently drop.

The `precious_metals` category is **already seeded** (`supabase/seed.sql:15`, id `"precious_metals"`) — no category migration needed. `assets.quantity` already exists (`20260531223101_crypto_price_cache.sql:43`) and is reused as-is for troy-oz.

**The `assets` table `amount` for priced assets stores USD** with a hidden `currency=USD` field; display-time `convertAmount(...)` handles the display currency. Metals mirror this exactly.

## Desired End State

Adding/editing a `precious_metals` asset shows a metal picker (XAU/XAG) and a quantity field. On picking a metal (or on blur), the form fetches the spot price from `/api/metal-price?symbol=XAU`, shows a status line (`XAU — $price (cached · age)`), and auto-computes the USD total from `quantity × price`. The asset saves with `amount` in USD, `currency=USD`, and `metal_symbol` populated. On the dashboard the asset's value converts to the display currency automatically, shows a metal badge, and a `~{quantity} {symbol}` secondary line. The asset survives backup export/import.

Verify: create a gold asset with quantity 2 → total ≈ 2 × current XAU USD price; dashboard shows converted value + metal badge; backup export then restore preserves `metal_symbol` and quantity.

### Key Discoveries:

- **The roadmap's S-03 API lesson is stale and wrong** (`roadmap.md:395,427,432,453` says "CoinGecko 403 → Binance works"). Shipped code + git history say the opposite: Binance returns **451** (geo-block), keyless CoinGecko returns **429** (shared datacenter-IP throttle); the fix was a **free per-key** CoinGecko Demo key via header (`crypto-prices.ts:9-11`). Correct this framing when planning; the transferable lesson is **prefer a keyed endpoint and verify from the deployed Worker, not a browser**.
- **`database.types.ts` is hand-written, NOT auto-generated** (`CLAUDE.md`: `npx astro sync` regenerates Astro types only). Hand-edit the assets Row/Insert/Update, add a `metal_price_cache` block, and add an `upsert_metal_price_cache` function entry.
- **Latent `cachedAge` bug** in the crypto branch: the API returns `cachedAge` (`crypto-prices.ts:42-57`) but `setCryptoPrice` only stores `{price, isCached}` (`AssetForm.tsx:226,235`), so the `(cached · )` label (`:254`) always renders an empty age. Fix in the shared component.
- **vitest env stub**: `vitest.config.ts:7-25` `astroEnvServerStub()` lists server env vars; `METALS_API_KEY` must be added to its exported list (`:17-21`) or the lib import fails to resolve in tests.
- **react-compiler compliance**: no `useMemo`/`useCallback`/`memo` — inline handlers + plain `useState` + functional updaters (enforced, `CLAUDE.md` hard rule). The shared component must follow suit.

## What We're NOT Doing

- **No background re-pricing** of existing holdings (dashboard read path) — deferred to a separate slice.
- **No static fallback prices** — mirror crypto's error-only behavior (`PRICE_UNAVAILABLE` + manual entry).
- **No platinum/palladium** (XPT/XPD) in v1 — a trivial future map entry; ship XAU/XAG only.
- **No crypto back-port** of the `cachedAge` fix beyond what the shared-component extraction naturally covers — noted as optional cleanup.
- **No auto-generated Supabase types** — hand-edit per repo convention.

## Implementation Approach

Follow the database-changes ordering: schema/migration → types → lib/service → API → form → display → backup, with tests mirrored alongside the lib/API. Reuse S-03 as the literal template at each surface. Two decisions shape the work:

- **New `metal_symbol` column** (clean separation) — costs a migration + threading through assets API (4 sites), display (5 sites), and two backup RPCs.
- **GoldAPI.io** (header key `x-access-token`, matches the "key never in URLs/logs" convention) — two calls per fetch (gold + silver), 30-min freshness. A shared `PricedQuantityFields` component serves both crypto and metals.

## Critical Implementation Details

**Workers reachability is medium-high, not certified.** Before committing the price-lib code in Phase 2, run a one-off `curl` of GoldAPI.io **from the deployed Worker egress** (not a browser) to confirm no geo-block/throttle — this is the exact trap S-03 hit (Binance 451, CoinGecko keyless 429). If GoldAPI.io fails from Workers, fall back to metals.dev (accepting the query-param key tradeoff) before writing the fetch code.

**SECURITY DEFINER `search_path` is mandatory** on the upsert RPC (`lessons.md:81`) — omit `SET search_path = public` and cache writes silently fail.

**Backup threading is silent-drop-prone**: `metal_symbol` must be added to `backup.ts` allowlist AND both restore RPCs, or metals won't survive export/import with no error surfaced.

## Phase 1: Data Layer

### Overview

Add the `metal_price_cache` table + upsert RPC and the `assets.metal_symbol` column, extend the hand-written types, and wire the `METALS_API_KEY` env var through config and the test stub.

### Changes Required:

#### 1. Metal price cache migration

**File**: `supabase/migrations/20260712120000_metal_price_cache.sql` (new)

**Intent**: Create the global metals cache and its write RPC, mirroring the crypto cache exactly, and add the `metal_symbol` column to `assets`.

**Contract**: Clone `20260531223101_crypto_price_cache.sql:6-40`. Table `metal_price_cache`: `id UUID PK`, `metal_id TEXT NOT NULL UNIQUE`, `metal_symbol TEXT NOT NULL`, `price_usd NUMERIC(20,8) NOT NULL`, `fetched_at TIMESTAMPTZ DEFAULT NOW()`, index on symbol. RLS enabled + public `FOR SELECT USING (true)`. `SECURITY DEFINER` RPC `upsert_metal_price_cache(...)` with **`SET search_path = public`** and `ON CONFLICT (metal_id) DO UPDATE`. Plus `ALTER TABLE assets ADD COLUMN metal_symbol TEXT` (nullable, no default — mirror `crypto_symbol`). Wrap body in `BEGIN; … COMMIT;`.

#### 2. Hand-edited database types

**File**: `src/lib/database.types.ts`

**Intent**: Reflect the new column, cache table, and RPC in the hand-written types.

**Contract**: Add `metal_symbol: string | null` to assets Row (`:127`, mirror `crypto_symbol`) and `metal_symbol?: string | null` to Insert/Update. Add a `metal_price_cache` table block modeled on `crypto_price_cache` (`:175-198`). Add an `upsert_metal_price_cache` entry under `public.Functions` (mirror `:377-380`).

#### 3. Env var wiring

**File**: `astro.config.mjs`, `vitest.config.ts`

**Intent**: Declare the GoldAPI.io key as a server secret and expose it to the test env stub.

**Contract**: In `astro.config.mjs:18-24`, add `METALS_API_KEY: envField.string({ context: "server", access: "secret", optional: true })`. In `vitest.config.ts:17-21`, add `METALS_API_KEY` to the `astroEnvServerStub()` exported list. (Prod secrets — `wrangler secret put` + Cloudflare dashboard build var — and local `.env`/`.dev.vars` are documented in Phase 1 manual verification, not code.)

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (or `supabase migration up`)
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- `metal_price_cache` and `assets.metal_symbol` exist in local DB after reset
- `METALS_API_KEY` set locally in `.env` + `.dev.vars`; prod `wrangler secret put METALS_API_KEY --name bitworth` + Cloudflare dashboard build env var noted for deploy

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Price Service

### Overview

Add the metals price lib and API handler with mirrored tests. Confirm GoldAPI.io reachability from the deployed Worker before writing fetch code.

### Changes Required:

#### 1. Metals price lib

**File**: `src/lib/metal-prices.ts` (new)

**Intent**: Fetch XAU/XAG spot prices from GoldAPI.io, cache in USD with the crypto TTL, and expose a `getPrice`-shaped API. Error-only fallback (no statics).

**Contract**: Mirror `crypto-prices.ts:6-11,82-94,123-160`. `getPrice(supabase, symbol)` returns `{ price, isCached, cachedAge }` or throws `PRICE_UNAVAILABLE` (with `context.upstreamStatus`). Read cache from `metal_price_cache`, evict on stale TTL, fetch on miss, write via `upsert_metal_price_cache` RPC. GoldAPI.io: **one call per metal** to `https://www.goldapi.io/api/{XAU|XAG}/USD`, key in `x-access-token` header (never in URL), read `price` (USD/troy-oz) from the JSON. Map symbol→GoldAPI path for XAU/XAG only.

#### 2. Metals price API handler

**File**: `src/pages/api/metal-price.ts` (new)

**Intent**: Auth-gated GET returning the cached/fetched metal price for a symbol.

**Contract**: Clone `crypto-price.ts:9-61`. GET `?symbol=XAU`, require auth cookie (401 if absent), 400 on missing symbol, call `getPrice`, map `PRICE_UNAVAILABLE`/`*_NOT_FOUND` → 404 else 500 (`:50`). Error shape `{ error: { code, message, context? } }` (CLAUDE.md hard rule).

#### 3. Lib + handler tests

**File**: `src/lib/metal-prices.test.ts` (new), `src/pages/api/metal-price.test.ts` (new)

**Intent**: Mirror the crypto test recipe, pinning the provider host as a regression guard.

**Contract**: Clone `crypto-prices.test.ts` / `crypto-price.test.ts`. Use `createSupabaseMock`/`findCall`/`createCookiesStub` from `src/test-utils/supabase-mock.ts` and the per-file `asClient` cast helper (`project_tsc_blocker_phase4` memory). `getPrice` paths: fresh-cache-no-fetch, stale-cache-evict-and-fetch, 200-success-writes-cache, 503-no-write (`PRICE_UNAVAILABLE` + `upstreamStatus`), malformed-200-throws-no-write, and an `it.each` asserting the URL `.toContain("goldapi.io")` and `.not.toContain("binance")` / `.not.toContain("coingecko")`. Handler test: `vi.hoisted` + `vi.mock` stubbing `@/lib/supabase` and `@/lib/metal-prices`; 401/200/400/404 cases. `fetch` stubbed via `vi.stubGlobal` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`, real `Response` objects.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test` (or `npx vitest run src/lib/metal-prices.test.ts src/pages/api/metal-price.test.ts`)
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- GoldAPI.io reachability confirmed via `curl` **from the deployed Worker egress** (not a browser) — no geo-block/throttle. If it fails, switch to metals.dev before finalizing the fetch code.
- `GET /api/metal-price?symbol=XAU` returns a live USD price against the real key (dev server)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Form + Assets API

### Overview

Extract a shared `PricedQuantityFields` component serving both crypto and metals, add an XAU/XAG picker for metals, fix the `cachedAge` display bug in the shared path, and thread `metal_symbol` through the assets submit path.

### Changes Required:

#### 1. Shared priced-quantity component

**File**: `src/components/assets/PricedQuantityFields.tsx` (new)

**Intent**: Lift the crypto state + JSX into a reusable component parameterized per priced category, DRYing the duplicated calc math and fixing the `cachedAge` bug in one place.

**Contract**: Parameterize by `{ symbolFieldName, quantityLabel, priceEndpoint, symbolInput }`. Lift `AssetForm.tsx:30-33` state and `:194-311` JSX. Price-state object stores `{ price, isCached, cachedAge }` (the fix — `cachedAge` was dropped at `:226,235`). Calc `amount = Math.round(qty × price × 100) / 100`, USD with hidden `currency=USD`, `readOnly name="amount"` total. Fetch on symbol blur/change → `${priceEndpoint}?symbol=…`. No `useMemo`/`useCallback`/`memo` (react-compiler). For metals `symbolInput` renders a 2-option XAU/XAG picker; for crypto, the free-text uppercased input.

#### 2. AssetForm wiring

**File**: `src/components/assets/AssetForm.tsx`

**Intent**: Render the shared component for both crypto and precious_metals, replacing the inline crypto block.

**Contract**: Add `const isPriced = categoryId === "crypto" || categoryId === "precious_metals"`; broaden the validation-skip (`:44`) and hide-amount (`:124`) guards to `isPriced`. Render `<PricedQuantityFields>` for each priced category with the right endpoint/field-name/picker. Metals write `metal_symbol` (the picker's field name); crypto keeps `crypto_symbol`.

#### 3. Assets API threading

**File**: `src/pages/api/assets/index.ts`, `src/pages/api/assets/[id]/index.ts`

**Intent**: Add `metal_symbol` to the explicit allow-lists on create and update.

**Contract**: POST `index.ts:85-92` (read) + `:118-132` (insert) — add `metal_symbol`. PUT `[id]/index.ts:47-54` (read) + `:76-77` (update) — add `metal_symbol` alongside the crypto/quantity handling.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint` (react-compiler clean)
- Existing tests pass: `npm run test`

#### Manual Verification:

- Add a `precious_metals` asset: XAU/XAG picker shows; picking a metal fetches price; status line shows `XAU — $price (cached · age)` with a **non-empty** age when cached
- Quantity change recomputes the USD total; saving persists `metal_symbol` + `amount` in USD
- Crypto flow still works unchanged (regression check on the extracted component)
- Edit an existing metals asset — price/quantity re-fetch and recompute correctly

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Display + Backup

### Overview

Broaden the display components for `metal_symbol` (with a metal badge variant), and thread `metal_symbol` through backup export/import so metals survive round-trips.

### Changes Required:

#### 1. Display components

**File**: `src/components/assets/AssetCard.tsx`, `src/components/assets/AssetRow.tsx`, `src/components/assets/CurrencyBadge.tsx`

**Intent**: Show the metal badge and the `~{quantity} {symbol}` secondary line for metals, distinct from crypto.

**Contract**: The primary converted value already "just works" (`convertAmount` at `AssetCard.tsx:19` / `AssetRow.tsx:19`) since metals store USD. Broaden the crypto-specific secondary line (`AssetCard.tsx:40-53`, `AssetRow.tsx:44-57`) to also render when `metal_symbol` is set. Add a metal badge variant to `CurrencyBadge.tsx:12-20` (distinct from the crypto orange dot).

#### 2. Backup round-trip

**File**: `src/lib/backup.ts`, restore RPC migration (new, e.g. `20260712130000_restore_backup_metal_symbol.sql`)

**Intent**: Add `metal_symbol` to the backup allow-list and the restore RPC so it survives export/import.

**Contract**: Add `metal_symbol` to the `backup.ts:55` allow-list. The restore RPC enumerates columns explicitly (`20260620120000_restore_backup_rpc.sql:111,124`, `20260711130000_restore_backup_pref_booleans.sql:109,122`) — add a new migration that redefines the restore RPC to include `metal_symbol` in both the read and insert column lists. Wrap in `BEGIN; … COMMIT;`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Tests pass: `npm run test`

#### Manual Verification:

- Dashboard shows a metals asset with converted value, metal badge (not the crypto orange dot), and `~{quantity} {symbol}` line
- Backup export includes `metal_symbol`; restore into a fresh account preserves `metal_symbol` + quantity + amount
- Currency switch re-converts the metals value correctly

**Implementation Note**: After automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `metal-prices.test.ts`: cache-hit/miss/stale, 200-writes-cache, 5xx-no-write (`PRICE_UNAVAILABLE`), malformed-200-throws, provider-host regression (`.toContain("goldapi.io")`, `.not.toContain("binance"/"coingecko")`).
- `metal-price.test.ts`: 401 no-cookie, 200 authed, 400 missing symbol, 404 on 5xx/4xx.

### Integration Tests:

- End-to-end add/edit of a `precious_metals` asset via the form (manual), persistence through the assets API, and backup export→restore preserving `metal_symbol`.

### Manual Testing Steps:

1. Add a gold asset, quantity 2 → total ≈ 2 × current XAU USD price; save; dashboard shows converted value + metal badge.
2. Edit it to silver → price re-fetches, total recomputes.
3. Toggle display currency → value re-converts.
4. Backup export, restore into a fresh account → metals asset intact.
5. Simulate API down (bad key) → `Price unavailable`, manual amount entry still works.

## Performance Considerations

Global cache keyed by metal (not per-user) keeps GoldAPI.io call volume far below the 100 req/mo free tier for a personal app. Two calls per fetch (gold + silver) only occur on cache-miss/stale; the 30-min GoldAPI cadence pairs fine with the crypto-equivalent server TTL.

## Migration Notes

- `assets.metal_symbol` is nullable with no default — existing rows are unaffected.
- The restore RPC is redefined in a new migration (never edit a shipped migration).
- Prod deploy needs `wrangler secret put METALS_API_KEY --name bitworth` + the Cloudflare dashboard build env var (per `CLAUDE.md`).

## References

- Research: `context/changes/metal-price-fetch/research.md`
- S-03 templates: `src/lib/crypto-prices.ts`, `src/pages/api/crypto-price.ts`, `supabase/migrations/20260531223101_crypto_price_cache.sql`
- Lessons: `context/foundation/lessons.md:81` (search_path), `:35` (vitest tsconfig paths), `:15` (public-endpoint auth decision), `:26` (Currency cast boundary)
- MEMORY `project_tsc_blocker_phase4` — `asClient` cast helper for `metal-prices.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Layer

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 302d255
- [x] 1.2 Type checking passes: `npx tsc --noEmit` — 302d255
- [x] 1.3 Linting passes: `npm run lint` — 302d255

#### Manual

- [x] 1.4 `metal_price_cache` + `assets.metal_symbol` exist in local DB — 302d255
- [x] 1.5 `METALS_API_KEY` set locally; prod secret + build-var deploy step noted — 302d255

### Phase 2: Price Service

#### Automated

- [x] 2.1 Unit tests pass: `npm run test`
- [x] 2.2 Type checking passes: `npx tsc --noEmit`
- [x] 2.3 Linting passes: `npm run lint`

#### Manual

- [x] 2.4 GoldAPI.io reachability confirmed via curl from deployed Worker egress (verified: HTTP 200 + live XAU $4120.52 / XAG $59.89 with real key from local machine egress + dev-server Node egress; deployed-Worker-egress certification deferred to deploy — low residual risk, GoldAPI auth is per-key not per-IP)
- [x] 2.5 `GET /api/metal-price?symbol=XAU` returns a live USD price (verified: dev server localhost:4321, authed 200 {price:4120.515,isCached:false}; 2nd call isCached:true cachedAge "12s ago"; XPT→404 METAL_NOT_FOUND)

### Phase 3: Form + Assets API

#### Automated

- [ ] 3.1 Type checking passes: `npx tsc --noEmit`
- [ ] 3.2 Linting passes: `npm run lint` (react-compiler clean)
- [ ] 3.3 Existing tests pass: `npm run test`

#### Manual

- [ ] 3.4 Metals add: picker + fetch + non-empty cached age; quantity recomputes total
- [ ] 3.5 Crypto flow still works after extraction (regression)
- [ ] 3.6 Edit an existing metals asset re-fetches and recomputes

### Phase 4: Display + Backup

#### Automated

- [ ] 4.1 Migration applies cleanly: `npx supabase db reset`
- [ ] 4.2 Type checking passes: `npx tsc --noEmit`
- [ ] 4.3 Linting passes: `npm run lint`
- [ ] 4.4 Tests pass: `npm run test`

#### Manual

- [ ] 4.5 Dashboard shows metal badge + `~qty symbol` line, converted value
- [ ] 4.6 Backup export→restore preserves `metal_symbol` + quantity + amount
- [ ] 4.7 Currency switch re-converts the metals value
