# Empirical Net-Worth Trajectory Implementation Plan

## Overview

Add a data-driven forward projection of net worth, fitted to the user's **real saved snapshots**, surfaced as a dotted continuation of the existing dashboard net-worth chart plus a plain-language readout ("at your current pace you'll reach €X by <date>", and — given a target — an estimated date they'll hit it). This is the empirical counterpart to the assumption-based FIRE projection (S-09): FIRE asks "given these inputs, when?"; the trajectory asks "given what actually happened, when?".

The math core lives in a pure, exhaustively table-tested `src/lib/trajectory.ts` (mirroring `fire.ts` / `monte-carlo.ts`), which also becomes the `etaToTarget` helper that S-21 (savings-goals) reuses.

## Current State Analysis

- **The chart is ready to extend.** `src/components/NetWorthChart.tsx:52-61` builds `chartData: { date, netWorth, displayCurrency }[]` from raw `snapshots` rows and renders a Recharts `LineChart` (`:118-149`). It already uses `strokeDasharray` on a `ReferenceLine` (`:141`) and detects mixed-currency history, showing a warning banner (`:63-75`, `:111-116`). No `connectNulls` is used today.
- **Snapshots** carry `total_net_worth` (NUMERIC), `display_currency`, `created_at` (ISO), `net_contribution` (migration `20260529190856_initial_schema.sql:41-51` + `20260628120000`). `dashboard.astro:35-39` loads them ascending by `created_at` and passes them raw to the island (`:256-262`, `client:load`).
- **Sibling pure-lib pattern is established.** `src/lib/fire.ts` and `monte-carlo.ts` export typed pure functions with no I/O; tested via Vitest (`fire.test.ts`) using a baseline-input helper, `toBe` for exact integers, `toBeCloseTo(_, 6)` for growth/division, and a "333.33" FP-scaling probe. Runner: `vitest` (`package.json`: `test`, `test:run`).
- **Settings-gate chain is well-precedented.** `show_fire_dashboard` / `show_drift_alerts` thread schema → `database.types.ts` → `PREFS_SELECT` (`api/user-preferences/index.ts:15-18`) → boolean validation in the PUT handler → `SettingsForm.tsx` checkbox + `useState` + `updates` object (`:33-61`, `:148-188`) → read in `dashboard.astro:72-80` (`showFireDashboard = (prefs?.show_fire_dashboard ?? true)`).
- **No centralized formatters** — the codebase formats inline via `toLocaleDateString("en-US", …)` and `toLocaleString("en-US", { minimumFractionDigits … })`. Match that.

## Desired End State

On `/dashboard`, a user with ≥2 comparable snapshots sees their solid net-worth history continue as a **muted dotted projected line**, a **linear/CAGR toggle** (CAGR disabled when undefined), a **pace readout** ("at your current pace you'll reach €X by <date>"), an **ephemeral target input** that shows an estimated hit-date (or "on your current trend, not reaching this"), and a shared **"estimate, not financial advice"** disclaimer. Users can hide the whole projection via a new **"Show net-worth projection"** settings toggle (default on). With <2 comparable snapshots the projection is suppressed with a "not enough history yet" note; the existing chart renders unchanged.

Verify: `src/lib/trajectory.ts` exists with passing table tests; the toggle persists across reload and hides/shows the projection; the dotted line and readout render correctly for a seeded multi-snapshot account; underwater (negative net worth) history disables CAGR but keeps linear.

### Key Discoveries:

- Chart data can carry a nullable `projected` field per point; a second `<Line dataKey="projected" strokeDasharray … connectNulls dot={false} />` renders the dotted segment. Seeding `projected` on the **last historical point** joins the solid and dotted lines without a gap (`NetWorthChart.tsx:136`).
- Mixed-currency snapshots make a raw fit meaningless — the chart already flags this (`:63-75`). The fit must run only over comparable (same-currency) points.
- `dashboard.astro` reads snapshots as raw rows; all trajectory math can run **client-side in the island** from the same `snapshots` prop — no SSR compute needed, unlike FIRE. The island only additionally needs the `showTrajectory` flag.
- react-compiler is enforced (`CLAUDE.md`): pure fit functions called in the island's render body are fine (compiler memoizes); interactive state (`model`, `target`) uses `useState`.

