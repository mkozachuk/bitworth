# FIRE Dashboard Card Implementation Plan

## Overview

Add a settings toggle (`show_fire_dashboard`, default TRUE) that gates a new **FIRE-progress card** on the main dashboard. When the toggle is on and the user has entered their core FIRE inputs, the card shows progress toward financial independence: an animated progress bar for percent of the FIRE number reached, months of runway at zero income, estimated years-to-FI, and the FIRE number itself — all in the user's display currency. When the core FIRE inputs are not set, the card shows a placeholder prompting setup, linking to `/dashboard/fire`.

This is a read-and-present feature layered over the already-tested FIRE engine (`src/lib/fire.ts`) and net-worth helper (`src/lib/net-worth.ts`). The only net-new math is a pure runway helper; everything else is wiring an existing engine into a gated dashboard island plus a new boolean preference threaded across the DB → types → API → settings → dashboard stack.

## Current State Analysis

- **`src/lib/fire.ts`** — pure, table-tested engine. `computeFireProjection(inputs: FireInputs): FireResult` returns `{ fireNumber, yearsToFi: number | null, retirementAge, savingsRate, coastFireNumber, ... }`. `fireNumber = annualExpenses / safeWithdrawalRate`. **Throws `RangeError` when `safeWithdrawalRate <= 0`** (`fire.ts:81-83`) — callers must guard. `yearsToFi` is `null` when FI is unreachable within the horizon. **No runway helper exists.**
- **`src/lib/net-worth.ts`** — `computeNetWorth(assets, displayCurrency, rates): number` returns a plain number (`totalAssets - totalLiabilities`). `NetWorthAsset = { amount, currency: Currency, category: { is_liability } }`. The documented currency-cast lesson applies: rows carry `currency: string`, call sites cast `a.currency as Currency`.
- **`src/pages/dashboard.astro`** — already loads assets (with category join) and calls `getRates(supabase)`, but does **NOT** call `computeNetWorth` (the `NetWorthDisplay` island does) and does **NOT** query `user_preferences` (display currency comes from `Astro.locals.displayCurrency`). Renders, inside an `assets && (...)` fragment, in order: `NetWorthDisplay`, `AssetsSummary`, `NetWorthChart`, `AssetTrendsChart`, all `client:load`.
- **`src/pages/dashboard/fire.astro`** — the reference SSR pattern: loads assets, `getRates`, computes `startingPrincipal` via `computeNetWorth` with the `a.currency as Currency` cast, selects the nine `fire_*` columns from `user_preferences` (`.maybeSingle()`), casts the prefs row to `Record<string, number | null>`, and maps to `Partial<FireInputs>`. It does **not** compute the projection in SSR — the island does, and the island guards SWR by checking `num(state.safeWithdrawalRatePct) > 0` before calling `computeFireProjection`.
- **`src/components/fire/FireCalculatorForm.tsx`** — the island. Holds rate fields as whole-number percentages, divides by 100 when feeding `fire.ts`. Has `DEFAULTS` for blank fields. Guards the RangeError by skipping the call when SWR ≤ 0 (`result = swrValid ? computeFireProjection(inputs) : null`). Displays `formatMoney`/`formatPct` helpers and a "not financial advice / real terms" disclaimer.
- **`src/pages/api/user-preferences/index.ts`** — `PREFS_SELECT` lists `display_currency, theme` + the nine `fire_*` columns; **no boolean column**. Validation is hand-rolled (no Zod): `display_currency`/`theme` checked against allow-lists, `fire_*` via `FIRE_FIELD_SPECS`. Error shape is `{ error: { code, message, context? } }` via `jsonError(...)`. Only `GET` and `PUT` are exported; PUT `upsert`s with `onConflict: "user_id"`.
- **`src/components/settings/SettingsForm.tsx`** — handles `display_currency` (select) + `theme` (radio, `accent-purple-600`). **No checkbox toggle exists here.** Persists changed fields via a JSON `fetch` PUT, then `window.location.reload()`. The reusable native-checkbox JSX (`accent-purple-600`) is in `AssetForm.tsx:330-346`, but that form uses FormData (hence its hidden mirror input) — `SettingsForm` uses JSON, so the boolean goes straight in the body, no hidden input.
- **`src/pages/dashboard/settings.astro`** — queries `user_preferences` with select `"display_currency, theme"`, normalizes, passes as props to `SettingsForm`.
- **`supabase/migrations/`** — latest timestamp is `20260621000000`. `fire_*` columns were added in `20260611120000_user_preferences_fire.sql`; `fire_safe_withdrawal_rate` is `NOT NULL DEFAULT 0.04` (and `> 0`), `fire_traditional_retirement_age` is `NOT NULL DEFAULT 65`. The boolean-add precedent is `20260619120000_assets_show_on_chart.sql` (`ALTER TABLE ... ADD COLUMN ... BOOLEAN NOT NULL DEFAULT FALSE`), and the `user_preferences` ALTER convention (`BEGIN/COMMIT`) is in `20260603120000_user_preferences_theme.sql`.
- **`src/lib/database.types.ts`** — `user_preferences` Row/Insert/Update have no boolean field yet. `fire_safe_withdrawal_rate` and `fire_traditional_retirement_age` are non-null `number`; the rest of the `fire_*` set is `number | null`.
- **`Topbar.astro` / `TopbarMenu.tsx`** — both already render a `/dashboard/fire` nav link. These stay untouched (toggle gates only the dashboard card).

