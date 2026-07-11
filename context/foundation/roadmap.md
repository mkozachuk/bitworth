---
project: "BitWorth"
version: 1
status: draft
created: 2026-05-26
updated: 2026-07-11
prd_version: 1
main_goal: market-feedback
top_blocker: capacity
---

# Roadmap: BitWorth

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Alex, a privacy-conscious individual, replaces their manual spreadsheet with a dedicated net worth tracker that consolidates multi-currency assets, auto-converts to a chosen display currency, and renders visual history. The wedge — the one trait that, if removed, makes the product indistinguishable from a generic portfolio app — is that input is fully manual (no bank connections) yet meaningfully better than a spreadsheet: automatic conversion, one-click snapshots, and trend charts without formula setup.

## North star

**S-02: full dashboard loop** — user can see their net worth number, delta indicators, and trend chart from saved snapshots. The north star is the validation milestone: the smallest end-to-end slice whose successful delivery proves the core product hypothesis — that manual-entry net worth tracking with conversion and charts beats a spreadsheet.

## At a glance

| ID   | Change ID                  | Outcome (user can …)                                                                               | Prerequisites          | PRD refs             | Status  |
| ---- | -------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------- | -------------------- | ------- |
| F-01 | supabase-schema-migrations | (foundation) Supabase schema landed; migrations ready                                              | —                      | NFR-perf, FR-006-020 | done    |
| S-01 | asset-management           | add/edit/delete assets with currency conversion                                                    | F-01                   | US-03, FR-006-010    | done    |
| S-02 | dashboard-snapshots-chart  | see net worth, deltas, and trend chart from snapshots                                              | F-01, S-01             | US-01, FR-011-018    | done    |
| S-03 | crypto-price-fetch         | see live BTC/ETH prices when adding crypto assets                                                  | F-01                   | FR-019-020           | done    |
| S-04 | dashboard-assets-summary   | see assets summary by currency on dashboard                                                        | F-01, S-01, S-02       | —                    | done    |
| S-05 | user-settings              | configure display currency and preferences in a settings tab                                       | F-01, S-02             | FR-011               | done    |
| S-06 | mobile-refactor            | use the dashboard, assets, and forms comfortably on phone-sized viewports                          | F-01, S-01, S-02, S-04 | —                    | done    |
| S-07 | asset-list-mobile-reflow   | view and act on every asset in the list on a phone-sized viewport                                  | F-01, S-01, S-06       | —                    | done    |
| S-08 | pwa-installable            | install the app to a phone's home screen and launch it standalone at /dashboard                    | F-01, S-06, S-07       | —                    | done    |
| S-09 | fire-calculator            | project years-to-FI and a FIRE number using current net worth as the starting point                | F-01, S-01, S-02, S-05 | —                    | done    |
| S-10 | landing-page               | land on a dedicated BitWorth landing page that explains the product and drives sign-up             | —                      | —                    | done    |
| S-11 | dashboard-top-movers       | see which assets rose/fell most since their last snapshot (top gainers + losers) on the dashboard  | F-01, S-01, S-02, S-04 | —                    | done    |
| S-12 | per-asset-trends           | see how individual assets/categories changed over time as a chart, from snapshot history           | F-01, S-02             | —                    | done    |
| S-13 | data-backup-import-export  | export a full backup of all their data to one file and import it back                              | F-01, S-02, S-05       | —                    | done    |
| S-14 | fire-dashboard             | toggle a FIRE-progress card on the dashboard showing % to FIRE, runway months, and years-to-FI     | F-01, S-02, S-05, S-09 | —                    | done    |
| S-15 | asset-balancer             | set target % per asset for an investment set and compare declared vs real allocation as pie charts | F-01, S-01, S-02       | —                    | done    |
| S-16 | monte-carlo-simulation     | run thousands of randomized market paths to see the probability of reaching their FIRE goal        | F-01, S-01, S-02, S-09 | —                    | done    |
| S-17 | contributions-vs-growth    | see each period's net-worth change split into contributions vs market growth                       | F-01, S-01, S-02, S-05 | —                    | planned |
| S-18 | allocation-drift-alerts    | get a dashboard alert when real allocation drifts past a threshold from a card's target            | F-01, S-01, S-02, S-15 | —                    | planned |
| S-19 | metal-price-fetch          | see live gold/silver spot prices (in display currency) when adding a precious-metals asset          | F-01, S-01, S-03       | —                    | planned |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme             | Chain                                               | Note                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A      | Core tracking     | `F-01` → `S-01` → `S-02`                            | Main path: schema → assets → dashboard with charts                                                                                                                                                                                                                                                                                                                                                                             |
| B      | Crypto pricing    | `F-01` → `S-03`                                     | Parallel branch after F-01; can run alongside S-01/S-02                                                                                                                                                                                                                                                                                                                                                                        |
| C      | Dashboard UX      | `F-01` → `S-01` → `S-02` → `S-04`                   | Builds on S-02 to complete the dashboard view                                                                                                                                                                                                                                                                                                                                                                                  |
| D      | User settings     | `F-01` → `S-05`                                     | Parallel branch after S-02; UI for `user_preferences`                                                                                                                                                                                                                                                                                                                                                                          |
| E      | Responsive UI     | `F-01` → `S-06` → `S-07` → `S-08`                   | S-06/S-07 make the app usable on mobile; S-08 ships it as an installable PWA                                                                                                                                                                                                                                                                                                                                                   |
| F      | FIRE planning     | `F-01` → `S-01` → `S-02` → `S-09` → `S-14`, `S-16`  | Projection layer on top of the net-worth number; seeds the starting principal from assets and reuses the S-02 charting lib. S-14 surfaces FIRE on the dashboard as a settings-gated card; depends on the S-05 settings page for the on/off toggle. S-16 forks off S-09: same inputs and FIRE number, but replaces the single deterministic return with thousands of randomized return paths to report a probability of success |
| G      | Marketing         | `landing-page`                                      | Standalone public page; no data dependency — reuses the design system and auth CTAs. Parallel with everything.                                                                                                                                                                                                                                                                                                                 |
| H      | Snapshot insights | `F-01` → `S-01` → `S-02` → `S-11` → `S-12` → `S-17` | Reads the per-asset `snapshot_items` already captured by S-02; S-11 introduces the read+matching path, S-12 reuses it for trend charts. S-17 reads the same snapshot history but adds a per-interval contribution input to split each change into contributions vs market growth                                                                                                                                               |
| I      | Data portability  | `F-01` → `S-02` → `S-05` → `S-13`                   | Full-account backup export/import; reuses the S-05 settings page as host and reads every user-owned table                                                                                                                                                                                                                                                                                                                      |
| J      | Portfolio balance | `F-01` → `S-01` → `S-02` → `S-15` → `S-18`          | Target-allocation layer over existing assets: declared vs real % pie charts on a new "Balance" page + a per-asset share label on the assets list. Reuses `convertAmount`/`computeNetWorth` and the S-02 Recharts lib (first PieChart usage). S-18 reuses `computeAllocation` to flag drift between real and target allocation as a settings-gated dashboard card. Parallel with everything after S-02                          |
| K      | Metals pricing    | `F-01` → `S-01` → `S-03` → `S-19`                   | Live spot-price branch for precious-metals assets, the sibling of the crypto pricing branch (Stream B). Mirrors S-03's `getPrice`/`crypto_price_cache`/`AssetForm` conditional but for gold/silver, and reuses `exchange-rates.ts` to convert the USD spot price into the user's display currency. Parallel with everything after S-03                                                                                            |

## Baseline

What's already in place in the codebase as of `2026-05-26` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro v6 + React 19 islands + Tailwind CSS v4 + Radix UI + Lucide; file-based routing; no state management; no charting library yet
- **Backend / API:** present — Astro v6 server mode + Cloudflare adapter; 3 auth API routes (signin/signup/signout) as thin Supabase wrappers; no business logic yet
- **Data:** partial — Supabase client present (`@supabase/ssr`) + local `supabase/config.toml`; no schema files, migrations, or seed data on disk
- **Auth:** present — Supabase SSR; session verified in middleware; `/dashboard` route protected with redirect to `/auth/signin`
- **Deploy / infra:** present — Cloudflare Workers + Wrangler; GitHub Actions CI pipeline; `.env.example` template
- **Observability:** absent — no logging library, no error tracking, no health endpoints

## Foundations

### F-01: Supabase schema and migrations