## What We're NOT Doing

- **No persisted target and no named goals** — the target input is ephemeral (client-side only). Persisted, named savings goals with progress cards are S-21, which reuses this slice's `etaToTarget`.
- **No uncertainty/residual band** — v1 is a single point-projection line + disclaimer (roadmap defers the band).
- **No new charting library** — extend the existing Recharts chart only.
- **No dedicated `/dashboard/trajectory` page** — the projection lives inline on the existing dashboard net-worth chart.
- **No SSR precompute** — the fit runs in the client island (the FIRE SSR-compute pattern is not needed here).
- **No background reprocessing or new snapshot writes** — read-only over existing snapshot history.

## Implementation Approach

Three phases, foundation-first:

1. **`src/lib/trajectory.ts` + tests** — the isolated, pure math (linear OLS fit, CAGR log-linear fit, `projectForward`, `etaToTarget`), with the ≥2-point and positive-value guards baked in and table-tested before any UI exists. This unblocks S-21.
2. **`show_trajectory` settings gate** — the schema → types → API → settings → dashboard-read chain, cloned one-to-one from `show_fire_dashboard`.
3. **Chart projection + readout UI** — extend `NetWorthChart` with the dotted line, model toggle, ephemeral target/ETA readout, disclaimer, and suppression states, wired to the new `showTrajectory` prop.

## Critical Implementation Details

- **Numerical stability of the time axis.** Fit against `t = days since the first (comparable) snapshot`, not raw epoch milliseconds — absolute-ms timestamps make the linear slope vanishingly small and degrade the CAGR log fit. Convert `created_at` → days once, fit, and convert projected `t` back to a date for the chart/readout. This convention must be identical in `fitLinear`, `fitCagr`, `projectForward`, and `etaToTarget` or projections and ETAs won't agree.
- **Comparable-snapshot segment.** The fit runs only over snapshots whose `display_currency` equals the current `displayCurrency` (the trailing comparable set). If fewer than 2 such snapshots exist, suppress the projection and show the "not enough history yet" note — never fit across a currency change.
- **CAGR domain guard.** The CAGR fit is a least-squares line through `(t, ln(value))`; it is only defined when **every** sampled value is > 0. `fitCagr` returns `null` when any comparable value ≤ 0 (e.g. liabilities exceed assets) or when there are <2 points. The UI disables the CAGR toggle (linear stays selectable) with a one-line note.
- **Unreachable ETA.** `etaToTarget` returns `null` when the fitted trend never reaches the target in the forward direction (flat/declining trend, or target already at/below current value) so the UI can say "on your current trend, not reaching this" instead of rendering a bogus/past date.

## Phase 1: Trajectory math lib + tests

### Overview

Create the pure, dependency-free `src/lib/trajectory.ts` and its Vitest table tests. No React, no Supabase, no I/O — mirrors `fire.ts`.

### Changes Required:

#### 1. Trajectory library

**File**: `src/lib/trajectory.ts` (new)

**Intent**: Provide the fit + projection + ETA primitives the dashboard island calls. Keep every function pure and total (guarded, returning `null` rather than throwing on degenerate input) so the UI can compose them reactively as the user toggles model / edits target.

**Contract**: Time is expressed as **days since the first sample**. Exported surface (names indicative):

