# Allocation Drift Alerts Implementation Plan

## Overview

Add a settings-gated dashboard **drift-alert card** (roadmap slice **S-18**). When any of the user's balancer cards has a **real** allocation that has drifted beyond a threshold (±5pp) from its **target**, the dashboard surfaces a card naming the worst-drifting assets with a link to `/dashboard/balancer`. The card is gated by a new `show_drift_alerts` user preference (on by default) and renders nothing when the user has no cards, no targets, or no card currently breaching the threshold.

The work is three layers: a new user-preference boolean (the explicit "enable/disable in settings" ask), a pure `computeDrift` engine over the existing allocation math, and a `DriftAlerts` React island wired into the dashboard.

## Current State Analysis

- **The allocation engine is per-card and pure.** `computeAllocation(assets, displayCurrency, rates)` in `src/lib/allocation.ts:67` returns `{ slices, totalSelected, declaredSum }`. Each slice carries a raw `targetPct` (0–100) and a `realPct` that is **already normalized to 100** (`value / totalSelected * 100`), or `null` when `Math.abs(totalSelected) < EPSILON` (`EPSILON = 1e-2`, `src/lib/allocation.ts:22,79,86`). This is exactly the surface `computeDrift` builds on.
- **The declared-sum-≠-100 skew has a ready fix.** `computeAllocation` already returns `declaredSum` (sum of raw `targetPct`). Because `realPct` sits on a 100 base but raw `targetPct` may not, `computeDrift` must normalize each slice's target to `(targetPct / declaredSum) * 100` before differencing against `realPct`.
- **Currency handling is settled.** `computeAllocation` converts via `convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates)` (`src/lib/allocation.ts:74`). `computeDrift` consumes `computeAllocation`'s output, so it needs no new currency logic — the `as Currency` cast boundary stays inside `computeAllocation`.
- **`show_fire_dashboard` (S-14) is a clean 7-touchpoint precedent** for adding a boolean preference: migration `supabase/migrations/20260623120000_user_preferences_show_fire_dashboard.sql`, `src/lib/database.types.ts` (Row/Insert/Update at lines 326/343/360), `PREFS_SELECT` (`src/pages/api/user-preferences/index.ts:15`), the PUT validation branch (`:171-176`), `SettingsForm.tsx` (`src/components/settings/SettingsForm.tsx:8-153`), `settings.astro` (`src/pages/dashboard/settings.astro:21-54`), and the **`USER_PREFERENCES_COLUMNS` whitelist** in `src/lib/backup.ts:29-45` (the touchpoint the roadmap omitted — missing it silently drops the pref from export/import).
- **The dashboard already gates an island on a boolean.** `dashboard.astro` loads assets + rates, reads `show_fire_dashboard`, and conditionally renders `<FireProgress ... client:load />` (`src/pages/dashboard.astro:70-88,177`). A new gated island slots in right after it.
- **The balancer page has the exact allocation load-and-reshape pattern.** `src/pages/dashboard/balancer.astro:27-56` loads `allocation_cards` with nested `allocation_targets(asset_id, target_pct)`, filters non-liability assets, and reshapes the nested rows into a flat per-card map. This pattern is copied into `dashboard.astro`.
- **`FireProgress.tsx` is the card template.** Card wrapper `rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10`, an uppercase-tracked title, `Metric`-style rows, and a purple call-to-action link (`src/components/fire/FireProgress.tsx:32,56,97-104,37-42`). There is **no** shared card component — styling is inline Tailwind.

## Desired End State

A user with balancer cards whose real allocation has drifted ≥5pp from (normalized) target sees, on their dashboard, a drift-alert card that:
- Names the single **worst-drifting card** (highest max-abs per-asset drift) and its top 2–3 offending assets, each with **signed** drift (e.g. "BTC +8pp over target", "Bonds −6pp under target").
- Shows an "Also drifting: `<names>`" note when other cards also breach the threshold.
- Shows a small inline note ("targets sum to 92% — compared proportionally") when the shown card's declared targets sum ≠100.
- Links to `/dashboard/balancer`.
- Renders **nothing** when: `show_drift_alerts` is off, the user has no cards/targets, every card's `realPct` is null (near-zero denominator), or no card breaches the threshold.

