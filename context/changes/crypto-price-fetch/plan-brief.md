# Live Crypto Price Fetch on Asset Entry — Plan Brief

> Full plan: `context/changes/crypto-price-fetch/plan.md`
> Research: `context/changes/crypto-price-fetch/research.md`

## What & Why

When a user adds or edits a crypto asset and enters a Symbol (BTC, ETH, etc.), the app fetches the current USD price from CoinGecko, shows it as a read-only preview, and caches it in Supabase. The user never loses work — CoinGecko downtime means a cached price or "unavailable" message, never a broken form. FR-019 (auto-fetch on entry) and FR-020 (graceful fallback) are both satisfied.

## Starting Point

`AssetForm.tsx` has six fields but the crypto symbol input is dead code — state exists with an underscore prefix to suppress the linter. The `assets` table accepts `crypto_symbol` on insert/update, but no price lookup happens anywhere. `src/lib/exchange-rates.ts` has the definitive TTL-cache-in-DB pattern that this feature mirrors.

## Desired End State

A user selects "Crypto" category → sees a crypto symbol input and quantity field → types `BTC` and tabs away → sees `BTC — $100,245` (or `… (cached · 2h ago)`) appear below the input. No field is auto-filled. Total value (`amount`) is always entered manually. On CoinGecko failure, a subtle "Price unavailable" replaces the preview — no red error, no manual-entry gate.

## Scope

**In scope:**
- `crypto_price_cache` Supabase table with TTL + `SECURITY DEFINER` write pattern
- `quantity` column on `assets` (nullable, no data migration needed)
- `GET /api/crypto-price?symbol=BTC` authenticated endpoint (cache-first, CoinGecko fallback, static fallback)
- `AssetForm` crypto symbol input (on-blur fetch) + read-only price preview
- `quantity` numeric input on the crypto asset form
- API endpoints wired to accept `quantity` on create/update

**Out of scope:**
- Auto-populating `amount` from fetched price (manual entry only)
- Historical price tracking or charting
- CoinGecko API key (free tier is sufficient)
- `snapshot_items` schema changes
- Per-user rate-limit tracking

## Architecture / Approach

```
User types "BTC" → blur → React state: loading → fetch GET /api/crypto-price?symbol=BTC
                                                              │
                                              auth guard → getPrice(supabase, symbol)
                                                              │
                                        cache hit? ──yes──→ return { price, isCached: true }
                                        │
                                        no
                                        ↓
                          Price in DB TTL? ──yes──→ upsert + return { price, isCached: false }
                                        │
                                        no
                                        ↓
                          CoinGecko /simple/price?ids=bitcoin&vs_currencies=usd
                                        │
                              429? → wait 2s → retry once → fail → static fallback
                                        ↓
                            upsert cache → return { price, isCached: false }
```

`cash-prices.ts` library is the single dependency for all price fetching. `exchange-rates.ts` is the exact pattern followed.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DB + Library | Migration, TypeScript types, `crypto-prices.ts`, `GET /api/crypto-price` | CoinGecko 429 / static fallback values becoming stale |
| 2. UI | `AssetForm` crypto input + quantity field + price preview | Symbol input UX (blur not firing on mobile) |
| 3. API Wiring | `POST`/`PUT` endpoints accept `quantity` | `FormData` field naming must match DB column |

**Prerequisites:** F-01 (asset management) must be complete (provides the `AssetForm` + API endpoints this plan extends).
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- **Static fallback prices**: `STATIC_PRICE` hardcoded estimates (BTC: $95k, ETH: $3000) go stale. Acceptable per FR-020 fallback requirement, but worth noting the values will drift from reality.
- **Symbol → CoinGecko ID mapping**: Hardcoded top-20 coins + `/coins/list` fallback lookup handles edge cases, but rare coins may not resolve. Acceptable given free-tier constraints.
- **Single-currency (USD only)**: CoinGecko `price_usd` is fiat-denominated. Display in EUR/PLN relies on existing `exchange-rates.ts`. This is intentional — the fetched price is a reference value, not the display currency.

## Success Criteria (Summary)

- Selecting "Crypto" category shows a symbol input, quantity field, and price preview area.
- Blurring from the symbol field triggers a CoinGecko fetch and shows the result below the input within ~1 second.
- A cache hit returns the price with a "(cached · Xh ago)" indicator.
- A CoinGecko failure (down or 429) shows "Price unavailable" instead of a blocking error.
- A crypto asset saved with a `crypto_symbol` and `quantity` persists those values and displays them on re-edit.