```ts
export type FitModel = "linear" | "cagr";
export interface TrajectorySample { t: number; value: number }      // t = days since first sample
export interface LinearFit { model: "linear"; slope: number; intercept: number }   // value = intercept + slope*t
export interface CagrFit { model: "cagr"; logIntercept: number; logSlope: number } // value = exp(logIntercept + logSlope*t)
export type Fit = LinearFit | CagrFit;

export function fitLinear(samples: TrajectorySample[]): LinearFit | null;  // null if <2 samples
export function fitCagr(samples: TrajectorySample[]): CagrFit | null;      // null if <2 samples OR any value <= 0
export function valueAt(fit: Fit, t: number): number;
export function projectForward(fit: Fit, fromT: number, toT: number, steps: number): TrajectorySample[];
export function etaToTarget(fit: Fit, target: number, fromT: number): number | null;  // t (days) or null if unreachable forward of fromT
```

`fitLinear` is ordinary least squares on `(t, value)`. `fitCagr` is OLS on `(t, ln(value))`. `etaToTarget` inverts the chosen model (`(target - intercept)/slope` for linear; `(ln(target) - logIntercept)/logSlope` for CAGR), returning `null` when the solution is ≤ `fromT` or the slope direction can't reach the target (non-positive growth toward an above-current target; `target ≤ 0` for CAGR).

#### 2. Trajectory tests

**File**: `src/lib/trajectory.test.ts` (new)

**Intent**: Lock the math against oracles computed from first principles, matching `fire.test.ts` discipline.

**Contract**: `describe`/`it` blocks with a baseline sample-set helper. Cover: exact linear fit through collinear points (`toBe`), CAGR recovering a known compound rate (`toBeCloseTo(_, 6)`), `projectForward` endpoints and step count, `etaToTarget` hitting a known crossing date, and the guard paths — `fitLinear`/`fitCagr` return `null` on a single point; `fitCagr` returns `null` when any value ≤ 0; `etaToTarget` returns `null` for a flat/declining trend and for an already-reached target. Include a "333.33"-class value to catch ×100/÷100 scaling regressions.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:run`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Spot-check that a hand-computed 2-point linear projection matches `valueAt`/`etaToTarget` output.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: `show_trajectory` settings gate

### Overview

Add a `show_trajectory` boolean preference (default TRUE) and thread it through the exact chain used by `show_fire_dashboard`, so the projection can be toggled off from Settings and read on the dashboard.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_user_preferences_show_trajectory.sql` (new)

**Intent**: Add the gating column with a safe default so existing users see the projection by default.

**Contract**: `ALTER TABLE user_preferences ADD COLUMN show_trajectory BOOLEAN NOT NULL DEFAULT TRUE;` (mirror the `show_drift_alerts` migration).

#### 2. Generated types

**File**: `src/lib/database.types.ts`

**Intent**: Reflect the new column so typed reads/writes compile.

**Contract**: Add `show_trajectory: boolean` to `user_preferences` `Row`, and `show_trajectory?: boolean` to `Insert`/`Update`. Preferably regenerate via `npx astro sync`; hand-edit only if generation isn't wired.

#### 3. Preferences API

**File**: `src/pages/api/user-preferences/index.ts`

**Intent**: Read the column back to clients and validate it on write, exactly like the other boolean flags.

**Contract**: Append `show_trajectory` to `PREFS_SELECT` (`:15-18`) and add a boolean-validation branch in the PUT handler alongside `show_fire_dashboard` / `show_drift_alerts`. Keep the `.eq("user_id", user.id)` RLS-defense on the upsert.

#### 4. Settings form

**File**: `src/components/settings/SettingsForm.tsx`

**Intent**: Give the user a checkbox to hide/show the projection.

**Contract**: Add `initialShowTrajectory: boolean` to `Props`; add `showTrajectory` `useState` (`:33-36`); include it in `hasChanges` (`:40-44`) and the typed `updates` object (`:52-61`); render a checkbox block labelled "Show net-worth projection on dashboard" with sublabel copy, mirroring `:148-167`. Pass `initialShowTrajectory` from the settings page (`settings.astro`) where `SettingsForm` is instantiated.

#### 5. Dashboard read

**File**: `src/pages/dashboard.astro`

**Intent**: Read the flag and pass it to the chart island.