Verified by: `computeDrift` unit tests pass; the settings toggle persists and round-trips through backup export/import; toggling it makes the dashboard card appear/disappear; a manually-drifted card produces the expected card content.

### Key Discoveries:

- `computeAllocation` returns `realPct` already normalized to 100 and `null`-guarded — `computeDrift` differences against it, it does **not** recompute real percentages (`src/lib/allocation.ts:79-86`).
- `declaredSum` is returned by `computeAllocation` precisely so callers can normalize targets to a 100 base (`src/lib/allocation.ts:44`).
- `EPSILON = 1e-2` is the canonical near-zero guard; reuse it, don't invent a new one (`src/lib/allocation.ts:22`).
- The `backup.ts` `USER_PREFERENCES_COLUMNS` whitelist (`src/lib/backup.ts:29-45`) is a required touchpoint the roadmap did not list.
- Percentages are 0–100 end-to-end with **no** ×100/÷100 at the DB boundary (`src/lib/allocation.ts:7-8`).

## What We're NOT Doing

- **No `drift_threshold_pct` preference.** The threshold is a fixed constant (≈5pp) in the lib for v1, per the roadmap. Promoting it to a preference is a future slice.
- **No positive "on target ✓" status card.** When nothing drifts, the card is absent — this is an alert, not a persistent status widget.
- **No changes to the balancer page, `computeAllocation`, `computeBuyPlan`, or the allocation schema.** `computeDrift` is purely additive.
- **No new nav item.** The card links to the existing `/dashboard/balancer`; the "Balance" nav entry already exists.
- **No rebalancing actions from the card.** It is read-and-present only; rebalancing lives on the balancer page.
- **No E2E/browser tests in this plan.** Coverage is unit tests on `computeDrift` plus manual dashboard verification.

## Implementation Approach

Three phases, each independently shippable and verifiable:

1. **Preference toggle** — mirror the `show_fire_dashboard` chain across all 7 touchpoints so the user can enable/disable the feature in settings. Ships first because it is the explicit ask and the lowest-risk, fully-precedented change.
2. **`computeDrift` engine** — a pure, table-tested helper in `src/lib/allocation.ts`. No UI; ships green on its tests.
3. **`DriftAlerts` island + dashboard wiring** — consume both the flag (Phase 1) and the engine (Phase 2) to render the gated card.

## Critical Implementation Details

- **Normalize before differencing.** `computeAllocation.realPct` is on a 100 base; raw `slice.targetPct` may not be (declared sum can be ≠100). For each slice: `normalizedTarget = declaredSum >= EPSILON ? (targetPct / declaredSum) * 100 : null`; `drift = realPct − normalizedTarget`. If either side is null, that slice has no drift value and is excluded from the card's max-drift severity.
- **Skip, don't crash, on degenerate cards.** A card whose `realPct` is null for all slices (near-zero denominator) or whose `declaredSum < EPSILON` (no meaningful targets) contributes no drift and must be filtered out before ranking — never surfaced, never a divide-by-zero.
- **Severity + ranking.** Card severity = max absolute per-asset drift across its slices. Rank breaching cards (severity ≥ threshold) by severity descending; the top one is shown in detail, the rest contribute only their names to the "Also drifting" note.

## Phase 1: `show_drift_alerts` Preference (Settings Toggle)

### Overview

