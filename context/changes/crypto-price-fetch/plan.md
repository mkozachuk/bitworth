# Live Crypto Price Fetch on Asset Entry — Implementation Plan

## Overview

When a user adds or edits a crypto asset and enters a crypto symbol (BTC, ETH, etc.), the app fetches the current price from CoinGecko's free API, caches it in Supabase, and shows a price preview below the symbol field. The fetched price becomes a reference value the user can act on — it does not auto-fill or override any form field without consent.

## Current State Analysis

- `assets` table has `crypto_symbol` column (nullable TEXT) — already wired to API, but UI has no symbol input.
- `AssetForm.tsx` has dead `_cryptoSymbol` state (underscore prefix suppresses ESLint).
- `src/lib/exchange-rates.ts` — TTL-cache-in-DB + static fallback pattern: this is the model to follow.
- No crypto price infrastructure exists anywhere in the codebase.
- CoinGecko `/simple/price` endpoint supports symbol lookup (`?ids=BTC&vs_currencies=usd`) with no API key required.
- The `crypto` category (id: `crypto`) is already seeded in `asset_categories`.

## Desired End State

- `AssetForm` shows a crypto symbol input when category is `crypto`.
- On blur from the symbol field, fetch price from CoinGecko → cache in DB → show price preview below the field.
- A `quantity` column on `assets` tracks the coin amount separately from fiat value.
- Graceful fallback: on CoinGecko failure, show cached price with a subtle "cached" indicator; on cache miss, show "price unavailable" (no broken UI).
- A `crypto_price_cache` table stores prices with TTL; server-side route handles all CoinGecko calls (auth guard, rate-limit handling).

### Key Discoveries

- CoinGecko free tier: no API key needed, `/simple/price?ids=BTC&vs_currencies=usd` works with symbol lookup.
- `exchange_rate_cache` RLS: SELECT is public (`FOR SELECT USING (true)`), but INSERT/UPDATE needs a `SECURITY DEFINER` function since prices are global (same for all users) — not per-user rows.
- `snapshot_items` stores `converted_amount` at snapshot time — no changes needed there (crypto assets convert via exchange rates, not via the fetched price).
- The `quantity` column must be added as a migration; `amount` stays as the fiat value field (for simplicity in S-03, `amount` remains the existing monetary value, `quantity` is the new coin amount).

## What We're NOT Doing

- Historical price tracking or charting — FR-019/FR-020 is "live fetch on entry," not time-series.
- Auto-populating `amount` from a fetched price — user sees price as a preview, edits manually.
- Exchange rate integration for crypto-to-fiat (handled by existing `exchange-rates.ts`).
- CoinGecko API key — free tier is sufficient; rate limits are mitigated by debounce + cache.
- Changing `snapshot_items` schema — it already stores the asset's converted value; no link to fetched price needed.

## Implementation Phases

### Phase 1: Database & Library Infrastructure

1. Create `supabase/migrations/<timestamp>_crypto_price_cache.sql`:
   - `crypto_price_cache` table: `id` (UUID, PK), `coin_id` (TEXT, unique), `coin_symbol` (TEXT), `price_usd` (NUMERIC), `fetched_at` (TIMESTAMPTZ).
   - Index on `coin_symbol` and `coin_id`.
   - RLS: SELECT public, INSERT/UPDATE via `SECURITY DEFINER` function (mirrors `exchange_rate_cache` pattern).
2. Add `quantity` column to `assets` table: `ALTER TABLE assets ADD COLUMN quantity NUMERIC`.
3. Update `src/lib/database.types.ts` — add `quantity?: number` to `assets` Row/Insert/Update shapes.
4. Create `src/lib/crypto-prices.ts`:
   - `getCoinId(symbol: string)` — coin ID mapping (BTC→bitcoin, ETH→ethereum, etc.), with CoinGecko `/coins/list` as fallback lookup.
   - `fetchPrice(coinId: string): Promise<number>` — calls CoinGecko `/simple/price?ids=X&vs_currencies=usd`, handles 429 with basic backoff.
   - `getCachedPrice(supabase, symbol)` — reads `crypto_price_cache`, returns null if stale (TTL: 3600s) or missing.
   - `cachePrice(supabase, coinId, symbol, price)` — upserts into `crypto_price_cache`.
   - `getPrice(supabase, symbol): Promise<{ price: number; isCached: boolean }>` — cache-first, CoinGecko fallback, static fallback (last resort): `STATIC_PRICE: Record<string, number>` with rough estimates for BTC/ETH/BNB/ADA.