## Desired End State

A user visits Settings and sees a "Show FIRE progress on dashboard" checkbox, on by default. With it on and their core FIRE inputs entered, the dashboard shows a FIRE-progress card: a progress bar with an (uncapped) percentage label, months of runway with years in parentheses, years-to-FI (hidden when unreachable), and the FIRE number — all in display currency. With core inputs missing, the card is a placeholder linking to `/dashboard/fire`. With the toggle off, no card renders. Verifiable by: toggling the setting and reloading the dashboard, entering/clearing FIRE inputs and observing the card vs placeholder, and `npm run build` + lint + the new unit tests passing.

### Key Discoveries:

- The FIRE page (`src/pages/dashboard/fire.astro`) is the exact SSR template to copy for assets + `getRates` + `computeNetWorth` + `fire_*` select + the `a.currency as Currency` cast.
- `computeFireProjection` throws `RangeError` on `safeWithdrawalRate <= 0` (`fire.ts:81-83`); the card must guard before calling, as `FireCalculatorForm` does. In practice `fire_safe_withdrawal_rate` is `NOT NULL DEFAULT 0.04` with a `> 0` check constraint, so the guard is defensive but required.
- No boolean preference exists anywhere — `show_fire_dashboard` is net-new across migration → types → API (`PREFS_SELECT` + validation) → `SettingsForm` → dashboard SSR; each layer has a clean nearby pattern (`theme` / `show_on_chart`).
- `computeNetWorth` returns a bare `number`, not a breakdown — the card needs only the net-worth total, so this is sufficient.
- The currency-cast lesson (`context/foundation/lessons.md` → "Currency cast boundary") governs the `a.currency as Currency` cast at the row boundary.

## What We're NOT Doing

- **Not** gating or changing the `/dashboard/fire` nav link in `Topbar.astro` / `TopbarMenu.tsx` — the toggle gates only the dashboard card.
- **Not** changing `src/lib/fire.ts`'s existing functions, `computeNetWorth`, or the FIRE calculator page/island.
- **Not** adding new `fire_*` input columns or new FIRE settings UI — the card only reads existing columns.
- **Not** introducing a charting library or animation dependency — the progress bar uses CSS transitions only.
- **Not** changing how display currency is resolved (`Astro.locals.displayCurrency` stays the source on the dashboard).
- **Not** persisting computed progress/runway — everything is computed at render time.
- **Not** capping the displayed percentage label at 100% (per decision); only the bar's physical fill width clamps.

## Implementation Approach

Build bottom-up so each layer is verifiable before the next consumes it: (1) the preference column + API contract, (2) the pure runway helper with tests, (3) the settings toggle that writes the preference, (4) the dashboard SSR + island that reads everything and renders the card. The card computes the FIRE projection **server-side** in `dashboard.astro` (unlike the FIRE page, which computes in its island) because the dashboard card is read-only — no interactive recompute is needed, and SSR keeps the initial render instant and the island a pure presentational component. The island receives already-computed values (percent, runway, years-to-FI, FIRE number, a `configured` flag) as props.