Add a `show_drift_alerts BOOLEAN NOT NULL DEFAULT TRUE` preference and thread it through every layer that `show_fire_dashboard` touches, so the drift-alert feature can be enabled/disabled from the settings page and survives backup export/import.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<new-timestamp>_user_preferences_show_drift_alerts.sql`

**Intent**: Add the `show_drift_alerts` column to `user_preferences`, defaulting on, mirroring the `show_fire_dashboard` migration.

**Contract**: `ALTER TABLE user_preferences ADD COLUMN show_drift_alerts BOOLEAN NOT NULL DEFAULT TRUE;` Filename follows the `YYYYMMDDHHMMSS_description.sql` convention (use a timestamp later than the latest existing migration). Include a header comment referencing roadmap S-18, matching the precedent file's style.

#### 2. Generated Supabase types

**File**: `src/lib/database.types.ts`

**Intent**: Reflect the new column in the `user_preferences` Row/Insert/Update types so the API and settings code typecheck.

**Contract**: Add `show_drift_alerts: boolean;` to Row, `show_drift_alerts?: boolean;` to Insert and Update, adjacent to the `show_fire_dashboard` entries (lines ~326/343/360). Prefer regenerating via `npx astro sync` / the Supabase type-gen command; hand-edit only if regeneration is unavailable.

#### 3. `PREFS_SELECT` projection

**File**: `src/pages/api/user-preferences/index.ts`

**Intent**: Include the new column in the shared read/write projection so GET returns it and PUT echoes it back.

**Contract**: Add `show_drift_alerts` to the `PREFS_SELECT` constant string (`:15`), alongside `show_fire_dashboard`.

#### 4. API validation branch (PUT)

**File**: `src/pages/api/user-preferences/index.ts`

**Intent**: Validate and accept `show_drift_alerts` on update, using the project's canonical error shape.

**Contract**: Extend the `updates` object type (`:155`) with `show_drift_alerts?: boolean` and add a validation branch mirroring `:171-176`: reject non-boolean with `jsonError("VALIDATION_ERROR", "show_drift_alerts must be a boolean", 400)` (the `{ error: { code, message } }` shape).

#### 5. Backup whitelist

**File**: `src/lib/backup.ts`

**Intent**: Ensure the new preference is included in export/import so it round-trips.

**Contract**: Add `"show_drift_alerts"` to the `USER_PREFERENCES_COLUMNS` array (`:29-45`), preserving the `satisfies readonly (keyof UserPreferencesRow)[]` constraint.

#### 6. Settings form

**File**: `src/components/settings/SettingsForm.tsx`

**Intent**: Add a checkbox letting the user toggle the drift-alert card, following the `show_fire_dashboard` checkbox exactly.

**Contract**: Add `initialShowDriftAlerts: boolean` to `Props`; a `showDriftAlerts` state seeded from it; include it in the `hasChanges` comparison; add it to the PUT payload when changed; render a checkbox block mirroring `:135-153` with label "Show allocation drift alerts on dashboard" and a helper line ("Adds a card highlighting balancer cards whose real allocation has drifted from target.").

#### 7. Settings page load + prop

**File**: `src/pages/dashboard/settings.astro`

**Intent**: Load the new preference server-side and pass it into the form.

**Contract**: Add `show_drift_alerts` to the `.select(...)` (`:21-25`); derive `initialShowDriftAlerts = rawShowDriftAlerts ?? true` (mirror `:29,35`); pass `initialShowDriftAlerts={...}` to `<SettingsForm>` (`:49-54`).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a fresh DB (`supabase db reset` or the project's migrate command)
- Type checking passes: `npx tsc --noEmit` (or the project's typecheck)
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- The settings page shows a "Show allocation drift alerts" checkbox, checked by default
- Unchecking + saving persists (reload shows it unchecked); re-checking + saving persists
- A backup export includes `show_drift_alerts`, and importing it restores the toggle state
- PUT with a non-boolean `show_drift_alerts` returns a 400 with the `{ error: { code, message } }` shape

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: `computeDrift` Pure Helper + Unit Tests

### Overview

Extend `src/lib/allocation.ts` with a pure `computeDrift` that takes the user's cards (each a set of `AllocationAsset`s) plus display currency and rates, and returns a ranked, threshold-filtered drift result ready for the card to render. Pin it with table tests mirroring `allocation.test.ts`.

### Changes Required:

#### 1. `computeDrift` helper + types + threshold constant

**File**: `src/lib/allocation.ts`

**Intent**: Compute per-card, per-asset allocation drift by reusing `computeAllocation`, normalizing declared targets to a 100 base before differencing, ranking cards by severity, and filtering to those breaching a fixed threshold — while skipping degenerate (null-`realPct` / no-target) cards.

**Contract**: Add an exported `DRIFT_THRESHOLD_PCT = 5` constant (percentage points). Add a `computeDrift` function that accepts the user's cards and shared `displayCurrency` + `rates`, and returns a structure sufficient for the card:

- A per-card entry containing: card id + name, `declaredSum` (to drive the ≠100 note), `severity` (max abs per-asset drift), and an ordered list of per-asset drift entries `{ asset_id, name, realPct, normalizedTargetPct, drift }` (drift = `realPct − normalizedTargetPct`, in pp, signed).
- The top-level result exposes: the single worst breaching card (or null), the names of other breaching cards, and the threshold used.

Per-card math (reuse `computeAllocation` per card): for each slice, `normalizedTargetPct = declaredSum >= EPSILON ? (targetPct / declaredSum) * 100 : null`; `drift = realPct − normalizedTargetPct`. A slice with `realPct === null` or `normalizedTargetPct === null` yields no drift and is excluded from severity. A card with no drift-bearing slices, or `severity < DRIFT_THRESHOLD_PCT`, is not "breaching." Rank breaching cards by `severity` desc; on ties, preserve input order (stable). Reuse `EPSILON` and the existing `Currency` cast boundary inside `computeAllocation` — `computeDrift` adds no new currency logic.

Input shape note: define the card input so it composes with the reshaped data `dashboard.astro` will produce in Phase 3 (a card = id + name + a list of `AllocationAsset`, where `AllocationAsset` already carries `targetPct`). Keep the offender ordering (largest abs drift first) inside the helper so the UI just slices the top 2–3.

#### 2. `computeDrift` unit tests

**File**: `src/lib/allocation.test.ts`

**Intent**: Pin the drift math and every edge case the roadmap flagged as risky.

**Contract**: Add a `describe("computeDrift", ...)` block mirroring the file's fixture + oracle style (`toBe` for exact integers/nulls, `toBeCloseTo(_, 6)` for divisions). Cover: (a) a normal card with declared sum = 100 → correct signed drift and severity; (b) a card with declared sum ≠ 100 → targets normalized before differencing, `declaredSum` reported; (c) a card whose `totalSelected < EPSILON` → excluded (null realPct), not surfaced, no crash; (d) an empty / no-target card → excluded; (e) a card with severity below threshold → not breaching; (f) multiple breaching cards → worst card selected by severity, others returned as names, tie-break preserves input order; (g) offender ordering within a card is largest-abs-drift first.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/lib/allocation.test.ts`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Spot-check one oracle by hand (e.g. a card with targets summing to 80% and a known real split) to confirm the normalization produces the expected signed drift

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: `DriftAlerts` Island + Dashboard Wiring

