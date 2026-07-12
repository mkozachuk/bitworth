# Precious-metals Spot-price Fetch (S-19) — Plan Brief

> Full plan: `context/changes/metal-price-fetch/plan.md`
> Research: `context/changes/metal-price-fetch/research.md`

## What & Why

Roadmap slice S-19: when a user adds/edits a `precious_metals` asset, auto-fetch the current gold (XAU) / silver (XAG) spot price, convert USD→display currency, and auto-calc value from a troy-oz quantity. It closes the parity gap where crypto (S-03) gets live pricing but metals don't — the same "tell me how much I own, I'll value it" UX, for metals.

## Starting Point

The S-03 crypto flow is fully shipped and is a direct template for every surface (cache table + `SECURITY DEFINER` RPC, price lib, auth-gated API, form branch, display, tests). The `precious_metals` category is already seeded and `assets.quantity` already exists — both reused as-is. Priced assets store `amount` in USD with display-time conversion via `exchange-rates.ts`.

## Desired End State

Adding a metals asset shows an XAU/XAG picker + quantity; picking a metal fetches the price and auto-computes the USD total. On the dashboard the value converts to the display currency, shows a metal badge and a `~{quantity} {symbol}` line, and the asset survives backup export/import.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Data model | New `metal_symbol` column | Clean separation + correct badge; worth the threading cost | Plan |
| Metals API | GoldAPI.io (header key) | `x-access-token` matches "key never in URLs/logs" convention | Plan |
| Symbol input | XAU/XAG picker | Two-value set — constrained input avoids typos | Plan |
| Fallback | Error-only (mirror crypto) | Keep the price layer honest; no stale fabricated values | Plan |
| Form structure | Extract shared `PricedQuantityFields` | Roadmap-preferred; DRYs calc math, one place to fix bugs | Plan |
| `cachedAge` bug | Fix in shared path | Correct new code; crypto backport noted as optional | Plan |
| Metal set v1 | XAU + XAG only | Platinum/palladium are a trivial future map entry | Research |
| API-reachability lesson | Corrected | Roadmap's "CoinGecko 403 → Binance" is wrong; real lesson: keyed endpoint + verify from Worker | Research |

## Scope

**In scope:** metals cache table + RPC, `metal_symbol` column, metals price lib + API, shared priced-quantity form component with XAU/XAG picker, display badge, backup threading, mirrored tests.

**Out of scope:** background re-pricing of existing holdings; static fallback prices; platinum/palladium; crypto `cachedAge` back-port.

## Architecture / Approach

Strict S-03 clone. Global `metal_price_cache` (public-SELECT RLS, `SECURITY DEFINER` upsert with `SET search_path = public`) fed by `src/lib/metal-prices.ts` (GoldAPI.io, one call per metal, USD-only). Auth-gated `/api/metal-price` serves the form. Form logic lives in a shared `PricedQuantityFields` rendered for both crypto and metals. New `metal_symbol` column is threaded through assets API (create+update), display, and both backup restore RPCs.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | Cache table + RPC, `metal_symbol` column, types, env | `search_path` omission → silent write failures |
| 2. Price service | `metal-prices.ts` + `/api/metal-price` + tests | GoldAPI.io geo-block/throttle from Workers egress |
| 3. Form + assets API | Shared component, XAU/XAG picker, `cachedAge` fix, threading | Regressing the shipped crypto branch during extraction |
| 4. Display + backup | Metal badge, secondary line, backup round-trip | Missing a backup RPC → metals silently don't restore |

**Prerequisites:** F-01, S-01, S-03 (all done); a GoldAPI.io free key. **Verify GoldAPI.io from the deployed Worker before writing Phase 2 fetch code.**
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- GoldAPI.io Workers reachability is medium-high, not certified — Phase 2 gates on a curl-from-Worker smoke test; fall back to metals.dev if it fails.
- Backup threading is silent-drop-prone: `metal_symbol` must reach both `backup.ts` and every restore RPC or export/import loses it with no error.
- Extracting the shared form component touches the working crypto path — regression care required.

## Success Criteria (Summary)

- A user adds a gold/silver asset by quantity and gets an auto-valued USD total, converted to their display currency on the dashboard.
- Metals render with a distinct badge and survive backup export/import.
- The shipped crypto flow is unchanged after the shared-component extraction.