**Contract**: Add `show_trajectory` to the `user_preferences` select (`:72-78`); derive `const showTrajectory = (prefs?.show_trajectory ?? true) as boolean;` (mirror `:80`); pass `showTrajectory={showTrajectory}` into `<NetWorthChart …>` (`:256-262`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Migration applies against local Supabase (e.g. `supabase db reset` / `supabase migration up`)
- Existing tests pass: `npm run test:run`

#### Manual Verification:

- Toggling "Show net-worth projection" in Settings persists across a reload.
- With the toggle off, the dashboard chart renders exactly as before (no projection UI).

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 3.

---

## Phase 3: Chart projection + readout UI

### Overview

Extend `NetWorthChart` so that, when `showTrajectory` is on and ≥2 comparable snapshots exist, it draws the dotted projected line, a linear/CAGR toggle, an ephemeral target input + pace/ETA readout, and the disclaimer — reusing `src/lib/trajectory.ts`.

### Changes Required:

#### 1. NetWorthChart extension

**File**: `src/components/NetWorthChart.tsx`

**Intent**: Layer the projection onto the existing chart without disturbing the historical line, empty state, or mixed-currency warning. All new math comes from `trajectory.ts`; formatting matches the existing inline `toLocaleString`/`toLocaleDateString` style.

**Contract**:

- Add `showTrajectory: boolean` to `Props` (`:15-19`). When false, or when fewer than 2 comparable snapshots exist, render today's chart unchanged (plus, in the <2 case, a small "not enough history yet — save more snapshots" note).
- Build the comparable sample set: snapshots with `display_currency === displayCurrency`, mapped to `{ t: daysSinceFirst, value: total_net_worth }`.
- Compute `linearFit` and `cagrFit` (pure calls). Client state: `model` (`"linear" | "cagr"`, default `"linear"`) and `target` (string/number, empty by default) via `useState`.
- Horizon: `historyDays = lastT - firstT`; `horizonDays = min(historyDays, 5 * 365)`. `projectForward(fit, lastT, lastT + horizonDays, steps)` → append to `chartData` as points with a `projected` field and `netWorth: null`. Seed `projected` on the final historical point (= its `netWorth`) so the dotted line joins the solid one.
- Render a second `<Line dataKey="projected" stroke="var(--chart-1)" strokeDasharray="6 4" strokeOpacity={0.6} dot={false} connectNulls />` after the existing `<Line>` (`:136`).
- **Fit toggle**: a small segmented/pill control (linear | CAGR). The CAGR option is disabled when `cagrFit === null`, with a one-line note ("compound projection needs positive history").
- **Target + ETA readout** beneath the chart: a number input in `displayCurrency`; always show the pace line ("At your current pace you'll reach {valueAt(fit, lastT+horizon)} {displayCurrency} by {date}"). When a target is entered, show `etaToTarget` as "You'll reach {target} around {date}", or "On your current trend, you won't reach this." when it returns `null`.
- **Disclaimer**: reuse the FireProgress wording — "An estimate, not financial advice, shown in {displayCurrency}." (`FireProgress.tsx:90-92`).

#### 2. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Supply the flag added in Phase 2 to the chart.

**Contract**: `showTrajectory={showTrajectory}` on `<NetWorthChart>` (already added in Phase 2 step 5 — verify present).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes (react-compiler clean): `npm run lint`
- Existing + new tests pass: `npm run test:run`
- Production build succeeds: `npm run build`

#### Manual Verification:

- With ≥2 same-currency snapshots, a muted dotted projected line continues from the solid history and visually joins it (no gap).
- Switching the linear/CAGR toggle changes the projected line and the readout consistently.
- Entering a reachable target shows a sensible future date; a target below current net worth or a flat/declining trend shows the "not reaching this" copy.
- An account whose net worth is negative disables the CAGR toggle but still shows the linear projection.
- With <2 comparable snapshots (or after a currency switch leaving <2 comparable), the projection is suppressed with the "not enough history" note and the base chart is unaffected.
- The projection disappears entirely when `show_trajectory` is toggled off in Settings.

**Implementation Note**: After automated verification passes, pause for human confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- `trajectory.test.ts`: linear fit exactness, CAGR rate recovery, `projectForward` endpoints/step count, `etaToTarget` crossing date.
- Guard paths: `null` on single point; `fitCagr` `null` on any non-positive value; `etaToTarget` `null` on flat/declining trend and already-reached target.
- "333.33"-class FP-scaling probe.

### Integration Tests:

- None automated for the chart island (consistent with existing chart components, which are covered by lib tests + manual verification). The math is fully exercised by `trajectory.test.ts`.

### Manual Testing Steps:

1. Seed an account with 3+ monthly snapshots in one currency; confirm the dotted projection joins the history and the pace readout reads sensibly.
2. Enter a target above current net worth on a rising trend → future ETA date; enter one below current or on a flat trend → "not reaching this".
3. Toggle CAGR vs linear; confirm line + readout move together.
4. Make net worth negative (liability > assets) across snapshots → CAGR disabled, linear still projects.
5. Change display currency so <2 comparable snapshots remain → projection suppressed with the note.
6. Toggle "Show net-worth projection" off in Settings → projection gone after reload; base chart unchanged.

## Performance Considerations

Negligible: the fit is O(n) over a user's snapshot count (tens to low hundreds), computed once per render in the client island; react-compiler memoizes the pure calls. No new network requests.

## Migration Notes

One additive column (`show_trajectory BOOLEAN NOT NULL DEFAULT TRUE`). Existing rows default to TRUE, so the projection is visible for all users on first load after deploy. No backfill.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-20 (`:412-426`), summary row (`:519`)
- Chart to extend: `src/components/NetWorthChart.tsx`
- Sibling pure lib + tests: `src/lib/fire.ts`, `src/lib/fire.test.ts`, `src/lib/monte-carlo.ts`
- Net-worth math: `src/lib/net-worth.ts` (`computeNetWorth`, `convertAmount`)
- Disclaimer + card precedent: `src/components/fire/FireProgress.tsx:90-92`
- Settings-gate chain: `src/pages/api/user-preferences/index.ts:15-18`, `src/components/settings/SettingsForm.tsx:33-61,148-188`, `src/pages/dashboard.astro:72-80`
- Downstream consumer: S-21 savings-goals reuses `etaToTarget` (`roadmap.md:433`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Trajectory math lib + tests

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:run` — 11fb745
- [x] 1.2 Type checking passes: `npm run typecheck` — 11fb745
- [x] 1.3 Linting passes: `npm run lint` — 11fb745

#### Manual

- [x] 1.4 Hand-computed 2-point linear projection matches `valueAt`/`etaToTarget` (verified: read trajectory.ts:53-181, hand oracle t=0→100/t=30→400 gives slope 10 intercept 100, valueAt(60)=700, etaToTarget(550,30)=45 — all match) — 11fb745

### Phase 2: `show_trajectory` settings gate

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — bed4831
- [x] 2.2 Linting passes: `npm run lint` — bed4831
- [x] 2.3 Migration applies against local Supabase — bed4831
- [x] 2.4 Existing tests pass: `npm run test:run` — bed4831

#### Manual

- [ ] 2.5 Toggle persists across reload
- [ ] 2.6 With toggle off, dashboard chart renders as before

### Phase 3: Chart projection + readout UI

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — f8366fe
- [x] 3.2 Linting passes (react-compiler clean): `npm run lint` — f8366fe
- [x] 3.3 Existing + new tests pass: `npm run test:run` — f8366fe
- [x] 3.4 Production build succeeds: `npm run build` — f8366fe

#### Manual

- [ ] 3.5 Dotted projected line joins solid history (no gap)
- [ ] 3.6 Linear/CAGR toggle moves line + readout consistently
- [ ] 3.7 Reachable vs unreachable target copy is correct
- [ ] 3.8 Negative net worth disables CAGR, keeps linear
- [ ] 3.9 <2 comparable snapshots suppresses projection with note
- [ ] 3.10 Settings toggle off hides the projection