5. Create `src/pages/api/crypto-price.ts` — `GET /api/crypto-price?symbol=BTC`:
   - Auth guard (session cookie via `createClient` → `getUser()`).
   - Calls `getPrice(supabase, symbol)`.
   - Returns `{ price, isCached, fetchedAt }` or `{ error: { code, message } }`.
   - No rate-limit counter per user (global cache makes this unnecessary).

### Phase 2: UI — Crypto Symbol Input & Price Preview

1. Update `AssetForm.tsx`:
   - Replace `_cryptoSymbol` / `_setCryptoSymbol` with real `cryptoSymbol` / `setCryptoSymbol`.
   - Show crypto symbol `<input>` only when `categoryId === 'crypto'` (add a render guard inside the form, after the category select).
   - On `onBlur` of the symbol input: call `GET /api/crypto-price?symbol={symbol}`.
   - Show price preview below the input:
     - Loading: small spinner ("Fetching price…").
     - Success: `"BTC — $100,245"`.
     - Cached: `"BTC — $98,200 (cached · 2h ago)"`.
     - Error: `"BTC — price unavailable"` (no red error box, no blocking).
   - Add `quantity` field (numeric input, shown only for crypto category).
   - Label the existing `amount` field as "Total Value (USD)" for crypto assets (stays as fiat total for now).
2. Update form submission: include `crypto_symbol` (was already included, now with real value) and `quantity`.
3. The price preview is read-only — the user manually enters their total value in the `amount` field. No auto-fill.
4. Update `CategorySelect` or add a conditional section after it to handle the crypto-only fields.

### Phase 3: Wire API Endpoints for New Fields

1. Update `src/pages/api/assets/index.ts` (POST):
   - Extract `quantity` from `FormData`, include in insert.
2. Update `src/pages/api/assets/[id]/index.ts` (PUT):
   - Extract `quantity` from `FormData`, include in update.

---

## Phase 1: Database & Library Infrastructure

### Overview

Scaffold the backend: migration, TypeScript types, and the `crypto-prices.ts` library that wraps CoinGecko with cache-first logic.

### Changes Required

#### 1. Supabase Migration

**File**: `supabase/migrations/<timestamp>_crypto_price_cache.sql`

**Intent**: Create the `crypto_price_cache` table and add `quantity` column to `assets`.

**Contract**:
```sql
-- crypto_price_cache
CREATE TABLE crypto_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_id TEXT NOT NULL UNIQUE,  -- CoinGecko ID (e.g. "bitcoin")
  coin_symbol TEXT NOT NULL,      -- uppercase symbol (e.g. "BTC")
  price_usd NUMERIC(20, 8) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crypto_price_cache_symbol ON crypto_price_cache(coin_symbol);

ALTER TABLE crypto_price_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read crypto prices" ON crypto_price_cache
  FOR SELECT USING (true);

-- SECURITY DEFINER function for cache writes (global data, not per-user)
CREATE OR REPLACE FUNCTION upsert_crypto_price_cache(...)
RETURNS void SECURITY DEFINER;

-- assets: add quantity
ALTER TABLE assets ADD COLUMN quantity NUMERIC;
```

#### 2. Database Types

**File**: `src/lib/database.types.ts`

**Intent**: Add `quantity` field to the `assets` table's TypeScript shapes.

**Contract**: In the `assets` Row/Insert/Update interfaces, add `quantity?: number | null`.

#### 3. Crypto Prices Library

**File**: `src/lib/crypto-prices.ts`

**Intent**: Provide `getPrice(supabase, symbol)` — cache-first, CoinGecko fallback, static fallback.

**Contract**:
```ts
export type PriceResult = { price: number; isCached: boolean; fetchedAt: string };

export async function getPrice(
  supabase: SupabaseClient,
  symbol: string,
): Promise<PriceResult | { error: { code: string; message: string } }>;

// Internal helpers:
async function getCoinId(supabase: SupabaseClient, symbol: string): Promise<string | null>;
async function fetchFromCoinGecko(coinId: string): Promise<number | null>;
async function getCachedPrice(supabase: SupabaseClient, coinId: string): Promise<{ price: number; fetched_at: string } | null>;
async function upsertCache(supabase: SupabaseClient, coinId: string, symbol: string, price: number): Promise<void>;
```

**Key implementation notes**:
- CoinGecko `/simple/price?ids={coinId}&vs_currencies=usd` — free tier, no API key.
- Handle 429: pause 2 seconds, retry once, then fall back to cache/statics.
- `STATIC_PRICE` fallback: `{ BTC: 95000, ETH: 3000, ADA: 0.45, SOL: 180, BNB: 600 }` — rough estimates for last-resort fallback.
- Coin ID lookup: coin symbol → CoinGecko coin ID mapping (hardcoded for top 20 coins + fallback via CoinGecko `/coins/list` if needed).