## Critical Implementation Details

- **SWR guard ordering** — `dashboard.astro` must check `fire_safe_withdrawal_rate > 0` (and that core fields are non-null) **before** calling `computeFireProjection`, or it throws `RangeError` and crashes SSR. When the guard fails, pass `configured: false` so the island renders the placeholder.
- **Starting principal vs progress numerator** — the projection uses `startingPrincipal = fire_starting_principal_override ?? netWorth` (matching the FIRE page), but the progress bar's percent numerator is **live `netWorth`** (the user's true current standing). These can differ when an override is set; that is intended.
- **Uncapped percent, clamped bar** — the percentage *label* shows the true `netWorth / fireNumber * 100` (may exceed 100%); the bar *fill width* is `Math.min(percent, 100)%` (a div cannot meaningfully exceed its track). At `percent >= 100` apply a distinct "FI reached" accent so the full bar reads as complete rather than stuck.
- **`prefers-reduced-motion`** — the bar's width CSS transition must be disabled under `@media (prefers-reduced-motion: reduce)`.

## Phase 1: Preference column, types, and API contract

### Overview

Add the `show_fire_dashboard` boolean to `user_preferences` (default TRUE), expose it through generated types, and make the user-preferences API read and write it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<new-timestamp>_user_preferences_show_fire_dashboard.sql` (timestamp must sort after `20260621000000`, e.g. `20260623120000`)

**Intent**: Add a single boolean column to `user_preferences` so each user's FIRE-card visibility persists, defaulting to visible.

**Contract**: `ALTER TABLE user_preferences ADD COLUMN show_fire_dashboard BOOLEAN NOT NULL DEFAULT TRUE;` wrapped in `BEGIN/COMMIT`, mirroring `20260603120000_user_preferences_theme.sql`. Note this differs from the `show_on_chart` precedent's `DEFAULT FALSE` — here the default is `TRUE` (card on by default).

#### 2. Generated database types

**File**: `src/lib/database.types.ts`

**Intent**: Add the new column to the `user_preferences` Row/Insert/Update types so all consumers type-check.

**Contract**: `show_fire_dashboard: boolean` in Row; `show_fire_dashboard?: boolean` in Insert and Update. Prefer regenerating via `npx supabase gen types` (the project's `npx astro sync` / supabase types flow) after the migration applies; hand-edit only if regeneration is unavailable.

#### 3. User-preferences API

**File**: `src/pages/api/user-preferences/index.ts`

**Intent**: Include the new column in reads and accept it on writes with boolean validation, mirroring the existing `theme`/`display_currency` validation style.

**Contract**: Append `show_fire_dashboard` to the `PREFS_SELECT` constant. In the PUT handler's validation, add a branch: if `raw.show_fire_dashboard` is present and `typeof !== "boolean"`, return `jsonError("VALIDATION_ERROR", ...)`; otherwise include it in `updates`. Keep the existing "at least one field" guard working (the new field counts as a field). Use the established `{ error: { code, message, context? } }` shape.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly: `supabase db reset` (or `supabase migration up`) succeeds with no error
- [ ] Type checking passes: `npx astro sync && npx tsc --noEmit` (or project equivalent)
- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build`

#### Manual Verification:

- [ ] `GET /api/user-preferences` returns `show_fire_dashboard` (true for a fresh row)
- [ ] `PUT /api/user-preferences` with `{ "show_fire_dashboard": false }` persists and round-trips
- [ ] `PUT` with a non-boolean (`"show_fire_dashboard": "yes"`) returns a `VALIDATION_ERROR` with the standard error shape

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Pure runway helper + tests

### Overview

Add a pure, table-tested `monthsOfRunway` helper so the "months at zero income" metric is centralized and unit-tested, matching the FIRE engine's testing discipline.

### Changes Required:

#### 1. Runway helper

**File**: `src/lib/fire.ts`

**Intent**: Compute how many months the user could live on current net worth with zero income, as a pure function reusable by the card.

