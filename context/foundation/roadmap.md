---
project: "BitWorth"
version: 1
status: draft
created: 2026-05-26
updated: 2026-06-03
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

| ID    | Change ID                    | Outcome (user can …)                                                  | Prerequisites         | PRD refs              | Status   |
| ----- | ---------------------------- | --------------------------------------------------------------------- | --------------------- | --------------------- | -------- |
| F-01  | supabase-schema-migrations   | (foundation) Supabase schema landed; migrations ready    | —             | NFR-perf, FR-006-020  | done     |
| S-01  | asset-management             | add/edit/delete assets with currency conversion           | F-01          | US-03, FR-006-010     | done     |
| S-02  | dashboard-snapshots-chart    | see net worth, deltas, and trend chart from snapshots    | F-01, S-01    | US-01, FR-011-018     | done     |
| S-03  | crypto-price-fetch           | see live BTC/ETH prices when adding crypto assets         | F-01          | FR-019-020            | done    |
| S-04  | dashboard-assets-summary     | see assets summary by currency on dashboard              | F-01, S-01, S-02 | —                | done     |
| S-05  | user-settings                | configure display currency and preferences in a settings tab | F-01, S-02    | FR-011            | done     |
| S-06  | mobile-refactor              | use the dashboard, assets, and forms comfortably on phone-sized viewports | F-01, S-01, S-02, S-04 | — | done     |
| S-07  | asset-list-mobile-reflow    | view and act on every asset in the list on a phone-sized viewport          | F-01, S-01, S-06 | — | done  |
| S-08  | pwa-installable              | install the app to a phone's home screen and launch it standalone at /dashboard | F-01, S-06, S-07 | — | planned  |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme          | Chain                                    | Note                                                                                    |
| ------ | -------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| A      | Core tracking  | `F-01` → `S-01` → `S-02`               | Main path: schema → assets → dashboard with charts                |
| B      | Crypto pricing | `F-01` → `S-03`                         | Parallel branch after F-01; can run alongside S-01/S-02            |
| C      | Dashboard UX  | `F-01` → `S-01` → `S-02` → `S-04`    | Builds on S-02 to complete the dashboard view                     |
| D      | User settings | `F-01` → `S-05`                       | Parallel branch after S-02; UI for `user_preferences`              |
| E      | Responsive UI | `F-01` → `S-06` → `S-07` → `S-08`       | S-06/S-07 make the app usable on mobile; S-08 ships it as an installable PWA |

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
  - Snapshot auto-save trigger (first-login-of-month vs fixed day-of-month) — Owner: user. Block: no (manual trigger is must-have; auto-save is secondary and can ship with the simpler trigger first).
- **Risk:** Chart component is not in the baseline. Picking a charting library (Chart.js, Recharts, visx) is a one-time decision that should be made once and applied consistently. NFR §2s-load means chart data must be fetched efficiently, not re-derived on every page load.
- **Status:** proposed

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
- **Status:** planned

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

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                      | Ready for `/10x-plan` | Notes                                              |
| --------- | ----------------------------- | ------------------------------------------- | --------------------- | -------------------------------------------------- |
| F-01      | supabase-schema-migrations   | Design and migrate Supabase schema        | yes                   | —                                  |
| S-01      | asset-management             | Build asset CRUD with currency conversion | yes                   | —                                  |
| S-02      | dashboard-snapshots-chart    | Dashboard: net worth, deltas, chart      | yes                   | depends on S-01                    |
| S-03      | crypto-price-fetch           | Live crypto price fetch on asset entry    | yes                   | parallel with S-01 and S-02        |
| S-04      | dashboard-assets-summary     | Dashboard: assets summary by currency     | yes                   | depends on S-02                    |
| S-05      | user-settings                | Settings: display currency & preferences  | yes                   | depends on S-02                         |
| S-06      | mobile-refactor              | Mobile: responsive UI pass (nav, buttons, forms) | yes                   | depends on S-02; refactor of all authed pages |
| S-07      | asset-list-mobile-reflow    | AssetList: reflow table to cards on mobile  | yes                   | depends on S-06; data-list reflow deferred from S-06 |
| S-08      | pwa-installable              | PWA: installable mobile app via @serwist/astro | yes                   | depends on S-06+S-07; installable shell on top of mobile-UI pass |

## Open Roadmap Questions

1. **Exchange rate API** — Which free public API for exchange rates? (Owner: user, by: before F-01) Popular options: frankfurter.app, exchangerate.host, Open Exchange Rates.
2. **Crypto price API** — Which free public API for crypto prices? (Owner: user, by: before F-01) Resolved: Binance avgPrice API — CoinGecko returns 403 from Cloudflare Workers at runtime; Binance works without auth.
3. **Snapshot auto-save trigger** — Should auto-save trigger on first login each calendar month, or on a fixed day-of-month (e.g., 1st)? (Owner: user, by: before S-02) Manual trigger (FR-017) ships regardless.
4. **Display currency persistence** — Does the display currency preference persist per user across sessions? (Owner: user, by: before F-01) Recommended: yes, per-user in `user_preferences` table.
5. **Demo mode scope** — Demo mode is nice-to-have per PRD. If time permits, what sample data should it include? (Owner: user, by: before S-02) Parked for now.

## Parked

- **Demo mode (FR-002)** — Marked nice-to-have in PRD. Won't be built in the main plan; revisit after S-02 ships if time allows.
- **FIRE calculator** — Non-goal per PRD §Non-Goals.
- **Bank/broker integrations** — Non-goal per PRD §Non-Goals.
- **Data export (PDF, CSV)** — Non-goal per PRD §Non-Goals.
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