### Overview

Load `allocation_cards` + `allocation_targets` in `dashboard.astro` (reusing the balancer load pattern), compute drift server-side, gate the render on `show_drift_alerts`, and pass the result into a new `DriftAlerts.tsx` card that presents the worst-drifting card, its offenders, the other-drifting note, and the ≠100 note.

### Changes Required:

#### 1. Dashboard SSR load + gating + compute

**File**: `src/pages/dashboard.astro`

**Intent**: Read the `show_drift_alerts` flag, load the user's allocation cards/targets and reshape them like the balancer page, run `computeDrift`, and conditionally render the island — mirroring how the FIRE card is loaded and gated.

**Contract**: Add `show_drift_alerts` to the `user_preferences` select and derive the boolean (default true), mirroring the `show_fire_dashboard` read (`:70-78`). When on, load `allocation_cards` with nested `allocation_targets(asset_id, target_pct)` and filter non-liability assets exactly as `balancer.astro:27-56` does, reshape into the per-card `computeDrift` input, and call `computeDrift(cards, displayCurrency, rates)` using the already-loaded rates. Compute the props object only when the result has a worst breaching card; otherwise leave it undefined. Render `{driftAlerts && <DriftAlerts {...driftAlerts} client:load />}` immediately after the `FireProgress` render (`:177`). Reuse the existing `RawCard`-style typed reshape to tame the chained-select `any`.

