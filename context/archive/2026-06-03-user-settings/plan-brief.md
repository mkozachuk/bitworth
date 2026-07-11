# User Settings — Plan Brief

> Full plan: `context/changes/user-settings/plan.md`

## What & Why

Ship the S-05 user-settings slice: a dedicated `/dashboard/settings` page where the user can change their display currency (PLN/USD/EUR) and theme (light/dark/system). The dashboard and assets page currently hardcode `displayCurrency = "USD"`, while the snapshot save API already reads the user's stored preference — an asymmetric write path the roadmap flagged as the main risk. This plan closes the asymmetry, adds the missing UI, and migrates the app from dark-only to a working light/dark/system theme.

## Starting Point

- `user_preferences` table exists (`supabase/migrations/20260529190856_initial_schema.sql:9-15`) with `display_currency`, an `updated_at` trigger, and a row auto-created on `auth.users` insert. RLS `WITH CHECK` was added in the Phase 5 lesson-§4 closure.
- `src/pages/api/snapshots/index.ts:80-90` reads `user_preferences.display_currency` correctly.
- `src/pages/dashboard.astro:21` and `src/pages/dashboard/assets/index.astro:20` hardcode `"USD"`. Dashboard displays in USD regardless of user preference.
- Topbar (`src/components/Topbar.astro:12-25`) shows only `Dashboard | Assets | Sign out`. No Settings link.
- Tailwind v4 dark mode is wired (`@custom-variant dark (&:is(.dark *));` at `global.css:4`) with full light/dark CSS variable sets, but the app uses dark-only tokens (`bg-white/5`, `text-white/80`, `border-white/10`, `bg-cosmic`) that don't switch.
- §6.4 contract test (`src/pages/api/api-auth-contract.test.ts`) auto-audits every new API route for an auth check or public-route justification.
- Lesson §2 (explicit auth decisions) and §3 (currency cast boundary) apply directly.

## Desired End State

- Authenticated user visits `/dashboard/settings` and changes `display_currency` and `theme`. Changes persist per user across sessions and devices.
- Dashboard and assets page render in the user's chosen display currency — the number the user sees matches the currency their snapshots are stored in.
- Chart shows a "Your chart mixes USD and PLN snapshots from before/after your currency change on YYYY-MM-DD" banner when snapshot `display_currency` values differ across rows, and each tooltip labels the snapshot's own currency.
- Theme toggle (light/dark/system) actually changes the app's appearance with no flash of unstyled content. Light mode has its own background and a contrasting surface token set.
- A `Settings` link in the topbar takes the user to `/dashboard/settings`.
- Per-handler integration tests pin the new API at the same level as the existing `/api/assets` tests.

## Key Decisions Made

| Decision                          | Choice                                                                                                   | Why (1 sentence)                                                                                                      | Source |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| Settings scope                    | Display currency + theme (light/dark/system), both functional                                            | Validates the "home for future preferences" pattern with a second, real field; full restyling per the chosen tradeoff | Plan   |
| Currency change → historical data | Show old in old currency, new in new; banner + per-point currency code on chart                          | Honest to the data — no false precision from re-conversion; per-point code is the most informative signal             | Plan   |
| Settings page shape               | Dedicated Astro page at `/dashboard/settings`                                                            | Matches the existing `/dashboard/assets` pattern; bookmarkable; room to grow                                          | Plan   |
| API method                        | `PUT /api/user-preferences` (singleton)                                                                  | RESTful for an update; pairs naturally with GET                                                                       | Plan   |
| Theme implementation              | Tailwind v4 `dark:` variant with `darkMode: 'class'`                                                     | Custom variant already wired at `global.css:4`; no config change                                                      | Plan   |
| Theme storage                     | New `theme` column on `user_preferences` (migration)                                                     | Single source of truth; matches column-per-preference shape                                                           | Plan   |
| Theme no-FOUC                     | Inline script in `<head>` reading server-rendered `Astro.locals.theme` + `prefers-color-scheme` fallback | Prevents the light/dark flash on first paint                                                                          | Plan   |
| Navigation                        | Plain topbar text link between Assets and Sign out                                                       | Smallest change; consistent with current inline nav                                                                   | Plan   |
| Tests                             | Per-handler integration tests (GET + PUT scenarios)                                                      | Same ceiling as `/api/assets` per §6.4; the contract test auto-audits auth                                            | Plan   |
| Display currency wiring           | Server-side read in middleware (`Astro.locals.displayCurrency`); pages fall back to `'USD'` if missing   | Avoids three separate round-trips for the same data; matches the existing snapshot-API fallback                       | Plan   |
| Theme mixed-snapshot UX           | Banner above chart + currency code in each tooltip                                                       | Most informative per-point; minimal new components                                                                    | Plan   |

## Scope

**In scope:**

- One new migration adding `theme` column with CHECK constraint
- `bg-cosmic-light` utility and `bg-cosmic-light dark:bg-cosmic` swap on all 6 page roots
- Sweep every dark-only Tailwind token across components and pages to add `dark:` companions; chart palette driven by CSS variables
- Inline no-FOUC theme script in `Layout.astro`
- Middleware exposes `theme` and `displayCurrency` on `Astro.locals`
- `GET /api/user-preferences` and `PUT /api/user-preferences` with the established error shape
- `SettingsForm` React component
- `/dashboard/settings` Astro page
- Topbar `Settings` link
- Mixed-currency banner and per-point currency code on `NetWorthChart`
- Per-handler integration tests (8 scenarios) using the shared `supabase-mock.ts` factory