**Contract**: `export function monthsOfRunway(netWorth: number, annualExpenses: number): number | null` returning `netWorth / (annualExpenses / 12)`. Guard `annualExpenses <= 0` (and non-finite) → return `null` (no runway is meaningful without positive expenses). Keep it in `fire.ts` to centralize FIRE math and reuse the existing test file. Returns a raw float; rounding happens at the view edge.

#### 2. Unit tests

**File**: `src/lib/fire.test.ts`

**Intent**: Pin the helper's behavior with hand-computed oracles, mirroring the file's baseline-factory + first-principles-oracle style.

**Contract**: A new `describe("monthsOfRunway", ...)` block. Cases: positive net worth + positive expenses (`toBeCloseTo(_, 6)` against a hand-computed oracle, e.g. `120000 / (40000/12)`); `annualExpenses <= 0` → `null`; `annualExpenses === 0` → `null`; net worth `0` → `0`; negative net worth (liabilities exceed assets) → negative number (documented, not clamped). Include a 333.33-class scaling probe if a natural one fits.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `npm run test` (or `npx vitest run src/lib/fire.test.ts`)
- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- [ ] Spot-check one oracle by hand (e.g. net worth 120000, expenses 40000 → 36 months)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Settings toggle

### Overview

Surface the `show_fire_dashboard` preference as a checkbox in the settings form, wired through the settings page SSR and the existing JSON PUT.

### Changes Required:

#### 1. Settings page SSR

**File**: `src/pages/dashboard/settings.astro`

**Intent**: Load the current value of the toggle and pass it to the form.

**Contract**: Add `show_fire_dashboard` to the `user_preferences` select string; normalize to an `initialShowFireDashboard: boolean` (default `true` when the row/column is absent); pass it as a prop to `SettingsForm`.

#### 2. Settings form

**File**: `src/components/settings/SettingsForm.tsx`

**Intent**: Render an `accent-purple-600` checkbox bound to controlled state, include it in change detection, and send it in the PUT body when changed.

**Contract**: New prop `initialShowFireDashboard: boolean`; `useState` for `showFireDashboard`; extend `hasChanges` to include it; include `show_fire_dashboard` in the changed-fields payload sent to `PUT /api/user-preferences`. Render a native `<input type="checkbox" className="size-4 accent-purple-600">` with an associated `<label>` (e.g. "Show FIRE progress on dashboard"), following the `AssetForm.tsx:330-346` checkbox pattern but **without** the hidden mirror input (SettingsForm submits JSON, not FormData). Reuse the existing reload-on-success flow.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes (incl. `react-compiler` error rule): `npm run lint`
- [ ] Build passes: `npm run build`

#### Manual Verification:

- [ ] Settings page shows the checkbox, checked by default for a fresh account
- [ ] Unchecking and saving persists `false`; reloading settings shows it unchecked
- [ ] Re-checking and saving persists `true`
- [ ] No console errors; save button enables only when something changed

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Dashboard FIRE-progress card

### Overview

Extend `dashboard.astro` SSR to read the FIRE preference + inputs, compute net worth and the projection (guarded), and conditionally render a new `FireProgress` island that presents the bar + three metrics, or a setup placeholder.

### Changes Required:

#### 1. Dashboard SSR

**File**: `src/pages/dashboard.astro`

**Intent**: Gather everything the card needs server-side and decide configured-vs-placeholder, without crashing on invalid/missing FIRE inputs.

**Contract**: Add a `user_preferences` select for `show_fire_dashboard` + the nine `fire_*` columns (`.eq("user_id", user.id).maybeSingle()`), casting the row to `Record<string, number | null>` for the `fire_*` reads (mirror `fire.astro`). When `show_fire_dashboard` is `true`:
- Compute `netWorth` via `computeNetWorth(assets.map(a => ({ amount, currency: a.currency as Currency, category: { is_liability } })), displayCurrency, rates)` (the `getRates` call already exists; reuse it).
- Determine `configured`: all of `fire_annual_expenses`, `fire_annual_income`, `fire_expected_return`, `fire_inflation_rate`, `fire_current_age` are non-null **and** `fire_safe_withdrawal_rate > 0`. (`fire_safe_withdrawal_rate` and `fire_traditional_retirement_age` are NOT NULL with defaults.)
- When `configured`: build `FireInputs` with `startingPrincipal = fire_starting_principal_override ?? netWorth`, call `computeFireProjection`, derive `percent = netWorth / result.fireNumber * 100`, `runwayMonths = monthsOfRunway(netWorth, fire_annual_expenses)`, and pass `{ configured: true, percent, fireNumber: result.fireNumber, yearsToFi: result.yearsToFi, runwayMonths, displayCurrency }` to the island.
- When not `configured` (or SWR guard fails): pass `{ configured: false }`.