#### 2. `DriftAlerts` card island

**File**: `src/components/balancer/DriftAlerts.tsx` (new)

**Intent**: Present the drift result as a dashboard alert card, matching the FIRE card's visual conventions.

**Contract**: A props interface carrying the worst card (name, `declaredSum`, ordered offender list with signed drift), the other-drifting card names, the threshold, and `displayCurrency` (for any currency-labelled context, if shown). Render: the card wrapper (`rounded-2xl border ... backdrop-blur-xl ...` per `FireProgress.tsx:32`), an uppercase-tracked title ("Allocation drift"), the worst card's name, up to 3 offender rows in the `Metric` two-column style (`FireProgress.tsx:97-104`) each showing signed drift with over/under wording (e.g. "BTC — +8pp over target"), a subtle "Also drifting: `<names>`" line when other cards breach, a subtle "targets sum to `<declaredSum>`% — compared proportionally" note when `declaredSum` ≠ 100 (use `EPSILON`-tolerant comparison), and a purple link to `/dashboard/balancer` ("Review in balancer") styled per `FireProgress.tsx:37-42`. The component is presentational — all math/filtering/ordering already happened in `computeDrift`; it must not re-derive drift. Respect `react-compiler` rules (no manual memo hacks that trip the lint).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint` (including `react-compiler` on `DriftAlerts.tsx`)
- Build passes: `npm run build`

#### Manual Verification:

- With `show_drift_alerts` off, no drift card appears on the dashboard
- With it on and no balancer cards/targets, no drift card appears
- With it on and a card manually drifted ≥5pp, the card appears naming the worst card and its top offenders with correct signed over/under drift and a working link to `/dashboard/balancer`
- With two cards drifting, the worst is shown in detail and the other's name appears in the "Also drifting" note
- A card whose targets sum to ≠100 shows the proportional-comparison note
- When all cards are within threshold, the card is absent (not a "on target" status)
- No regression to the FIRE card, assets summary, or net-worth chart on the dashboard

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `computeDrift` in `src/lib/allocation.test.ts` — normal drift, declared-sum-≠-100 normalization, null-`realPct` (near-zero denominator) exclusion, empty/no-target exclusion, below-threshold non-breaching, multi-card ranking + "other drifting" names + stable tie-break, offender ordering.

### Integration Tests:

- None new. `computeDrift` is pure and unit-covered; the API preference path is covered by the existing user-preferences handler tests plus the new validation branch (exercised manually).

### Manual Testing Steps:

1. Toggle "Show allocation drift alerts" off in settings → save → reload → dashboard has no drift card; toggle back on → card logic re-enabled.
2. On the balancer page, create a card and set targets, then change an asset value so the real split drifts ≥5pp from target; return to the dashboard → drift card appears with the expected worst offenders and signs.
3. Create a second drifting card → confirm the worst is detailed and the other appears in the "Also drifting" note.
4. Set a card's targets to sum ≠100 → confirm the proportional-comparison note appears and drift is computed on the normalized base.
5. Bring all cards within ±5pp → confirm the card disappears.
6. Export a backup → confirm `show_drift_alerts` is present; flip the toggle, import the backup → confirm the toggle restores.

## Performance Considerations

Negligible. `computeDrift` is O(cards × assets) pure arithmetic over data already loaded for the dashboard/balancer; the SSR adds one `allocation_cards` query (with a nested targets select) already proven on the balancer page. No new client-side work beyond rendering a static card.

## Migration Notes