- **Outcome:** (foundation) PostgreSQL schema for assets, snapshots, and user preferences designed, migrated, and seeded with category data.
- **Change ID:** `supabase-schema-migrations`
- **PRD refs:** FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-014, FR-016, FR-017, FR-019; NFR §data-privacy
- **Unlocks:** `S-01` (asset CRUD needs tables), `S-02` (snapshot + chart needs snapshot table), `S-03` (crypto price model needs assets table)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** Open Question 2 (exchange rate API pick) and Open Question 3 (crypto price API pick) — both are small, resolvable before or during F-01; not blocking but will inform schema fields (e.g., `assets.crypto_symbol` column for API lookups)
- **Unknowns:**
  - Exchange rate API: frankfurter.app (free, no key, EUR base only) vs Open Exchange Rates — Owner: dev. Block: no (design decision, not planning blocker).
  - Crypto API: CoinGecko (free, no key) — Owner: dev. Block: no.
  - Snapshot auto-save trigger: first-login-of-month vs fixed day-of-month — Owner: user. Block: no (S-02 implements whichever; schema accommodates both via a `snapshot.source` column).
  - Display currency persistence: user preference stored per-user vs session — Owner: dev. Block: no (stored per-user in `user_preferences` table; always the safer default).
- **Risk:** Schema is the single point of failure for all downstream slices. Wrong column types or missing indexes surface late and force migrations. Mitigant: keep schema minimal — only what's strictly required for MVP.
- **Status:** done

## Slices

### S-01: Asset management with currency conversion

- **Outcome:** user can add, edit, and delete asset entries with name, amount, currency (PLN/USD/EUR), and category; net worth recalculates immediately in their chosen display currency.
- **Change ID:** `asset-management`
- **PRD refs:** US-03, FR-006, FR-007, FR-008, FR-009, FR-010
- **Prerequisites:** `F-01`
- **Parallel with:** `S-03`
- **Blockers:** —
- **Unknowns:**
  - —
- **Risk:** Currency conversion requires an exchange rate API call per net worth load. FR-013 mandates a fallback — implement the cache/fallback path concurrently with the live-fetch path, not as a later patch.
- **Status:** done

### S-02: Dashboard — net worth display, snapshots, and trend chart

- **Outcome:** user sees total net worth as a single number, delta indicators vs. last month and vs. January 1st, a line chart of all saved snapshots, and can manually trigger a snapshot save.
- **Change ID:** `dashboard-snapshots-chart`
- **PRD refs:** US-01, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018
- **Prerequisites:** `F-01`, `S-01`
- **Parallel with:** `S-03`
- **Blockers:** —
- **Unknowns:**
  - Snapshot auto-save trigger (first-login-of-month vs fixed day-of-month) — **Resolved 2026-06-16: auto-save (FR-016) dropped; manual trigger (FR-017) is the snapshot mechanism. Issue #8 closed.**
- **Risk:** Chart component is not in the baseline. Picking a charting library (Chart.js, Recharts, visx) is a one-time decision that should be made once and applied consistently. NFR §2s-load means chart data must be fetched efficiently, not re-derived on every page load.
- **Status:** done

### S-04: Dashboard assets summary

- **Outcome:** user sees a per-currency breakdown of their assets directly on the dashboard, so they can quickly understand their exposure across currencies without navigating to the assets page.
- **Change ID:** `dashboard-assets-summary`
- **PRD refs:** —
- **Prerequisites:** `F-01`, `S-01`, `S-02`
- **Parallel with:** `S-03`
- **Blockers:** —
- **Unknowns:** —
- **Risk:** —
- **Status:** done

### S-05: User settings

- **Outcome:** user opens a dedicated settings tab where they can configure personal preferences — at minimum their default display currency, with room to add further settings (e.g., date format, theme) later — and changes persist across sessions.
- **Change ID:** `user-settings`
- **PRD refs:** FR-011
- **Prerequisites:** `F-01`, `S-02`
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Which settings beyond display currency belong in this tab? (Owner: user, by: before S-05 planning) Ship display currency first; treat the tab as a home for future preferences.
- **Risk:** `user_preferences.display_currency` is already read by the snapshots API but has no UI. Fragmenting the write path (one surface in the dashboard, another in settings) is the main risk. Mitigant: the settings page is the single source of UI for `user_preferences`; no other surface writes the same fields.
- **Status:** done

### S-06: Mobile refactor

- **Outcome:** user can complete the core flows (view dashboard, add/edit/delete assets, sign out) on a phone-sized viewport (~360px wide) without horizontal scrolling, truncated labels, or wrapped buttons.
- **Change ID:** `mobile-refactor`
- **PRD refs:** —
- **Prerequisites:** `F-01`, `S-01`, `S-02`, `S-04`
- **Parallel with:** `S-05`
- **Blockers:** —
- **Unknowns:**
  - There are two "Sign out" buttons (Topbar + dashboard page). Fixing the duplication is adjacent to the responsive work. (Owner: planner, by: during `/10x-plan`) Recommended: collapse to one in S-06.
  - AssetList renders as a `<table>`, which won't reflow on narrow viewports. **Out of scope for S-06** (confirmed 2026-06-01) — will land as a separate follow-up slice (likely S-07) once the nav/buttons pass ships.
- **Risk:** Pure UI refactor on every existing page — high regression risk on desktop if the mobile pass is done without visual diffing at ≥1024px. Mitigant: snapshot/visual check on both viewports in `/10x-implement`. Secondary risk: no shared `Icon` component yet, so mobile-icon swaps will be implemented ad-hoc; consider adding an `IconButton` variant of `src/components/ui/button.tsx` first.
- **Status:** done

### S-07: AssetList mobile reflow

- **Outcome:** user can read every asset, switch between All / Assets / Liabilities, and trigger Edit or Delete on a phone-sized viewport (~360px wide) without horizontal scrolling.
- **Change ID:** `asset-list-mobile-reflow`
- **PRD refs:** —
- **Prerequisites:** `F-01`, `S-01`, `S-06`
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Implementation approach: pure-CSS table reflow (e.g. `block sm:table` on the table element + stacked cells) vs. conditional render of a separate card component on `<sm`. (Owner: planner, by: during `/10x-plan`) Recommendation: conditional render — it keeps the desktop table markup untouched and gives S-07 free rein over mobile semantics.
  - Should the filter tabs (All / Assets / Liabilities) get a mobile treatment in the same slice? They render as 3 small text buttons and may already fit at 360px. (Owner: planner, by: during `/10x-plan`) Recommendation: leave as-is unless a quick check shows overflow.
  - The empty state ("No assets yet" / "No {filter} found") — keep one or split mobile/desktop. (Owner: planner, by: during `/10x-plan`) Recommendation: keep one.