Render `<FireProgress ... client:load />` (or `client:visible`) inside the existing `assets && (...)` fragment, immediately after `NetWorthDisplay`. Wrap the whole card render in the `show_fire_dashboard` check so nothing renders when the toggle is off.

#### 2. FireProgress island

**File**: `src/components/fire/FireProgress.tsx` (new)

**Intent**: Pure presentational island that renders either the placeholder or the bar + three metrics from already-computed props.

**Contract**: Props: `{ configured: boolean; percent?: number; fireNumber?: number; yearsToFi?: number | null; runwayMonths?: number | null; displayCurrency: Currency }`.
- `configured === false` → placeholder card: short prompt + a link `<a href="/dashboard/fire">` to set up the FIRE calculator. No link/CTA appears on the configured card (per decision).
- `configured === true` → a progress bar (fill width `Math.min(percent, 100)%`, CSS `transition` on width, disabled under `prefers-reduced-motion`; distinct "FI reached" accent when `percent >= 100`) with an **uncapped** percent label; then three metrics: **years-to-FI** (rendered only when `yearsToFi != null` — omit the row entirely when `null`), **months of runway** shown as `N months (N.N years)`, and the **FIRE number** formatted in `displayCurrency`. Include a brief "estimate, not financial advice" disclaimer consistent with the FIRE page. Reuse money/percent formatting consistent with `FireCalculatorForm`'s `formatMoney`/`formatPct` (extract or duplicate the small helpers; do not import from the form). Must satisfy `react-compiler` (no manual memo hacks that violate the rule).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Linting passes (incl. `react-compiler` + `astro/no-set-html-directive`): `npm run lint`
- [ ] Build passes: `npm run build`

#### Manual Verification:

- [ ] With toggle on + all core FIRE inputs set: card shows bar (with uncapped % label), years-to-FI, runway as "N months (N.N years)", and FIRE number in display currency
- [ ] With toggle on + core inputs missing (e.g. clear annual expenses): card shows the placeholder linking to `/dashboard/fire`
- [ ] With toggle off: no card renders
- [ ] Net worth ≥ FIRE number: bar reads as complete (FI-reached accent) and label shows the true (>100%) percentage
- [ ] FI unreachable (`yearsToFi` null, e.g. expenses ≥ income): years-to-FI row is hidden; bar/runway/FIRE number still render
- [ ] Changing display currency updates the card's amounts on reload
- [ ] `prefers-reduced-motion` disables the bar animation
- [ ] Card is readable and stacks correctly on a phone-sized viewport

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- `monthsOfRunway`: positive case (hand-computed oracle, `toBeCloseTo(_, 6)`), `annualExpenses <= 0` → null, `annualExpenses === 0` → null, net worth 0 → 0, negative net worth → negative (documented). Optional 333.33-class scaling probe.

### Integration Tests:

- Not adding new integration tests in this slice; the API change is exercised manually (GET/PUT round-trip) and covered by type checks + the existing user-preferences handler structure. (If the project later adds handler tests for `user_preferences`, the boolean branch should be pinned there.)

### Manual Testing Steps:

1. Fresh account → dashboard shows the FIRE placeholder card (toggle defaults on, no FIRE data yet).
2. Set all FIRE inputs on `/dashboard/fire`, return to dashboard → card shows bar + metrics.
3. Settings → uncheck "Show FIRE progress on dashboard", save → dashboard shows no card.
4. Re-check → card returns.
5. Edge: set net worth above FIRE number (large balances) → bar complete + >100% label.
6. Edge: set annual expenses ≥ income → years-to-FI row hidden.
7. Toggle `prefers-reduced-motion` (OS setting) → no bar animation.
8. Switch display currency → amounts update on reload.

