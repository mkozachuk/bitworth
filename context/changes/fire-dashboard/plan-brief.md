# FIRE Dashboard Card — Plan Brief

> Full plan: `context/changes/fire-dashboard/plan.md`

## What & Why

Add a settings-gated FIRE-progress card to the main dashboard. When on (default), it surfaces the user's progress toward financial independence — a progress bar for % of their FIRE number, months of runway at zero income, years-to-FI, and the FIRE number — right where they already check their net worth, instead of only on the separate `/dashboard/fire` calculator page.

## Starting Point

The FIRE engine (`src/lib/fire.ts`) and net-worth helper (`src/lib/net-worth.ts`) already exist and are unit-tested; the FIRE calculator page (`src/pages/dashboard/fire.astro`) is the SSR template to copy. The main `dashboard.astro` already loads assets + exchange rates but does not query `user_preferences` or compute net worth. No boolean preference exists anywhere in the stack yet.

## Desired End State

A "Show FIRE progress on dashboard" checkbox in Settings (on by default) controls a dashboard card. With it on and core FIRE inputs entered, the card shows the bar + three metrics in the display currency; with inputs missing, a placeholder links to the FIRE calculator; with it off, nothing renders.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Preference column | `show_fire_dashboard BOOLEAN NOT NULL DEFAULT TRUE` | Card on by default; mirrors `theme`/`show_on_chart` precedents | Roadmap |
| "No FIRE data" threshold | All core fields non-null (expenses, income, return, inflation, age) + SWR > 0 | Every metric reflects real input; avoids N/A states | Plan |
| Progress % | `netWorth / fireNumber`, label uncapped; bar fill clamped to 100% | Truthful "how far past FI"; bar can't physically overflow | Plan |
| Unreachable FI (`yearsToFi === null`) | Hide the years-to-FI row; keep bar/runway/FIRE number | No negative message; other metrics stay meaningful | Plan |
| Starting principal vs % numerator | Projection uses `override ?? netWorth`; bar % uses live `netWorth` | Projection matches FIRE page; bar shows true current standing | Plan |
| Runway display | `N months (N.N years)`; null when `annualExpenses <= 0` | Readable at both scales; honors "months of runway" wording | Plan |
| Card content | Bar + 3 metrics, no in-card link when configured; placeholder links out | Matches roadmap outcome; clean configured state | Plan |
| Projection compute location | Server-side in `dashboard.astro` (island is presentational) | Read-only card; instant initial render | Plan |
| Runway helper location | `monthsOfRunway` in `src/lib/fire.ts`, table-tested | Centralizes FIRE math; reuses existing test style | Roadmap |
| Nav link gating | Toggle gates only the card, not the `/dashboard/fire` nav link | Calculator stays reachable | Roadmap |
| Bar animation | CSS `transition` on width, disabled under `prefers-reduced-motion` | No new dependency | Roadmap |

## Scope

**In scope:** new boolean preference (migration → types → API → settings UI); a pure `monthsOfRunway` helper + tests; a new presentational `FireProgress` island; dashboard SSR to read prefs/`fire_*`, compute net worth + projection (guarded), and conditionally render.

**Out of scope:** changing the FIRE engine / calculator page / `computeNetWorth`; new FIRE input fields; gating the nav link; charting libs; persisting computed values; capping the % label.

## Architecture / Approach

Bottom-up across four layers. (1) Migration adds the column; types + user-preferences API (`PREFS_SELECT` + a boolean validation branch) expose it. (2) `monthsOfRunway` lands in `fire.ts` with table tests. (3) `SettingsForm` gets an `accent-purple-600` checkbox wired through `settings.astro`. (4) `dashboard.astro` reads prefs + `fire_*`, computes `netWorth` (reusing the existing `getRates`) and a guarded `computeFireProjection`, then passes already-computed values to a new presentational `FireProgress` island placed after `NetWorthDisplay`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Preference + API | `show_fire_dashboard` column, types, GET/PUT support | Migration timestamp ordering; correct `DEFAULT TRUE` |
| 2. Runway helper | `monthsOfRunway` + unit tests | Off-by-one / divide-by-zero in the formula |
| 3. Settings toggle | Checkbox persisting the preference | JSON-PUT change detection; react-compiler rule |
| 4. Dashboard card | `FireProgress` island + gated SSR | `RangeError` on SWR ≤ 0; null-input → placeholder, not crash |

**Prerequisites:** F-01 (schema), S-02 (dashboard), S-05 (settings), S-09 (FIRE engine) — all done.
**Estimated effort:** ~1–2 sessions across 4 phases (read-and-present, mostly wiring).

## Open Risks & Assumptions

- `computeFireProjection` throws `RangeError` when `safeWithdrawalRate <= 0` — SSR must guard before calling (defensive, since the column is `NOT NULL DEFAULT 0.04` with a `> 0` constraint).
- Currency-cast lesson applies: cast `a.currency as Currency` at the row boundary (reuse the `fire.astro` pattern).
- Assumes display currency continues to come from `Astro.locals.displayCurrency` on the dashboard.

## Success Criteria (Summary)

- User can toggle the FIRE card on/off from Settings and see it reflected on the dashboard.
- With core inputs set, the card shows an accurate bar + years-to-FI + runway + FIRE number in display currency; with inputs missing, a placeholder linking to the calculator.
- No crash on missing/invalid FIRE inputs; existing tests, lint, and build all pass.
