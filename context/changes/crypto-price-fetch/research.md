---
date: '2026-05-31T12:00:00-05:00'
researcher: maksymkozachuk
git_commit: a0977972ce978f94037fa58afbc8f0e3c398db6d
branch: master
repository: mkozachuk/bitworth
topic: "Live crypto price fetch on asset entry (S-03 / crypto-price-fetch)"
tags: [research, crypto, coingecko, asset-management, FR-019, FR-020]
status: complete
last_updated: '2026-05-31'
last_updated_by: maksymkozachuk
---

# Research: Live Crypto Price Fetch on Asset Entry (S-03)

**Date**: 2026-05-31T12:00:00-05:00
**Researcher**: maksymkozachuk
**Git Commit**: a0977972ce978f94037fa58afbc8f0e3c398db6d
**Branch**: master
**Repository**: [mkozachuk/bitworth](https://github.com/mkozachuk/bitworth)

## Research Question

What is the current codebase state for implementing live crypto price fetching on asset entry (S-03, FR-019/FR-020)? Specifically: existing infrastructure, schema readiness, integration gaps, and patterns to follow.

## Summary

The codebase has a mature fiat exchange-rate system but **zero crypto price infrastructure**. The `crypto_symbol` column already exists in the schema and is accepted by the API, but the UI input is dead code and no price fetching logic exists anywhere. CoinGecko is the confirmed API (PRD open question resolved), but the free tier's rate limits are a known high risk requiring aggressive caching and debouncing. Key patterns to follow: the `exchange-rates.ts` TTL-cache-in-DB-with-static-fallback model, the `{ error: { code, message, context? } }` error shape (hard rule), and the `createClient` → `getUser()` auth guard pattern.

## Detailed Findings

### 1. PRD Requirements (FR-019 / FR-020)

**`context/foundation/prd.md` lines 117-118:**

- **FR-019**: "When user enters a crypto asset, the app auto-fetches current market price for BTC, ETH, and common altcoins." — Priority: must-have. **Status: NOT implemented.**
- **FR-020**: "If crypto price fetching fails, the app falls back to a cached price or manual entry — no broken UI." — Priority: must-have. **Status: NOT implemented.**

Acceptance criterion from **US-03** (prd.md line 82-84): "Crypto assets trigger a live price fetch on entry."

**Guardrail** (prd.md line 48): "External API calls (exchange rates, crypto prices) fail gracefully with fallback values — no broken UI."

**Open Question Q3** (prd.md line 152): "Which free public API for crypto prices?" — Resolved: CoinGecko chosen.

---

### 2. Roadmap — S-03 Status

**`context/foundation/roadmap.md` lines 117-128:**

S-03 (`crypto-price-fetch`) is in Stream B (`F-01 → S-03`), running parallel with S-01 and S-02 (both marked `done`). Status: `proposed`.

**Known risk** (roadmap line 123): "CoinGecko free tier has rate limits. If the user has many crypto assets, concurrent fetches can hit the limit. Mitigant: debounce fetches, cache aggressively per the FR-020 fallback requirement."

---

### 3. Database Schema — Already Ready

**`supabase/migrations/20260529190856_initial_schema.sql` line 35:**

```sql
crypto_symbol TEXT,
```
The `assets` table already has a nullable `crypto_symbol` column (e.g. "BTC", "ETH"). No schema migration needed for the symbol field.

**`supabase/seed.sql` line 14:**
```sql
('crypto', 'Crypto', 'bitcoin', false, 8)
```
The `crypto` category already exists with ID `crypto`, icon `bitcoin`, `is_liability: false`.

**Missing:** No `purchase_price`, `quantity`, `cost_basis`, or historical price columns. The `assets` table is flat — a "holding" is a single row with a scalar `amount`.

**`src/lib/database.types.ts` lines 50-96:** Hand-written (not auto-generated) `Database` interface. `crypto_symbol` is `string | null` in `Row`, `Insert`, and `Update` shapes.

---

### 4. Exchange Rate Cache Pattern — The Model to Follow

**`src/lib/exchange-rates.ts` (entire file, lines 1-86):**

This is the definitive pattern for how the crypto price service should work:

| Aspect | Value |
|---|---|
| External API | `https://api.frankfurter.app/latest?from=EUR` |
| Cache table | `exchange_rate_cache` (composite PK: `base_currency, target_currency`) |
| Cache TTL | 3600 seconds (1 hour) |
| Cache check | `age > CACHE_TTL_SECONDS` → miss, triggers re-fetch |
| Write pattern | Upserts all derived pairs on each fresh fetch |
| Failure fallback | `STATIC_RATES = { USD: 1.0, EUR: 0.92, PLN: 3.85 }` — static hardcoded constants |
| Rate limiting | **None** (no backoff, no retry count, no 429 handling) |

**`src/pages/api/rates.ts`:** Unauthenticated public endpoint serving cached rates. Falls back to hardcoded rates if no Supabase client. Explicit comment (line 5): "intentionally unauthenticated."

---

### 5. Asset Entry UI — Dead Code Waiting

**`src/components/assets/AssetForm.tsx` line 30:**

```tsx
const [_cryptoSymbol, _setCryptoSymbol] = useState(asset ? (asset.crypto_symbol ?? "") : "");
```
The crypto symbol state is wired up but dead code — `_` prefix suppresses ESLint's `no-unused-vars`. **No `<input>` or UI control renders it to the user.**

**`src/components/assets/AssetForm.tsx` lines 22-32:** Six fields exist: `name`, `amount`, `currency` (USD/EUR/PLN), `category_id`, `notes`, and `crypto_symbol` (ghost). There is no `price`, `purchase_price`, or `cost_basis` field — `amount` is the sole monetary value field.

Asset type is selected via `category_id` dropdown (backed by `asset_categories` table). No dedicated "crypto vs stock" selector exists — the distinction is implicit via the `crypto` category.

**Form submission** (`AssetForm.tsx` lines 58-87): `fetch` with `FormData` → `POST /api/assets` (create) or `PUT /api/assets/[id]` (edit). Fields sent: `name`, `amount`, `currency`, `category_id`, `notes`, `crypto_symbol` (always empty string).

---

### 6. Asset API Endpoints — Already Handle `crypto_symbol`

**`src/pages/api/assets/index.ts` lines 84-90, 116-127:**
- `POST`: extracts `crypto_symbol` from `FormData`, inserts into `assets` table. No price lookup occurs.
- `GET`: fetches all assets with category join filtered by `user_id`.

**`src/pages/api/assets/[id]/index.ts` lines 52, 74:**
- `PUT`: extracts and updates `crypto_symbol`. Ownership check via `.eq("user_id", user.id)`.
- `DELETE`: deletes asset with ownership check.

Both endpoints follow auth pattern: `createClient` → `getUser()` → 401 on failure → error shape `{ error: { code, message } }`.

---

### 7. No CoinGecko Integration Exists

Grep across all `src/` files for `coingecko|CoinGecko` returned **zero matches**. No server-side CoinGecko client, no API key, no price-fetching utility, no crypto price cache table.

---

### 8. Related Changes — S-01 Explicitly Deferred

**`context/changes/asset-management/plan.md` line 51:** "Crypto symbol is nullable in the schema — no crypto price lookup in S-01 (that's S-03)."

**`context/changes/asset-management/reviews/impl-review.md` lines 62-69 (F4):** `AssetForm` has unused `_cryptoSymbol` / `_setCryptoSymbol` state. Decision: **SKIPPED — defer to S-03** to wire it up with live CoinGecko price fetching.

---

### 9. Linear Tracking

- **BIT-8** (`context/foundation/tasks-linear.md` lines 66-73): Linear issue for S-03, milestone M4 (Crypto integration). Labels: `slice`. PRD refs: FR-019, FR-020.
- **GitHub #5** (`context/foundation/tasks-github.md` line 38): GitHub issue for S-03, milestone M4.
- **Open question Q2/#7** resolved: CoinGecko is the confirmed API.

---

## Architecture Insights

### Patterns to follow

1. **TTL cache in DB + static fallback** — `exchange-rates.ts` is the canonical pattern. A parallel `src/lib/crypto-prices.ts` should follow the same structure.
2. **Error shape `{ error: { code, message, context? } }`** — hard rule per CLAUDE.md. All new API routes must use this shape, never `{ error: string }`.
3. **Auth guard pattern** — `createClient` → `getUser()` → 401 with JSON error body.
4. **FormData + fetch submission** — `AssetForm` uses `FormData` not JSON. New price lookup endpoint should match this pattern or be called as a separate async trigger.
5. **Debounce + aggressive caching** — required to mitigate CoinGecko free tier rate limits (roadmap risk: HIGH).

### Integration points

- `AssetForm.tsx` needs a crypto symbol input (un-comment/replace the dead `_cryptoSymbol` state with a real `<input>`)
- New `src/lib/crypto-prices.ts` needs to be called from the asset form when `category_id === 'crypto'` and a `crypto_symbol` is entered
- A `crypto_price_cache` Supabase table (new migration) stores fetched prices with TTL
- A new `GET /api/prices?symbol=BTC` endpoint or inline fetch in the asset form
- `snapshot_items` does not need changes — it stores the asset's `converted_amount` at snapshot time, not a market price

### What's NOT needed

- No change to `assets` table schema (symbol column already exists)
- No change to `asset_categories` (crypto category already seeded)
- No change to asset API endpoints (they already pass through `crypto_symbol`)
- No historical price tracking table — the feature is "live fetch on entry", not historical charting

---

## Open Questions

1. **Quantity vs. total amount**: The current `assets.amount` is a scalar value (e.g., "5000 USD"). Should crypto assets track quantity (e.g., "0.5 BTC") separately from total value? If so, a `quantity` column is needed alongside a per-unit price.
2. **Debounce strategy**: How aggressively to debounce CoinGecko calls? Suggested: on symbol input blur/changed, fetch with 500ms debounce, cache result for 1 hour.
3. **Price display timing**: Should the fetched price auto-populate the `amount` field, or show as a preview alongside a manual entry? PRD is ambiguous — clarify intent before planning.
4. **Cache table vs. in-memory**: `exchange-rates.ts` uses a DB table for cross-session cache. Crypto prices could use the same pattern or simpler in-memory + `sessionStorage` if rate limits are tight.

---

## Related Research

- `context/changes/asset-management/research.md` — S-01 research; documents API patterns, component conventions, error shapes
- `context/changes/dashboard-snapshots-chart/research.md` — dashboard API patterns, Recharts integration, snapshot data flow
- `context/foundation/prd.md` — FR-019, FR-020, FR-009 (asset categories)
- `context/foundation/roadmap.md` — S-03 stream position, risk notes, parallel tracks