- **Risk:** Visual regression on the existing desktop table if the markup changes. Mitigant: keep the `<table>` path for `≥sm` byte-identical; only add a separate mobile view. Secondary risk: a11y — swapping between a `<table>` and a card list must preserve semantic structure. Mitigant: use `<ul>` + `<li>` for the mobile view (it's a list of items, not tabular data on narrow screens), keep `<table>` for desktop.
- **Status:** done

### S-08: PWA / installable mobile app

- **Outcome:** user can install the BitWorth app to their phone's home screen (iOS via Share → Add to Home Screen; Android/Chrome via the install prompt) and launch it as a standalone app — no browser chrome, opens directly to `/dashboard`, full-bleed layout using safe-area insets.
- **Change ID:** `pwa-installable`
- **PRD refs:** —
- **Prerequisites:** `F-01`, `S-06`, `S-07`
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Brand icon source. The repo has only `public/favicon.png` (32×32) and a 1.2 MB marketing `template.png`. PWAs need a 192×192, 512×512, maskable variant, and a 180×180 Apple touch icon. (Owner: user, by: before S-08 planning) Recommendation: ship a placeholder monogram icon set generated from the existing favicon, designer can swap later.
  - iOS install instructions UX. iOS doesn't fire `beforeinstallprompt` — users must use Share → Add to Home Screen. (Owner: planner, by: during `/10x-plan`) Recommendation: detect iOS + `display-mode !== 'standalone'` and show a dismissible "How to install" banner on first authed visit; hide after dismiss or after install.
  - Offline fallback. The app requires auth + network for all meaningful data. (Owner: planner, by: during `/10x-plan`) Recommendation: ship a minimal offline fallback page (HTML shell + "You're offline" message) served by the SW. Don't try to cache user data — Supabase auth would be invalid anyway.
  - Update strategy. Service workers cache the app shell; stale SW can serve old assets. (Owner: planner, by: during `/10x-plan`) Recommendation: Serwist's default `skipWaiting` + `clientsClaim` is fine here; the data is always fresh from Supabase.
- **Risk:** Cloudflare Workers must serve `sw.js` with the correct `Service-Worker-Allowed` scope header, or the SW won't control the site. Mitigant: Serwist emits the SW with correct scope by default; verify in `/10x-implement` via DevTools → Application → Service Workers on a deploy preview. Secondary risk: stale SW caches old assets after deploy — mitigated by Serwist's per-build version bump. Tertiary risk: iOS PWA has well-known limitations (no push, no background sync, no fullscreen by default) — out of scope for S-08; noted here for awareness.
- **Status:** done

### S-03: Crypto price fetch on asset entry

- **Outcome:** when user adds or edits a crypto asset, the app auto-fetches current market price for BTC/ETH/altcoins from CoinGecko; if the fetch fails, a cached price or manual entry is used.
- **Change ID:** `crypto-price-fetch`
- **PRD refs:** FR-019, FR-020
- **Prerequisites:** `F-01`
- **Parallel with:** `S-01`, `S-02`, `S-04`
- **Blockers:** —
- **Unknowns:**
  - —
- **Risk:** CoinGecko free tier has rate limits. If the user has many crypto assets, concurrent fetches can hit the limit. Mitigant: debounce fetches, cache aggressively per the FR-020 fallback requirement.
- **Status:** done

### S-09: FIRE calculator

- **Outcome:** user opens a FIRE (Financial Independence / Retire Early) calculator that takes their current net worth as the starting point and projects how their wealth grows over time — given target annual expenses, a safe withdrawal rate, an expected return, and ongoing contributions — surfacing their FIRE number (target net worth) and estimated years-to-FI, with a projection chart.
- **Change ID:** `fire-calculator`
- **PRD refs:** — (post-MVP extension; was a PRD §Non-Goal, promoted by user decision 2026-06-11 — the PRD §Non-Goals section should be updated to reflect this scope change)
- **Prerequisites:** `F-01`, `S-01`, `S-02`, `S-05`
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Starting point: prefill from live current net worth (sum of assets, converted) vs. let the user override it. (Owner: planner, by: during `/10x-plan`) Recommendation: prefill from current net worth and allow override — keeps the "assets as starting point" wedge while letting users model hypotheticals.
  - Input set: which parameters to expose. Minimum viable: target annual expenses, safe withdrawal rate (default 4%), expected annual return, and annual/monthly contributions. (Owner: user, by: before S-09 planning) Recommendation: ship those four; defer a separate inflation field and variable-return modeling.
  - Returns model: real vs. nominal returns and whether to model inflation separately. (Owner: planner, by: during `/10x-plan`) Recommendation: a single real-return input (return net of inflation) for v1 — simplest correct model, avoids a second field users will mis-set.
  - Persistence: are FIRE inputs saved per-user or recomputed from defaults each visit? (Owner: planner, by: during `/10x-plan`) Recommendation: persist per-user so the projection is sticky; reuse the `user_preferences` pattern from S-05 (new column(s) or a small `fire_settings` table).
  - Currency: the projection should run entirely in the user's display currency (S-05) — FIRE number and chart axis use the same converted currency as the dashboard. (Owner: planner) Recommendation: yes, single display currency end-to-end.
- **Risk:** The projection math (compound growth + contributions crossing the FIRE target) is easy to get subtly wrong — off-by-one on compounding periods, mixing nominal/real returns, or mis-deriving the FIRE number from the withdrawal rate. Mitigant: isolate the projection into a pure, unit-tested function (e.g. `src/lib/fire.ts`) with table-driven tests before wiring any UI, and reuse the charting library chosen in S-02 rather than introducing a new one. Secondary risk: presenting a projection as a promise — add a clear "estimate, not financial advice" disclaimer.
- **Status:** done

### S-10: Dedicated landing page

- **Outcome:** an unauthenticated visitor lands on a dedicated BitWorth marketing page (replacing the "10x Astro Starter" placeholder) that communicates the privacy-first, manual-entry net-worth-tracking value proposition — hero headline + tagline, 3–4 value props (privacy/no bank connections, multi-currency auto-conversion, one-click snapshots, trend charts), a product preview, and clear Sign Up / Sign In CTAs.
- **Change ID:** `landing-page`
- **PRD refs:** — (presentation polish; not a PRD functional requirement)
- **Prerequisites:** — (public page; no schema/data dependency — reuses the Tailwind design system and existing `/auth/*` pages)
- **Parallel with:** all slices (independent)
- **Blockers:** —
- **Unknowns:**
  - Copy/positioning source: lift the vision + wedge from `prd.md` / roadmap §Vision recap. (Owner: planner, by: during `/10x-plan`) Recommendation: reuse "privacy-first net worth tracker, manual-entry, better than a spreadsheet."
  - Product preview asset: `public/template.png` (1492×470 dashboard mockup) exists. (Owner: user, by: before S-10 planning) Recommendation: use `template.png` as the hero/preview image; designer can swap a real screenshot later.
  - Implementation surface: rewrite `Welcome.astro` in place vs. new component. (Owner: planner, by: during `/10x-plan`) Recommendation: rewrite copy/sections inside `Welcome.astro` to keep the cosmic theme and avoid a new wrapper.
- **Risk:** Low — single static public page, no data or auth-flow changes. Main risk is design drift from the established cosmic aesthetic; mitigant: reuse the existing starfield + blur-orb styling and the `button.tsx` variants already in `Welcome.astro`, swap only copy and add the value-prop/preview sections.
- **Status:** done

### S-11: Dashboard top movers

- **Outcome:** in place of the empty "Your assets will appear here" placeholder, user sees a top-movers panel on the dashboard — which assets rose and fell the most since their last saved snapshot — shown as top gainers and top losers side by side with amount and percentage; when there is no snapshot yet to compare against, a friendly placeholder prompts them to save one.
- **Change ID:** `dashboard-top-movers`
- **PRD refs:** — (post-MVP dashboard extension; not a PRD functional requirement)
- **Prerequisites:** `F-01`, `S-01`, `S-02`, `S-04`
- **Parallel with:** `S-12`
- **Blockers:** —
- **Unknowns:**
  - Asset identity across the comparison boundary: `snapshot_items` has no stable `asset_id`, only `name` + `category_id`; a renamed asset reads as remove+add. (Owner: planner, by: during `/10x-plan`) Recommendation: match current assets to the latest snapshot's items on `(name, category_id)`; current assets with no match are "new" (no baseline — exclude from movers or label as new); snapshot items with no current match are removed and simply absent.
  - Comparison basis: **confirmed current live asset values (converted at today's rates) vs the `converted_amount` stored in the most recent snapshot's `snapshot_items`.** This mirrors the existing delta indicators, which already compare live net worth to stored snapshots — note the mixed-rate caveat (live side uses today's rates). **Implemented: baseline re-converted from `original_amount`/`original_currency` at today's rates (both sides on one rate set) so a display-currency switch doesn't introduce spurious movement.**
  - Count: how many movers per side. (Owner: planner) Recommendation: top 3 gainers + top 3 losers, ranked by absolute change; a "no change" / single-asset state degrades gracefully.
  - Read path: new GET endpoint vs server-load in `dashboard.astro`. (Owner: planner) Recommendation: load the latest snapshot's `snapshot_items` server-side in `dashboard.astro` (consistent with the existing snapshots load at lines 26-30) and pass them to a new `TopMovers` React island that replaces the placeholder `<div>` at `dashboard.astro:72-84`.
- **Risk:** First-ever consumer of `snapshot_items` (written but never read today), and `(name, category_id)` matching is fragile across renames. Mitigant: isolate the diff into a pure, unit-tested function (e.g. `src/lib/movers.ts`); reuse the `DeltaIndicator` sign/colour pattern in `src/components/assets/NetWorthDisplay.tsx:19-34` and `convertAmount` from `src/lib/net-worth.ts`. Secondary: empty / single-asset / no-snapshot states must render the placeholder, not crash.
- **Status:** done

### S-12: Per-asset trends

- **Outcome:** user can see how individual assets (or categories) have changed over time — either a dedicated per-asset trend chart or per-asset trend lines layered onto the dashboard net-worth chart — built from the per-asset `snapshot_items` already captured at each snapshot.
- **Change ID:** `per-asset-trends`
- **PRD refs:** — (post-MVP dashboard extension; not a PRD functional requirement)
- **Prerequisites:** `F-01`, `S-02`
- **Parallel with:** `S-11`
- **Blockers:** —
- **Unknowns:**
  - Presentation: a separate per-asset chart with an asset/category selector vs overlaying multiple asset lines on the existing `NetWorthChart`. (Owner: planner, by: during `/10x-plan`) Recommendation: a separate chart with a selector — overlaying many lines on the net-worth chart clutters the north-star view.
  - Granularity: per-asset vs per-category trends. Assets get renamed/deleted; categories are stable FKs. (Owner: planner) Recommendation: offer category-level trends as the robust default, per-asset as an enhancement.
  - Identity over history: same `(name, category_id)` matching fragility as S-11 — long histories will show discontinuities when assets are renamed/removed. (Owner: planner) Recommendation: reuse S-11's matching helper and a pure series-builder function.
  - Charting library: reuse Recharts (the one-time S-02 decision) — do **not** introduce a new lib.
- **Risk:** Name-based identity over a long snapshot history is fragile and can render misleading discontinuities. Mitigant: reuse S-11's `(name, category_id)` matching plus a pure, unit-tested series-builder; copy the Recharts `LineChart` pattern from `src/components/NetWorthChart.tsx` and `src/components/fire/FireProjectionChart.tsx` rather than rebuilding chart scaffolding.
- **Status:** done

### S-13: Data backup import/export

- **Outcome:** user opens the settings page and can (a) export a single self-describing backup file (JSON) containing all their data — preferences, assets, snapshots, and snapshot items — and (b) import such a file to restore it, choosing whether to **replace** all existing data or **merge** it alongside what's there.
- **Change ID:** `data-backup-import-export`
- **PRD refs:** — (post-MVP data-portability extension; distinct from the parked "Data export (PDF, CSV)" non-goal — see §Parked)
- **Prerequisites:** `F-01` (schema / all user-owned tables), `S-02` (snapshots + `snapshot_items` exist), `S-05` (settings page is the host surface)
- **Parallel with:** — (independent of other post-MVP slices)
- **Blockers:** —
- **Unknowns:**
  - File format & schema versioning: JSON with an explicit `schemaVersion` / `exportedAt` envelope so future imports can detect/upgrade old files. (Owner: planner, by: during `/10x-plan`) Recommendation: version the envelope from day one.
  - Import mode UX: **confirmed — offer both replace-all and merge, user picks.** Replace-all is destructive → guard with an explicit confirmation dialog. Merge must define identity: UUIDs regenerate on import, so there is no stable cross-file asset identity → merge = append new rows, accepting possible duplicates. (Owner: planner) Recommendation: append-only merge; surface the duplicate caveat in the UI.
  - Atomicity: no Supabase JS transactions. Replace-all = delete-then-insert across 4 tables; a mid-import failure can leave partial state. (Owner: planner) Recommendation: prefer a single Postgres RPC (`restore_backup`) for true atomicity; fall back to the compensating-delete pattern from `src/pages/api/snapshots/index.ts` if an RPC is out of scope.
  - Category validation: imported `category_id` values must still exist in the global `asset_categories` table — do not recreate categories. (Owner: planner) Recommendation: validate referenced ids on import; reject the file (or skip the row with a `context` error) if a category is unknown.
  - Snapshot child remapping: on import, regenerate `snapshots.id` and remap each `snapshot_items.snapshot_id`. (Owner: planner) Recommendation: required for both modes.
  - Export delivery & import input: GET endpoint returning a downloadable file vs client-side blob; import via `<input type="file">` → JSON body or multipart. (Owner: planner) Recommendation: `GET /api/backup/export` returning `application/json` with a `Content-Disposition` attachment; `POST /api/backup/import` reading parsed JSON (follow the `user-preferences` JSON-body pattern, not `formData`).
  - Field-list completeness: confirm `assets.quantity` (present in `src/lib/database.types.ts`, no matching migration file found) is included in the backup. (Owner: planner)
- **Risk:** Restore touches every user-owned table with no native transaction, so a partial failure can corrupt the account's data — the exact scenario backups exist to prevent. Mitigant: isolate (de)serialization into a pure, unit-tested helper (e.g. `src/lib/backup.ts`) that validates the envelope and shape before any write; prefer an atomic Postgres RPC for the restore, otherwise reuse the compensating-delete rollback from `src/pages/api/snapshots/index.ts`. Secondary risk: importing another user's `user_id` — neutralized by remapping to `auth.uid()` and RLS `WITH CHECK`. Tertiary: large backups — acceptable for MVP (manual-entry data is small).
- **Status:** done

### S-14: FIRE dashboard card

- **Outcome:** user can turn a "FIRE dashboard" card on or off from the settings page (on by default); when on, the main dashboard shows a card with their progress toward financial independence — an animated progress bar for percent of the FIRE number reached, months of runway they could live on with zero income, estimated years-to-FI, and the FIRE number itself, all in their display currency. When they have not entered any FIRE data yet, the card shows a placeholder prompting them to set up the FIRE calculator, with a link to `/dashboard/fire`.
- **Change ID:** `fire-dashboard`
- **PRD refs:** — (post-MVP dashboard extension; not a PRD functional requirement)
- **Prerequisites:** `F-01` (schema), `S-02` (dashboard host + net-worth/rates load), `S-05` (settings page + `user_preferences` write path for the new toggle), `S-09` (FIRE engine `src/lib/fire.ts` + the `fire_*` columns this card reads)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - "No FIRE data" definition: which absent field flips the card to its placeholder state. (Owner: planner, by: during `/10x-plan`) Recommendation: treat `fire_annual_expenses == null` as "not set up" — it is the one input both the FIRE number and the runway calc require (`fire_safe_withdrawal_rate` is NOT NULL with a default, so it cannot signal absence).
  - Runway helper: "months at zero income" does not exist yet. (Owner: planner) Recommendation: add a pure, unit-tested helper (e.g. `monthsOfRunway(netWorth, annualExpenses)` in `src/lib/fire.ts` or a sibling `src/lib/runway.ts`) = `netWorth / (annualExpenses / 12)`; guard `annualExpenses <= 0`. Mirror the isolated, table-tested style of `fire.ts`.
  - Settings persistence: add `show_fire_dashboard BOOLEAN NOT NULL DEFAULT TRUE` to `user_preferences` via a new migration (timestamp after `20260621000000`), mirroring the `show_on_chart` boolean precedent. Thread it through `database.types.ts` (Row/Insert/Update), `PREFS_SELECT` + a boolean validation branch in `api/user-preferences/index.ts`, and a native `accent-purple-600` checkbox in `SettingsForm.tsx`. (Owner: planner)
  - Dashboard data load: `dashboard.astro` does not currently read the `fire_*` columns or call `computeNetWorth`. (Owner: planner) Recommendation: copy the SSR load pattern from `dashboard/fire.astro` (assets + `getRates` + `computeNetWorth`, plus the `fire_*` + `show_fire_dashboard` select), gate rendering on `show_fire_dashboard`, and pass the computed net worth + FIRE prefs + `displayCurrency` into a new `FireProgress` island.
  - Card placement & gating scope: where in the dashboard stack the card sits, and whether the toggle also gates the FIRE nav link (`Topbar`/`TopbarMenu` → `/dashboard/fire`). (Owner: planner) Recommendation: place it in the `assets &&` block near `NetWorthDisplay`; gate only the dashboard card, leave the nav link always available.
  - Progress-bar animation: CSS transition on width vs a JS-driven count-up. (Owner: planner) Recommendation: CSS `transition`/`@keyframes` on the bar fill — no new dependency, respects `prefers-reduced-motion`.
- **Risk:** Low — read-and-present over an existing, tested engine. Main risks: (a) divide-by-zero / null FIRE inputs must degrade to the placeholder, not crash — mitigant: a pure guarded runway helper with table-driven tests and an explicit "no FIRE data" branch; (b) `computeFireProjection` throws `RangeError` when `safeWithdrawalRate <= 0` — the card must guard before calling, as `FireCalculatorForm` already does; (c) currency cast boundary (DB `string` → `Currency`) per the documented project lesson — reuse the `dashboard/fire.astro` cast pattern.
- **Status:** done

### S-15: Asset balancer (target allocation)

- **Outcome:** user opens a new, clearly named "Balance" entry in the menu where they pick which of their existing assets form an investment set, assign a target percentage to each (a share of that configurable investment pool, **not** of their whole net worth), and see two side-by-side pie charts — one of their **declared / target** allocation and one of their **real** allocation computed from current asset values in their display currency — so they can spot drift and know what to rebalance. Separately, on the assets page each asset row gains a calculated "% of all assets" label.
- **Change ID:** `asset-balancer`
- **PRD refs:** — (post-MVP portfolio extension; not a PRD functional requirement)
- **Prerequisites:** `F-01` (new table to persist per-asset target %), `S-01` (assets exist + asset CRUD + the asset list this extends), `S-02` (`convertAmount`/`computeNetWorth` in `src/lib/net-worth.ts` + the Recharts lib)
- **Parallel with:** all slices after `S-02` (independent; reads existing assets, adds one table + one page + one list column)
- **Blockers:** —
- **Unknowns:**
  - Investment-pool denominator: the target/real % must be "of investment, configurable" rather than "of all assets". Options: (a) denominator = sum of the user-selected balancer assets' current converted values; (b) a user-entered fixed investment total they allocate against; (c) total net worth. (Owner: planner, by: during `/10x-plan`) Recommendation: v1 = the user flags which assets are in the balancer set and the denominator is the sum of those selected assets (option a); keep a manual-override total (option b) as a follow-up. Both pies share this one denominator so declared vs real are comparable.
  - Persistence model: a dedicated table (e.g. `allocation_targets(user_id, asset_id, target_pct)`) with an FK to `assets(id)` `ON DELETE CASCADE` and RLS, vs a JSON blob on `user_preferences`. (Owner: planner) Recommendation: a dedicated table keyed on `asset_id` — assets have a stable UUID `id` (unlike the `(name, category_id)` matching S-11/S-12 had to use), and `ON DELETE CASCADE` cleans a target when its asset is deleted. Mirror the F-01 migration + `database.types.ts` Row/Insert/Update + RLS pattern.
  - Target-sum handling: do declared targets have to sum to 100%? (Owner: planner) Recommendation: don't hard-block saving; show a live "targets sum = X%" indicator and either warn when ≠100% or offer a one-click normalize. The **real** pie always normalizes to 100% by construction; the **declared** pie should render the raw entered targets (and visibly flag an under/over-100% sum) so the two charts stay honest.
  - "% of all assets" label denominator (assets page): liabilities are negative, so "% of net worth" can exceed 100% or go negative. (Owner: planner) Recommendation: define the label as each asset's converted value ÷ sum of all **positive** asset values (exclude liabilities), and either hide the label on liability rows or show it against the liabilities subtotal — pick one and state it in the plan. This is a small, separable concern from the balancer page; it touches `AssetRow`/`AssetCard` and reuses `convertAmount`.
  - Asset-set composition: should liabilities be selectable into the balancer? (Owner: planner) Recommendation: restrict the balancer set to non-liability assets so every pie slice is a positive contribution.
  - Charting: reuse Recharts (the one-time S-02 decision) — this is the first **PieChart** in the codebase (existing charts are all `LineChart`: `NetWorthChart`, `AssetTrendsChart`, `FireProjectionChart`). Do **not** introduce a new charting lib; copy the Recharts wiring conventions from those components.
  - Menu label & route: needs a short, clear name slotted into `TopbarMenu.tsx` (current items: Dashboard / Assets / FIRE / Settings). (Owner: planner) Recommendation: label **"Balance"** at route `/dashboard/balancer`, placed between **Assets** and **FIRE** (it operates on assets); Lucide icon `Scale` (balance) or `PieChart`.
- **Risk:** Spans three surfaces — a new table + migration, a new page with two pie charts, and an edit to the existing asset list — so the main risks are: (a) the declared and real pies must be computed over the **same** asset set and denominator or the comparison misleads; (b) a deleted asset must not orphan a stale target row — mitigant: FK `ON DELETE CASCADE`; (c) the per-asset "% of all assets" label needs a single, clearly-defined denominator to avoid confusing negative/>100% values once liabilities are in play. Mitigant: isolate the allocation math (target %, real %, per-asset share) in a pure, unit-tested helper (e.g. `src/lib/allocation.ts`), reuse `convertAmount` for every value, and reuse the currency-cast boundary pattern (DB `string` → `Currency`) documented as a project lesson.
- **Status:** done

### S-16: Monte Carlo simulation

- **Outcome:** user opens a new, clearly named menu entry (e.g. "Forecast") that runs a Monte Carlo simulation — hundreds to thousands of randomized market paths over the FIRE horizon — and shows the **probability of reaching their FIRE goal** (a single headline percentage), a chart that plots a readable **sample** of the simulated paths plus percentile bands (e.g. P10 / P50 / P90), and a plain-language description of what the simulation does and how to read it (with an "estimate, not financial advice" disclaimer). Inputs are seeded from the same FIRE assumptions the user already entered in S-09 (current net worth as starting principal, contributions, expenses, return, inflation, SWR, ages), with one new input for return volatility. The FIRE calculator page (`/dashboard/fire`) gains a link/CTA pointing to the simulation so the two projection views cross-reference each other.
- **Change ID:** `monte-carlo-simulation`
- **PRD refs:** — (post-MVP FIRE-planning extension; not a PRD functional requirement — a probabilistic companion to the deterministic S-09 projection)
- **Prerequisites:** `F-01`, `S-01` (assets seed the starting net worth), `S-02` (`convertAmount`/`computeNetWorth` in `src/lib/net-worth.ts` + the Recharts lib), `S-09` (reuses the FIRE engine inputs, real-return convention, and FIRE number from `src/lib/fire.ts`; reuses the persisted `fire_*` columns and the `dashboard/fire.astro` SSR load pattern)
- **Parallel with:** all slices after `S-09` (independent read-and-compute layer; adds one pure module + one page + one nav item + a link on the FIRE page; no new table required if volatility is session-only)
- **Blockers:** —
- **Unknowns:**
  - Return model: where does randomness come from? Options: (a) parametric — each year's real return drawn from `Normal(mean = realReturn, sd = volatility)`, volatility a new user input; (b) bootstrap resampling from historical annual returns (needs a bundled return series). (Owner: planner, by: during `/10x-plan`) Recommendation: parametric Normal in **real** terms, reusing `toRealReturn` from `fire.ts` for the mean — it keeps the single real-terms convention that avoided the nominal/real mixing bug in S-09, needs no bundled dataset, and adds exactly one input (annual volatility / standard deviation, default ~0.15 for an equity-heavy portfolio). Note Normal returns can go below −100% in a tail; clamp the per-year multiplier at a floor (e.g. `max(-0.95, draw)`) so a path can't produce a negative balance from a single draw.
  - Goal metric: what counts as "reaching the goal"? Recommendation: probability = share of paths whose balance reaches the **FIRE number** (`annualExpenses / safeWithdrawalRate`, already computed by `fire.ts`) at or before the projection horizon (or by the user's traditional retirement age). State the exact success criterion in the plan so the headline % is unambiguous. Consider also reporting median years-to-FI across successful paths.
  - Determinism / testability: `Math.random()` is non-deterministic, so the pure math module can't be unit-tested directly against it. (Owner: planner) Recommendation: isolate the simulation in a pure `src/lib/monte-carlo.ts` that takes an **injected seedable RNG** (e.g. a `mulberry32(seed)` generator) and a deterministic Gaussian transform (Box–Muller); table-driven tests pass a fixed seed and assert on the resulting distribution/percentiles. Mirror the isolated, unit-tested style of `fire.ts`/`allocation.ts`/`movers.ts`. Worth capturing as a new lesson once implemented (seed-injected RNG as the testability seam for any stochastic module).
  - Path count & performance: "hundreds or thousands" — 1000 paths × ~60 years = ~60k iterations, trivial to compute, but **rendering** 1000 SVG line series in Recharts is not. (Owner: planner) Recommendation: compute all N paths (default 1000) for the statistics, but render only a sampled subset (~50–100 faint lines) plus the P10/P50/P90 percentile bands as the readable foreground — exactly the user's "maybe not all but they should be." If compute ever feels heavy on mobile, move it to a Web Worker; default to synchronous in the island first and measure. `log`/note any cap so "sampled 100 of 1000" is visible, not silent.
  - Charting: reuse Recharts (the one-time S-02 decision). This is a multi-series `LineChart` (sampled paths + percentile bands); copy the wiring conventions from `FireProjectionChart.tsx` (axes, tooltip, `ResponsiveContainer`, `var(--chart-*)` colors). Do **not** introduce a new charting lib. Render sampled paths with low opacity and the percentile lines with full-weight strokes + a `ReferenceLine` at the FIRE number (same as S-09).
  - Volatility persistence: is the new volatility input saved per-user (like the other `fire_*` columns) or session-only? (Owner: planner) Recommendation: v1 session-only (no migration) to keep the slice to one page + one module; promote to a persisted `fire_return_volatility` column later if users want it sticky. If persisted, mirror the S-14 migration pattern (new column → `database.types.ts` Row/Insert/Update → `PREFS_SELECT` → validation branch → form field).
  - Menu label, route & icon: needs a short, clear name slotted into `TopbarMenu.tsx` (current items: Dashboard / Assets / Balance / FIRE / Settings). (Owner: planner) Recommendation: label **"Forecast"** at route `/dashboard/forecast` (or `/dashboard/monte-carlo`), placed right after **FIRE** (it is the probabilistic sibling of the FIRE projection); Lucide icon `Dices` (conveys the randomized/Monte Carlo nature) or `TrendingUp`. Add the matching link on `dashboard/fire.astro` near the projection chart.
  - Input source on first visit: reuse the persisted `fire_*` prefs exactly as `dashboard/fire.astro` does (SSR load → `Partial<FireInputs>`), so the simulation opens pre-filled and consistent with the deterministic projection. If FIRE inputs are unset, degrade to the same defaults `FireCalculatorForm` uses and/or prompt the user to set up FIRE first (link back to `/dashboard/fire`).
- **Risk:** The probabilistic math is easy to get subtly wrong — drawing returns in nominal vs real terms, an unseeded RNG that makes tests flaky, an unclamped Normal draw producing a negative balance, or rendering thousands of SVG lines and jANKing the page. Mitigants: (a) isolate everything in a pure, **seed-injected**, unit-tested `src/lib/monte-carlo.ts` that reuses `fire.ts`'s `toRealReturn` and FIRE-number derivation so both projection views agree on assumptions; (b) clamp the per-year return multiplier; (c) compute N paths but render only a sampled subset + percentile bands; (d) reuse the `FireProjectionChart` Recharts conventions rather than rebuilding chart scaffolding; (e) carry the same "estimate, not financial advice" disclaimer S-09 uses — a probability reads as a promise even more than a single line does.
- **Status:** done

### S-17: Contributions vs market growth

- **Outcome:** user sees how much of each snapshot-to-snapshot change in net worth came from money they added (contributions) vs market movement (growth) — e.g. a stacked bar per interval where `contribution + growth = total change` — so the trend chart distinguishes "I saved" from "the market moved."
- **Change ID:** `contributions-vs-growth`
- **PRD refs:** — (post-MVP snapshot-insight extension; not a PRD functional requirement)
- **Prerequisites:** `F-01`, `S-01`, `S-02` (snapshot history + `convertAmount`/`computeNetWorth` in `src/lib/net-worth.ts` + the Recharts lib), `S-05` (display currency); reuses the S-11/S-12 snapshot-read + `(name, category_id)` patterns
- **Parallel with:** `S-18` and all slices after `S-02`
- **Blockers:** —
- **Unknowns:**
  - **Contribution capture (the core unknown).** The schema carries no contribution or quantity data — `assets` hold only a monetary `amount`, and `snapshot_items` store `original_amount`/`converted_amount`/`exchange_rate_usd` with no unit price or quantity — so market growth cannot be mechanically inferred. Options: (a) a single per-interval net-contribution number captured at snapshot time; (b) a per-asset contributions log. (Owner: planner, by: during `/10x-plan`) Recommendation: **v1 = (a)** — add a nullable `net_contribution NUMERIC(18,2)` column to `snapshots` (migration mirrors the `show_on_chart` / `fire_*` column-add pattern), entered via an optional "money added since last snapshot" field on the snapshot-save flow. Decomposition per interval: `growth = (NW_t − NW_{t−1}) − net_contribution`.
  - **Missing data.** Old snapshots and any interval without a recorded contribution must render an "unknown split" / growth-only state — never crash or mislabel. (Owner: planner)
  - **Currency.** Store the contribution in the snapshot's `display_currency` at entry time; document the cross-currency caveat (same family as the existing mixed-rate snapshot caveat). (Owner: planner)
  - **Presentation.** A new stacked-bar chart (Recharts — do **not** introduce a new lib) under the net-worth chart on the dashboard or a small dedicated section; isolate the per-interval math in a pure, unit-tested `src/lib/contributions.ts`. (Owner: planner)
  - **Scope guard.** A savings-rate metric (contributions ÷ income) needs income tracking the app lacks — keep v1 to the contributions-vs-growth split only. (Owner: planner)
- **Risk:** the decomposition is only as honest as the entered contributions — a missed or wrong entry mislabels market growth, and interval pairing (snapshot N vs N−1) is an easy off-by-one. Mitigants: opt-in per interval with an explicit "unknown split" state; isolate the series builder in a pure, table-tested `src/lib/contributions.ts` reusing `convertAmount` and the signed-`contribution()` convention from `src/lib/movers.ts`; a nullable column so the feature degrades cleanly on historical data.
- **Status:** planned

### S-18: Allocation-drift alerts

- **Outcome:** when any of the user's balancer cards has a **real** allocation that has drifted beyond a threshold from its **target** (e.g. an asset's real % is more than ±5pp off target), the dashboard shows a drift-alert card naming the worst-drifting assets with a link to `/dashboard/balancer`. Gated by a settings toggle (on by default); when the user has no cards/targets, the card is absent.
- **Change ID:** `allocation-drift-alerts`
- **PRD refs:** — (post-MVP portfolio extension; not a PRD functional requirement)
- **Prerequisites:** `F-01`, `S-01`, `S-02` (`convertAmount` in `src/lib/net-worth.ts` + the dashboard host + rates load), `S-15` (`allocation_cards` + `allocation_targets` + `computeAllocation` in `src/lib/allocation.ts`)
- **Parallel with:** `S-17` and all slices after `S-15`
- **Blockers:** —
- **Unknowns:**
  - **Drift metric.** Per-asset drift `= realPct − targetPct` (percentage points); card-level severity = max absolute per-asset drift. (Owner: planner) Recommendation: alert when a card's max abs drift `≥ threshold`; list the top offenders.
  - **Threshold.** Fixed default constant (≈5pp) in the lib for v1; promote to a `drift_threshold_pct` preference later. (Owner: planner)
  - **Settings gating.** Add `show_drift_alerts BOOLEAN NOT NULL DEFAULT TRUE` to `user_preferences`, threaded schema → `database.types.ts` (Row/Insert/Update) → `PREFS_SELECT` + a validation branch in `api/user-preferences/index.ts` → a checkbox in `SettingsForm.tsx`, mirroring the S-14 `show_fire_dashboard` precedent exactly. (Owner: planner)
  - **Declared sum ≠ 100.** S-15 allows declared targets that don't sum to 100, while `realPct` is normalized to 100 by construction — comparing them raw would skew drift. (Owner: planner) Recommendation: **normalize each card's declared targets to its own `declaredSum` before differencing** so both sides sit on a 100 base; surface a small note when declared ≠ 100.
  - **Scope of cards.** Evaluate all of the user's cards and show the most-drifted card(s). Degrade to nothing when there are no cards/targets or the selected-value denominator is near zero (reuse `computeAllocation`'s `realPct === null` guard). (Owner: planner)
  - **Data load.** `dashboard.astro` already loads assets + rates (for the FIRE card); extend it to also load `allocation_cards` + `allocation_targets`, reusing the balancer page's SSR load pattern, and pass them into a new gated `DriftAlerts` island. (Owner: planner)
- **Risk:** low — read-and-present over the existing, tested allocation engine. Main risks: (a) declared-sum-≠-100 skewing the comparison — mitigant: normalize declared within the card; (b) empty / no-card / near-zero-denominator states must render nothing, not crash — mitigant: reuse `computeAllocation`'s null-`realPct` guard and `EPSILON`; (c) keep the math pure — extend `src/lib/allocation.ts` with a unit-tested `computeDrift(...)` helper reusing `computeAllocation`, `EPSILON`, and the currency-cast boundary.
- **Status:** planned

### S-19: Precious-metals price fetch on asset entry

- **Outcome:** when the user adds or edits a **precious-metals** asset (the `precious_metals` category already seeded in `supabase/seed.sql`), the app auto-fetches the current gold/silver spot price, shows it converted into the user's display currency, and auto-calculates the asset's total value from an entered quantity (troy ounces) — exactly like the crypto flow does for BTC/ETH. If the live fetch fails, a cached price or manual entry is used. This closes the gap where a user "has or adds" a metals asset but must look the price up by hand.
- **Change ID:** `metal-price-fetch`
- **PRD refs:** — (post-MVP pricing extension; the precious-metals sibling of the crypto FR-019/FR-020 pricing flow, not itself a PRD functional requirement)
- **Prerequisites:** `F-01` (schema / `assets` + a price-cache table), `S-01` (asset CRUD + `AssetForm` + the `precious_metals` category this extends), `S-03` (the crypto price-fetch pattern this mirrors end-to-end: `getPrice`/cache/`/api/*-price`/form-conditional; reuses `exchange-rates.ts` for USD→display conversion)
- **Parallel with:** all slices after `S-03` (independent read-and-fetch layer; adds one lib + one API route + one `AssetForm` branch; no impact on other slices)
- **Blockers:** —
- **Unknowns:**
  - **Metals price API (the core unknown).** Which free public API for gold/silver spot prices, and — critically — is it reachable from Cloudflare Workers at runtime? This is the exact trap S-03 hit: CoinGecko returns 403 from Workers, so Binance was used instead (see §Done S-03 lesson). (Owner: user/dev, by: before S-19 planning) Recommendation: shortlist keyless, Workers-reachable options (e.g. a metals endpoint that returns XAU/XAG in USD) and **verify accessibility from the deployment target before committing** — do not assume a provider works from a browser test. Prices are quoted per **troy ounce in USD**; convert to display currency via `getRates()` from `src/lib/exchange-rates.ts` (`priceUsd * rates[displayCurrency]`), mirroring how crypto USD prices flow to the dashboard.
  - **Symbol persistence.** `assets` has a nullable `crypto_symbol` and a `quantity` column already. Overload `crypto_symbol` for XAU/XAG, or add a dedicated nullable `metal_symbol` column? (Owner: planner, by: during `/10x-plan`) Recommendation: add a dedicated nullable `metal_symbol` (XAU/XAG) via a small column-add migration (mirrors the `quantity` / `crypto_symbol` precedents) rather than overloading `crypto_symbol` with non-crypto semantics; reuse the existing `quantity` column for ounces. Keep the metal set tight for v1: gold (XAU) + silver (XAG), leaving platinum/palladium as a trivial follow-up map entry.
  - **Price cache.** Reuse the `crypto_price_cache` table/RPC as-is, generalize it, or add a parallel `metal_price_cache`? (Owner: planner) Recommendation: add a parallel `metal_price_cache` table + `upsert_metal_price_cache` RPC that mirrors `20260531223101_crypto_price_cache.sql` one-to-one (same TTL/shape), keeping the two pricing sources cleanly separated; do **not** cross-contaminate the crypto cache keyspace.
  - **Stored currency.** Crypto stores `amount` in USD (`currency = USD`, `amount = quantity × priceUsd`) and lets the dashboard convert. (Owner: planner) Recommendation: mirror it exactly — store metals `amount` in USD so `computeNetWorth`/`convertAmount` handle display-currency conversion uniformly, and show the live display-currency figure only as a form-time convenience.
  - **Form UX.** Add a `categoryId === "precious_metals"` conditional branch to `AssetForm.tsx` alongside the existing `crypto` branch (metal picker + quantity-in-oz + onBlur→fetch→`amount = qty × price` + status messages). (Owner: planner) Recommendation: extract the shared crypto/metal fetch-and-calculate UI into one reusable block rather than copy-pasting the crypto branch, so the two pricing flows don't drift.
  - **"Have" vs "add" scope.** The request mentions users who *have* metals assets, not only those adding one. Crypto only fetches at entry/edit time (no background refresh). (Owner: planner) Recommendation: keep v1 to the entry/edit-time fetch like S-03; a background/on-load re-price of existing metals holdings is a separate, larger concern (touches the dashboard read path) — defer it and note it here.
- **Risk:** Low-to-moderate — a near-clone of the tested S-03 flow, so the main risks are the two S-03 already taught: (a) **provider reachability from Workers** — a provider that works in a browser but 403s from Cloudflare Workers ships broken; mitigant: verify from the deployment target before committing, and implement the cache/manual-entry fallback concurrently, not as a later patch (same as S-03); (b) **unit/currency correctness** — spot prices are per troy ounce in USD and must be converted through `getRates()` before display, and quantity units (oz vs grams) must be stated and consistent; mitigant: isolate the fetch/convert/cache logic in a pure, unit-tested `src/lib/metal-prices.ts` mirroring `crypto-prices.ts`, and reuse `exchange-rates.ts` rather than re-deriving conversion.
- **Status:** planned

## Backlog Handoff

| Roadmap ID | Change ID                  | Suggested issue title                                            | Ready for `/10x-plan` | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | -------------------------- | ---------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01       | supabase-schema-migrations | Design and migrate Supabase schema                               | yes                   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S-01       | asset-management           | Build asset CRUD with currency conversion                        | yes                   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S-02       | dashboard-snapshots-chart  | Dashboard: net worth, deltas, chart                              | yes                   | depends on S-01                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S-03       | crypto-price-fetch         | Live crypto price fetch on asset entry                           | yes                   | parallel with S-01 and S-02                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S-04       | dashboard-assets-summary   | Dashboard: assets summary by currency                            | yes                   | depends on S-02                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S-05       | user-settings              | Settings: display currency & preferences                         | yes                   | depends on S-02                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S-06       | mobile-refactor            | Mobile: responsive UI pass (nav, buttons, forms)                 | yes                   | depends on S-02; refactor of all authed pages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S-07       | asset-list-mobile-reflow   | AssetList: reflow table to cards on mobile                       | yes                   | depends on S-06; data-list reflow deferred from S-06                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S-08       | pwa-installable            | PWA: installable mobile app via @serwist/astro                   | yes                   | depends on S-06+S-07; installable shell on top of mobile-UI pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S-09       | fire-calculator            | FIRE calculator: project years-to-FI from current net worth      | yes                   | depends on S-01/S-02/S-05; current net worth seeds the starting principal; was a PRD non-goal, promoted 2026-06-11                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S-10       | landing-page               | Dedicated BitWorth landing page (replace starter placeholder)    | yes                   | independent; reuses design system + auth CTAs; product preview from public/template.png                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S-11       | dashboard-top-movers       | Dashboard: top movers vs last snapshot (gainers/losers)          | yes                   | depends on S-02; replaces the placeholder card; first reader of `snapshot_items`; match on (name, category_id)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S-12       | per-asset-trends           | Per-asset / per-category trend charts from snapshot history      | yes                   | depends on S-02; reuses S-11's snapshot_items read + matching; reuse Recharts (S-02), no new charting lib                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S-13       | data-backup-import-export  | Settings: full data backup export/import (one file)              | yes                   | depends on F-01/S-02/S-05; hosts on the S-05 settings page; reads/writes all user-owned tables; no DB transactions — prefer a restore RPC or compensating-delete                                                                                                                                                                                                                                                                                                                                                                                |
| S-14       | fire-dashboard             | Dashboard: settings-gated FIRE-progress card                     | yes                   | depends on F-01/S-02/S-05/S-09; reuses `src/lib/fire.ts` + `computeNetWorth`; new `show_fire_dashboard` pref (default TRUE) + a new runway helper; placeholder links to `/dashboard/fire`                                                                                                                                                                                                                                                                                                                                                       |
| S-15       | asset-balancer             | Balance page: target vs real allocation + per-asset % label      | yes                   | depends on F-01/S-01/S-02; new `allocation_targets` table (FK to `assets`, `ON DELETE CASCADE`) + new `/dashboard/balancer` page with two Recharts PieCharts (first PieChart usage) + a "% of all assets" label on `AssetRow`/`AssetCard`; isolate math in `src/lib/allocation.ts`; new "Balance" nav item                                                                                                                                                                                                                                      |
| S-16       | monte-carlo-simulation     | Forecast page: Monte Carlo probability of reaching FIRE goal     | yes                   | depends on F-01/S-01/S-02/S-09; reuses `src/lib/fire.ts` (`toRealReturn` + FIRE number) and the `dashboard/fire.astro` SSR prefs load; new pure, **seed-injected** `src/lib/monte-carlo.ts` (parametric Normal real returns, clamped draws) + new `/dashboard/forecast` page rendering a sampled subset of paths + P10/P50/P90 bands in Recharts (reuse `FireProjectionChart` conventions); new "Forecast" nav item + a link from the FIRE page; one new volatility input (session-only in v1, no migration); "estimate, not advice" disclaimer |
| S-17       | contributions-vs-growth    | Decompose net-worth change into contributions vs market growth   | yes                   | depends on S-02/S-05; growth can't be inferred from existing data → add a nullable `snapshots.net_contribution` column + an optional input on the snapshot-save flow; isolate per-interval math in `src/lib/contributions.ts`; "unknown split" state for intervals without data                                                                                                                                                                                                                                                                 |
| S-18       | allocation-drift-alerts    | Dashboard alert when real allocation drifts from a card's target | yes                   | depends on S-15; reuses `computeAllocation` in `src/lib/allocation.ts` (extend with a pure `computeDrift`); new `show_drift_alerts` pref (default TRUE) mirroring S-14; normalize declared targets within each card before differencing                                                                                                                                                                                                                                                                                                         |
| S-19       | metal-price-fetch          | Live gold/silver spot price on precious-metals asset entry       | yes                   | depends on S-01/S-03; mirrors the crypto flow — new pure `src/lib/metal-prices.ts` + `metal_price_cache` table/RPC (clone `crypto_price_cache`) + `GET /api/metal-price?symbol=XAU` + a `precious_metals` branch in `AssetForm.tsx`; new nullable `assets.metal_symbol` column, reuse `quantity` (oz); prices come per troy oz in USD → convert via `exchange-rates.ts`; **verify the metals API is reachable from Cloudflare Workers before committing (S-03 lesson: CoinGecko 403s from Workers)**                                              |

## Open Roadmap Questions

1. **Exchange rate API** — Which free public API for exchange rates? (Owner: user, by: before F-01) Resolved: frankfurter.app (free, no key) — implemented in `src/lib/exchange-rates.ts`.
2. **Crypto price API** — Which free public API for crypto prices? (Owner: user, by: before F-01) Resolved: Binance avgPrice API — CoinGecko returns 403 from Cloudflare Workers at runtime; Binance works without auth.
3. **Snapshot auto-save trigger** — Should auto-save trigger on first login each calendar month, or on a fixed day-of-month (e.g., 1st)? (Owner: user, by: before S-02) **Closed 2026-06-16:** moot — auto-save (FR-016) dropped; staying with the manual snapshot trigger (FR-017, shipped in S-02). Issue #8 closed (not planned).
4. **Display currency persistence** — Does the display currency preference persist per user across sessions? (Owner: user, by: before F-01) Resolved: yes, per-user in `user_preferences` table; configurable via the settings tab (S-05).
5. **Demo mode scope** — Demo mode is nice-to-have per PRD. If time permits, what sample data should it include? (Owner: user, by: before S-02) **Closed 2026-06-16:** demo mode dropped entirely; will not be built. Resolved as "skip entirely." Issue #10 closed (not planned).

## Parked

- **Demo mode (FR-002)** — **Dropped 2026-06-16.** Will not be built (MVP or post-MVP). Resolved as "skip entirely"; decision recorded in issue #10 (closed, not planned).
- **Snapshot auto-save (FR-016)** — **Dropped 2026-06-16.** The manual snapshot trigger (FR-017, shipped in S-02) is the snapshot mechanism; auto-save will not be built. The first-login-of-month vs fixed-day-of-month question is moot. Decision recorded in issue #8 (closed, not planned); revisit only if auto-save is ever picked up.
- **FIRE calculator** — Was a PRD §Non-Goal; promoted to a planned slice (**S-09**) on 2026-06-11 per user decision. Uses current net worth as the projection starting point. The PRD §Non-Goals section should be updated to reflect this scope change.
- **Bank/broker integrations** — Non-goal per PRD §Non-Goals.
- **Data export (PDF, CSV)** — Non-goal per PRD §Non-Goals. (Note: full-account **backup** export/import in JSON is a distinct concern — data portability, not formatted reporting — and is now a planned slice, **S-13**. The PDF/CSV reporting export remains a non-goal.)
- **Native mobile app** — Non-goal per PRD §Non-Goals.
- **Observability scaffolding** — Baseline reports no logging/error-tracking. Not blocking MVP; observability is deferred until a production incident surfaces a need.
- **Charting library** — Not in the baseline. A decision (Chart.js, Recharts, visx) will be made during S-02 planning.

## Done

- **F-01: Supabase schema and migrations** — Implemented 2026-05-29 → `context/changes/supabase-schema-migrations/`. Lesson: —.
- **S-01: Asset management with currency conversion** — Implemented 2026-05-30 → `context/changes/asset-management/`. Lesson: —.
- **S-02: Dashboard — net worth display, snapshots, and trend chart** — Implemented 2026-05-31 → `context/changes/dashboard-snapshots-chart/`. Lessons: DB multi-table writes must be atomic; public API endpoints need explicit auth decisions.
- **S-03: Crypto price fetch on asset entry** — Implemented 2026-06-01 → `context/changes/crypto-price-fetch/`. Note: Binance avgPrice API used instead of CoinGecko (CoinGecko returns 403 from Cloudflare Workers). Lessons: verify API accessibility from deployment target before committing to a provider.
- **S-04: Dashboard assets summary** — Implemented 2026-05-31 → `context/changes/dashboard-assets-summary/`. Lessons: —.
- **S-05: User settings** — Implemented 2026-06-03 → `context/changes/user-settings/`. Lessons: —.
- **S-06: Mobile refactor** — Implemented 2026-06-03 → `context/changes/mobile-refactor/`. Lessons: —.
- **S-07: AssetList mobile reflow** — Implemented 2026-06-03 → `context/changes/asset-list-mobile-reflow/`. Lessons: —.
- **S-08: PWA / installable mobile app** — Implemented 2026-06-04 → `context/changes/pwa-installable/`. Note: hand-rolled `vite-plugin-pwa@1.3.0` as a custom Astro integration (avoids `@serwist/astro` preview dep); manifest + service worker + offline shell + Android/iOS install UX. Lessons: —.
- **S-09: FIRE calculator** — Implemented 2026-06-11 → `context/changes/fire-calculator/`. Note: projection isolated in a pure, unit-tested `src/lib/fire.ts`; reuses the S-02 Recharts lib. Lessons: —.
- **S-10: Dedicated landing page** — Implemented 2026-06-16 → `context/changes/landing-page/`. Lessons: —.
- **S-11: Dashboard top movers** — Implemented 2026-06-19 → `context/changes/dashboard-top-movers/`. Note: first reader of `snapshot_items`; `(name, category_id)` matching + signed net-worth contributions isolated in a pure, unit-tested `src/lib/movers.ts`; both sides re-converted at today's rates. Lessons: —.
- **S-12: Per-asset trends** — Implemented 2026-06-19 → `context/changes/per-asset-trends/`. Note: per-asset `show_on_chart` opt-in flag threaded schema→form→API; pure, unit-tested `src/lib/asset-trends.ts` series builder reuses S-11's `(name, category_id)` matching + `contribution()` over all snapshot history; `AssetTrendsChart` island (Recharts, master + indexed/absolute toggles, generated HSL palette, `connectNulls={false}` broken lines). Impl-review APPROVED (0 critical/warning). Lessons: —.
- **S-13: Data backup import/export** — Implemented 2026-06-21 → `context/changes/data-backup-import-export/`. Note: versioned JSON envelope + pure, unit-tested `src/lib/backup.ts` (de)serializer; `GET /api/backup/export` (attachment) + `POST /api/backup/import` (replace-all vs append-merge); restore remaps `user_id` to `auth.uid()` and regenerates snapshot ids; hosted on the S-05 settings page. Impl-review on file. Lessons: —.
- **S-14: FIRE dashboard card** — Implemented 2026-06-23 → `context/changes/fire-dashboard/`. Note: settings-gated `show_fire_dashboard` pref (default TRUE) threaded schema→`database.types.ts`→`PREFS_SELECT`→validation→`SettingsForm`; pure runway helper + guarded `computeFireProjection` reuse; `FireProgress` island on the dashboard with CSS-transition progress bar; "no FIRE data" placeholder links to `/dashboard/fire`. Impl-review on file. Lessons: —.
- **S-15: Asset balancer (target allocation)** — Implemented 2026-06-24 → `context/changes/asset-balancer/`. Note: new `allocation_targets` table (FK to `assets`, `ON DELETE CASCADE`, RLS); pure, unit-tested `src/lib/allocation.ts` (target %, real %, per-asset share, buy-plan water-filling); `/dashboard/balancer` page with two Recharts PieCharts (first PieChart usage) + buy-plan card; "% of all assets" label on `AssetRow`/`AssetCard`; new "Balance" nav item. Impl-review on file. Lessons: —.
- **S-16: Monte Carlo simulation** — Implemented 2026-06-25 → `context/changes/monte-carlo-simulation/`. Note: pure, **seed-injected** `src/lib/monte-carlo.ts` (mulberry32 + Box–Muller + type-7 percentiles; parametric Normal real returns, clamped per-year growth multiplier); `/dashboard/forecast` page renders ~100 sampled paths + P10/P50/P90 bands + FIRE-number `ReferenceLine` in Recharts (reuses `FireProjectionChart` conventions); session-only volatility input (no migration); new "Forecast" nav item + FIRE-page cross-link. Impl-review NEEDS ATTENTION → all findings fixed (memoized compute, distinct sampled-path color, DEV-gated sampling log). Lessons: seed-injected RNG as the testability seam for stochastic modules.
- **F-01: Supabase schema and migrations** — Archived 2026-07-11 → `context/archive/2026-05-28-supabase-schema-migrations/`. Lesson: —.
- **S-01: Asset management with currency conversion** — Archived 2026-07-11 → `context/archive/2026-05-29-asset-management/`. Lesson: —.
- **S-02: Dashboard — net worth display, snapshots, and trend chart** — Archived 2026-07-11 → `context/archive/2026-05-30-dashboard-snapshots-chart/`. Lesson: —.
- **S-03: Crypto price fetch on asset entry** — Archived 2026-07-11 → `context/archive/2026-05-31-crypto-price-fetch/`. Lesson: —.
- **S-04: Dashboard assets summary** — Archived 2026-07-11 → `context/archive/2026-05-31-dashboard-assets-summary/`. Lesson: —.
- **S-05: User settings** — Archived 2026-07-11 → `context/archive/2026-06-03-user-settings/`. Lesson: —.
- **S-06: Mobile refactor** — Archived 2026-07-11 → `context/archive/2026-06-03-mobile-refactor/`. Lesson: —.
- **S-07: AssetList mobile reflow** — Archived 2026-07-11 → `context/archive/2026-06-03-asset-list-mobile-reflow/`. Lesson: —.
- **S-08: PWA / installable mobile app** — Archived 2026-07-11 → `context/archive/2026-06-03-pwa-installable/`. Lesson: —.
- **S-09: FIRE calculator** — Archived 2026-07-11 → `context/archive/2026-06-11-fire-calculator/`. Lesson: —.
- **S-10: Dedicated landing page** — Archived 2026-07-11 → `context/archive/2026-06-16-landing-page/`. Lesson: —.
- **S-11: Dashboard top movers** — Archived 2026-07-11 → `context/archive/2026-06-19-dashboard-top-movers/`. Lesson: —.
- **S-12: Per-asset trends** — Archived 2026-07-11 → `context/archive/2026-06-19-per-asset-trends/`. Lesson: —.
- **S-13: Data backup import/export** — Archived 2026-07-11 → `context/archive/2026-06-20-data-backup-import-export/`. Lesson: —.