## Performance Considerations

The dashboard already loads assets and `getRates`; the card adds one `user_preferences` select and one in-process `computeNetWorth` + `computeFireProjection` call (pure, O(years) ≤ ~70 iterations). Negligible. SSR computation keeps the island purely presentational, preserving the NFR of net worth visible within 2s.

## Migration Notes

The new column is `NOT NULL DEFAULT TRUE`, so all existing `user_preferences` rows get `show_fire_dashboard = true` on migration — existing users see the card by default, matching the intended behavior. No data backfill needed. Rollback = drop the column (no dependent data).

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-14 (lines 287-303)
- Change identity: `context/changes/fire-dashboard/change.md`
- SSR template to copy: `src/pages/dashboard/fire.astro`
- FIRE engine: `src/lib/fire.ts` (`computeFireProjection`, `FireResult`); tests `src/lib/fire.test.ts`
- Net worth: `src/lib/net-worth.ts` (`computeNetWorth`)
- Boolean-pref precedents: `supabase/migrations/20260619120000_assets_show_on_chart.sql`, `20260603120000_user_preferences_theme.sql`; checkbox JSX `src/components/assets/AssetForm.tsx:330-346`
- Currency-cast lesson: `context/foundation/lessons.md` → "Currency cast boundary"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Preference column, types, and API contract

#### Automated

- [x] 1.1 Migration applies cleanly: `supabase db reset` — 01bb784
- [x] 1.2 Type checking passes: `npx astro sync && npx tsc --noEmit` — 01bb784
- [x] 1.3 Linting passes: `npm run lint` — 01bb784
- [x] 1.4 Build passes: `npm run build` — 01bb784

#### Manual

- [x] 1.5 GET returns `show_fire_dashboard` (true for fresh row) — 01bb784
- [x] 1.6 PUT `{ show_fire_dashboard: false }` persists and round-trips — 01bb784
- [x] 1.7 PUT with non-boolean returns VALIDATION_ERROR with standard shape — 01bb784

### Phase 2: Pure runway helper + tests

#### Automated

- [x] 2.1 Unit tests pass: `npm run test` — c0ed8a8
- [x] 2.2 Type checking passes: `npx tsc --noEmit` — c0ed8a8
- [x] 2.3 Linting passes: `npm run lint` — c0ed8a8

#### Manual

- [x] 2.4 Spot-check one oracle by hand (120000 / (40000/12) = 36 months) — c0ed8a8

### Phase 3: Settings toggle

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit` — ae77f90
- [x] 3.2 Linting passes (incl. react-compiler): `npm run lint` — ae77f90
- [x] 3.3 Build passes: `npm run build` — ae77f90

#### Manual

- [x] 3.4 Checkbox shown, checked by default for fresh account — ae77f90
- [x] 3.5 Uncheck + save persists false; reload shows unchecked — ae77f90
- [x] 3.6 Re-check + save persists true — ae77f90
- [x] 3.7 No console errors; save enables only on change — ae77f90

### Phase 4: Dashboard FIRE-progress card

#### Automated

- [x] 4.1 Type checking passes: `npx tsc --noEmit`
- [x] 4.2 Linting passes (incl. react-compiler + no-set-html-directive): `npm run lint`
- [x] 4.3 Build passes: `npm run build`

#### Manual

- [x] 4.4 Configured: card shows bar (uncapped % label), years-to-FI, runway "N months (N.N years)", FIRE number in display currency
- [x] 4.5 Missing core inputs: placeholder linking to `/dashboard/fire`
- [x] 4.6 Toggle off: no card renders
- [x] 4.7 Net worth ≥ FIRE number: bar complete (FI-reached accent) + >100% label
- [x] 4.8 FI unreachable: years-to-FI row hidden; rest renders
- [x] 4.9 Display currency change updates amounts on reload
- [x] 4.10 `prefers-reduced-motion` disables bar animation
- [x] 4.11 Card readable and stacks on phone-sized viewport