One additive, non-destructive column (`show_drift_alerts`, default TRUE) — existing rows get the default, so the feature is on for everyone on deploy until they opt out. Rollback is a single `DROP COLUMN`. No data backfill.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-18 (lines 368–384)
- Allocation engine: `src/lib/allocation.ts:22,44,67-90` (`EPSILON`, `AllocationResult`, `computeAllocation`)
- Allocation tests (style to mirror): `src/lib/allocation.test.ts`
- Preference precedent (`show_fire_dashboard`): migration `supabase/migrations/20260623120000_user_preferences_show_fire_dashboard.sql`; `src/pages/api/user-preferences/index.ts:15,155,171-176`; `src/components/settings/SettingsForm.tsx:135-153`; `src/pages/dashboard/settings.astro:21-54`; `src/lib/backup.ts:29-45`
- Dashboard gating + FIRE card: `src/pages/dashboard.astro:70-88,177`; `src/components/fire/FireProgress.tsx:32,37-42,97-104`
- Balancer allocation load pattern: `src/pages/dashboard/balancer.astro:27-56`
- Lessons: `context/foundation/lessons.md` — "Currency cast boundary", "Public API endpoints need explicit auth decisions"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `show_drift_alerts` Preference (Settings Toggle)

#### Automated

- [x] 1.1 Migration applies cleanly against a fresh DB — fc4e466
- [x] 1.2 Type checking passes (`npx tsc --noEmit`) — fc4e466
- [x] 1.3 Linting passes (`npm run lint`) — fc4e466
- [x] 1.4 Build passes (`npm run build`) — fc4e466

#### Manual

- [x] 1.5 Settings page shows a "Show allocation drift alerts" checkbox, checked by default (verified: Playwright against dev server — checkbox visible + checked by default) — fc4e466
- [x] 1.6 Unchecking + saving persists across reload; re-checking + saving persists (verified: Playwright — uncheck→save→reload shows unchecked, re-check→save→reload shows checked) — fc4e466
- [x] 1.7 Backup export includes `show_drift_alerts` and import restores the toggle state (verified: Playwright round-trip — export captured OFF, import restored OFF; required RPC fix in 20260711130000) — fc4e466
- [x] 1.8 PUT with a non-boolean `show_drift_alerts` returns 400 with `{ error: { code, message } }` (verified: Playwright — PUT "yes" → 400, error.code string, message names the field) — fc4e466

### Phase 2: `computeDrift` Pure Helper + Unit Tests

#### Automated

- [x] 2.1 Unit tests pass (`npx vitest run src/lib/allocation.test.ts`) — b59725c
- [x] 2.2 Type checking passes (`npx tsc --noEmit`) — b59725c
- [x] 2.3 Linting passes (`npm run lint`) — b59725c

#### Manual

- [x] 2.4 One oracle spot-checked by hand (targets ≠100 case) confirms expected signed drift (verified: hand-calc declaredSum 80 → normalized 75/25 → drift +5/−5, matches test oracle) — b59725c

### Phase 3: `DriftAlerts` Island + Dashboard Wiring

#### Automated

- [x] 3.1 Type checking passes (`npx tsc --noEmit`)
- [x] 3.2 Linting passes including `react-compiler` on `DriftAlerts.tsx`
- [x] 3.3 Build passes (`npm run build`)

#### Manual

- [x] 3.4 With toggle off, no drift card appears (verified: Playwright — user with ≥5pp drift + `show_drift_alerts:false` PUT → no "Allocation drift" on dashboard)
- [x] 3.5 With toggle on and no cards/targets, no drift card appears (verified: Playwright — user with assets but no allocation cards → no drift card)
- [x] 3.6 A card drifted ≥5pp shows the worst card, top offenders with correct signed over/under drift, and a working `/dashboard/balancer` link (verified: Playwright + screenshot — "Aggressive", "Stocks +20pp over target", "Crypto −20pp under target", link href=/dashboard/balancer)
- [x] 3.7 Two drifting cards → worst shown in detail, other named in "Also drifting" note (verified: Playwright — Aggressive sev 20 detailed, "Also drifting: Conservative" sev 10)
- [x] 3.8 A card with targets summing ≠100 shows the proportional-comparison note (verified: Playwright — targets 40/40 → "Targets sum to 80% — compared proportionally")
- [x] 3.9 All cards within threshold → card is absent (verified: Playwright — real 52/48 vs 50/50 target, drift ±2pp → no drift card)
- [x] 3.10 No regression to FIRE card, assets summary, or net-worth chart (verified: Playwright + screenshot — FIRE progress, Net worth 10,000 USD, Assets by currency, net-worth/contributions/trends cards all render; zero console/page errors)