#### 4. API Route

**File**: `src/pages/api/crypto-price.ts`

**Intent**: Authenticated endpoint for fetching a crypto price. Calls `getPrice`, returns result.

**Contract**:
```ts
// GET /api/crypto-price?symbol=BTC
// Response 200: { price: 100245.00, isCached: false, fetchedAt: "2026-05-31T..." }
// Response 200: { price: 98200.00, isCached: true, fetchedAt: "2026-05-31T..." }
// Response 404: { error: { code: "COIN_NOT_FOUND", message: "..." } }
// Response 500: { error: { code: "FETCH_FAILED", message: "..." } }
```

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `supabase db push` or `make migrate`
- TypeScript compiles: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification

- `GET /api/crypto-price?symbol=BTC` returns a USD price
- `GET /api/crypto-price?symbol=INVALID_COIN` returns `COIN_NOT_FOUND`
- Cache miss triggers CoinGecko fetch; cache hit returns `isCached: true`
- Anonymous request (no auth) returns 401

---

## Phase 2: UI — Crypto Symbol Input & Price Preview

### Overview

Enable the `AssetForm` to show a crypto symbol input (only when category is `crypto`), fetch prices on blur, and display a read-only price preview. Also add the `quantity` field for crypto assets.

### Changes Required

#### 1. AssetForm — Crypto Symbol Input

**File**: `src/components/assets/AssetForm.tsx`

**Intent**: Replace the dead `_cryptoSymbol` state with a real UI input, shown only when the selected category is `crypto`.

**Contract**:
```tsx
// State (replace lines 30):
const [cryptoSymbol, setCryptoSymbol] = useState(asset ? (asset.crypto_symbol ?? "") : "");
const [cryptoPrice, setCryptoPrice] = useState<{ price: number; isCached: boolean } | null>(null);
const [priceStatus, setPriceStatus] = useState<"idle" | "loading" | "success" | "cached" | "error">("idle");

// Crypto symbol input (shown only when categoryId === 'crypto'):
{categoryId === 'crypto' && (
  <div>
    <label htmlFor="crypto_symbol">Crypto Symbol</label>
    <input
      id="crypto_symbol"
      name="crypto_symbol"
      value={cryptoSymbol}
      onChange={(e) => setCryptoSymbol(e.target.value.toUpperCase())}
      onBlur={() => {
        if (!cryptoSymbol.trim()) return;
        setPriceStatus("loading");
        fetch(`/api/crypto-price?symbol=${encodeURIComponent(cryptoSymbol.trim())}`)
          .then(r => r.json())
          .then(data => {
            if (data.error) { setPriceStatus("error"); return; }
            setCryptoPrice({ price: data.price, isCached: data.isCached });
            setPriceStatus(data.isCached ? "cached" : "success");
          })
          .catch(() => setPriceStatus("error"));
      }}
      placeholder="BTC, ETH, SOL..."
    />
    {/* Price preview */}
    {priceStatus === "loading" && <span className="text-xs text-white/50">Fetching price…</span>}
    {(priceStatus === "success" || priceStatus === "cached") && cryptoPrice && (
      <span className="text-xs text-white/70">
        {cryptoSymbol} — ${cryptoPrice.price.toLocaleString()} {priceStatus === "cached" && "(cached)"}
      </span>
    )}
    {priceStatus === "error" && (
      <span className="text-xs text-white/40">Price unavailable</span>
    )}
  </div>
)}
```

#### 2. AssetForm — Quantity Field

**Intent**: Add a numeric input for coin quantity, shown only for crypto category.

**Contract**: `{categoryId === 'crypto' && <input type="number" name="quantity" step="any" />}` with a label "Quantity (e.g., 0.5 BTC)".

#### 3. Form Hidden Inputs

**Intent**: Ensure `crypto_symbol` is included in form submission (it already is via `name="crypto_symbol"` on the input). Add `quantity` as a hidden or regular form field that gets submitted via `FormData`.

**Contract**: When `categoryId === 'crypto'`, the form must include `crypto_symbol` and `quantity` in the submitted data.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification

- Select "Crypto" category → crypto symbol input and quantity field appear
- Type "BTC" → blur → price preview appears within ~1 second
- Symbol with no price data → "Price unavailable" (no error toast)
- Cached result shows "(cached)" indicator
- Form submission includes correct `crypto_symbol` and `quantity` values in DB

---

## Phase 3: Wire API Endpoints for New Fields

### Overview

Update asset API endpoints to accept and store the new `quantity` field alongside the existing `crypto_symbol`.

### Changes Required

#### 1. Asset POST Endpoint

**File**: `src/pages/api/assets/index.ts` (POST handler)