**Out of scope:**

- Auto-snapshot trigger (S-02 follow-up)
- Demo mode
- Re-converting historical `total_net_worth` values when currency changes (data integrity)
- Date format, number format, or other future settings (the page is the home, but no new field ships)
- Profile/avatar dropdown in the topbar
- Sign-out button consolidation (S-06 mobile refactor territory)
- DOM integration tests on the dashboard render (test-plan §3 Phase 1 deferral still stands)
- Visual diff tooling / Storybook

## Architecture / Approach

```
        ┌──────────────────┐
        │  /dashboard      │
        │   .astro         │ ─── reads Astro.locals.displayCurrency ──┐
        └────────┬─────────┘                                            │
                 │ server-rendered <html class="dark">                  │
                 ▼                                                      ▼
   ┌───────────────────────┐                              ┌──────────────────────┐
   │  middleware.ts        │  loads user + prefs ────────▶ │  user_preferences    │
   │  (theme, displayCur)  │                              │  (display_currency,  │
   └─────────┬─────────────┘                              │   theme)             │
             │                                            └──────────┬───────────┘
             │                                                       │
   ┌─────────▼────────────┐  GET /api/user-preferences ◀────────────┤
   │  /dashboard/settings │  PUT /api/user-preferences               │
   │  SettingsForm        │                                          │
   └──────────────────────┘
```

Five phases in dependency order: (1) theme foundation — migration + no-FOUC script + `bg-cosmic` swap, (2) component token migration — every dark-only token gets a `dark:` companion, (3) settings API + UI + Topbar link, (4) display-currency wiring + mixed-currency chart UX, (5) per-handler integration tests.

## Phases at a Glance

| Phase                        | What it delivers                                                                                                            | Key risk                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. Theme foundation          | Migration adds `theme` column; Layout no-FOUC script; `bg-cosmic-light` utility; `bg-cosmic` swap on 6 page roots           | Server vs client first-paint split — easy to get FOUC if the script runs late                |
| 2. Component token migration | Every `bg-white/5`, `text-white/80`, `border-white/10` gets a `dark:` counterpart; chart palette driven by CSS variables    | Largest blast radius — visual regressions if a token is missed; the chart's hardcoded colors |
| 3. Settings API + UI         | `GET` + `PUT /api/user-preferences`; `SettingsForm`; `/dashboard/settings`; Topbar `Settings` link                          | Default-row handling on PUT (upsert vs insert); validation regex coverage                    |
| 4. Display currency wiring   | `dashboard.astro` + `assets/index.astro` read from `user_preferences`; mixed-currency banner + per-point code on chart      | Refactor cascade — middleware change affects every authed page                               |
| 5. Per-handler tests         | `GET` (401, 200, 404); `PUT` (401, 400 invalid currency, 400 invalid theme, 200 valid, `.eq('user_id', user.id)` chain pin) | Validation regex coverage; structural-property pin visibility                                |

**Prerequisites:** F-01 (Supabase schema), S-01 (asset CRUD), S-02 (dashboard with chart). All done.
**Estimated effort:** 4–6 sessions across 5 phases. Phase 2 is the largest single block (every component); Phases 1, 3, 4 are medium; Phase 5 is small.

## Open Risks & Assumptions

- **No-FOUC and auth state**: the inline script in `<head>` reads `Astro.locals.theme` rendered as a small JSON island. If the script runs _before_ the DOM is parsed for the `data-` island attribute, the fallback to `prefers-color-scheme` will win. The implementation must confirm the script runs synchronously after the island is set but before paint. (Lesson not yet captured; if it surfaces, add a lessons.md entry.)
- **The `as Currency` cast pattern (lesson §3)** means the dashboard's read of `display_currency` from `user_preferences` validates against the literal union and falls back to `'USD'` on mismatch. The fallback is the agreed compromise.
- **Theme mixed-currency banner date derivation**: the plan derives the "currency change date" from the first snapshot in the new currency. This is approximate (a user who changes currency but never saves a snapshot will have no banner; a user who changes and re-changes will see the most recent change). The alternative — a `currency_changed_at` column — is out of scope.
- **Tailwind v4 dark: variant requires `.dark` on `<html>`** (per `@custom-variant dark (&:is(.dark *));`). Any page that wraps its content in a `<div>` (rather than rendering at the document root) needs the dark class on the right ancestor. The current Layout is a `<div>` wrapper around the page content, not the `<html>` element — the script targets `document.documentElement` directly, which is correct.

## Success Criteria (Summary)

- User can change display currency and theme in `/dashboard/settings`; the changes persist per user and apply across sessions.
- Dashboard and assets page render in the user's chosen display currency (no hardcoded USD), and the chart surfaces mixed-currency state with a banner and per-point labels.
- Theme toggle actually changes the app's appearance with no FOUC; light mode is legible across every page.
- Per-handler tests for `GET` and `PUT /api/user-preferences` pass, including the structural-property pin for `.eq('user_id', user.id)`.