**Intent**: Accept and store `quantity` from FormData.

**Contract**: Extract `quantity` from `FormData`, convert to number or null, include in `supabase.from("assets").insert({ ..., quantity: quantity ? parseFloat(quantity) : null })`.

#### 2. Asset PUT Endpoint

**File**: `src/pages/api/assets/[id]/index.ts` (PUT handler)

**Intent**: Accept and store `quantity` updates.

**Contract**: Same extraction pattern as POST — include `quantity` in the update payload.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification

- Create a crypto asset with `crypto_symbol=BTC` and `quantity=0.5` → saved correctly in DB
- Edit the same asset → `quantity` and `crypto_symbol` update correctly
- View asset in list → `quantity` displayed (if UI shows it)

---

## Testing Strategy

### Unit Tests

- `crypto-prices.ts`: Mock CoinGecko fetch, verify cache-first behavior and static fallback path.
- `crypto-prices.ts`: Verify `getCoinId` returns correct IDs for BTC/ETH/SOL.

### Integration Tests

- `GET /api/crypto-price?symbol=BTC` → 200 with price
- `GET /api/crypto-price?symbol=INVALID` → 404 with error shape
- Asset POST with `crypto_symbol` + `quantity` → 201, DB has correct values
- Asset PUT with `quantity` update → 200, DB updated

### Manual Testing Steps

1. Create a crypto category asset: select "Crypto" category, enter "BTC" as symbol, blur → price preview appears.
2. Enter quantity "0.5", total value "50000" → save → redirected to assets list.
3. Reload page → asset shows in list with correct symbol.
4. Edit asset → symbol field pre-filled, price preview triggers on blur.
5. With bad network or CoinGecko down → "Price unavailable" shown, no error toast.

---

## Performance Considerations

- **Debounce**: Price fetch triggers on `onBlur`, not on keystroke — zero debounce needed.
- **Cache TTL**: 3600s (matches exchange rate cache). Fresh CoinGecko data within the hour.
- **Rate limits**: CoinGecko free tier is generous for single-user flows. 429 handling (2s wait + 1 retry) is sufficient. Global DB cache means repeated fetches of the same symbol hit cache, not CoinGecko.
- **No in-memory state**: Price state lives in React state only during the form session. No `sessionStorage` or `localStorage` needed since the cache lives in Supabase.

---

## Migration Notes

- `assets.quantity` column is nullable — existing rows get `null`. No data migration needed.
- `crypto_price_cache` is a new table — no data migration needed.
- After migration runs, `npx supabase types gen --project-id XXX` to regenerate types (or update `database.types.ts` manually if using hand-written types).

---

## References

- Research: `context/changes/crypto-price-fetch/research.md`
- Exchange rates pattern: `src/lib/exchange-rates.ts:1-86`
- AssetForm current state: `src/components/assets/AssetForm.tsx:30`
- Asset API POST/PUT: `src/pages/api/assets/index.ts`, `src/pages/api/assets/[id]/index.ts`
- CoinGecko `/simple/price` docs: `/websites/coingecko` (Context7)
- Schema: `supabase/migrations/20260529190856_initial_schema.sql`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Database & Library Infrastructure

#### Automated

- [x] 1.1 Migration applies cleanly — c59346a
- [x] 1.2 TypeScript compiles — c59346a
- [x] 1.3 Linting passes — c59346a

#### Manual

- [x] 1.4 `GET /api/crypto-price?symbol=BTC` returns USD price — a417e2a
- [x] 1.5 `GET /api/crypto-price?symbol=INVALID` returns `COIN_NOT_FOUND` — a417e2a
- [x] 1.6 Cache hit returns `isCached: true` — a417e2a
- [x] 1.7 Unauthenticated request returns 401 — a417e2a

### Phase 2: UI — Crypto Symbol Input & Price Preview

#### Automated

- [x] 2.1 TypeScript compiles — a417e2a
- [x] 2.2 Linting passes — a417e2a

#### Manual

- [x] 2.3 "Crypto" category → symbol + quantity inputs appear
- [x] 2.4 Symbol blur → price preview appears within ~1 second
- [x] 2.5 Unknown symbol → "Price unavailable" (no toast)
- [x] 2.6 Cached result shows "(cached)" indicator
- [x] 2.7 Form submission includes `crypto_symbol` + `quantity` in DB

### Phase 3: Wire API Endpoints for New Fields

#### Automated

- [x] 3.1 TypeScript compiles — a417e2a
- [x] 3.2 Linting passes — a417e2a

#### Manual

- [x] 3.3 Create crypto asset with quantity → saved correctly
- [x] 3.4 Edit crypto asset quantity → updated correctly