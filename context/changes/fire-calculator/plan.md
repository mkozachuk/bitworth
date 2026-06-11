# FIRE Calculator (S-09) Implementation Plan

## Overview

A savings-rate-driven FIRE / retirement calculator at `/dashboard/fire`. The user enters their current age, annual income, annual expenses, an expected nominal return, an inflation rate, a safe withdrawal rate, and (optionally) a part-time semi-retirement income. The calculator seeds the projection's starting principal from the user's **current net worth** (`computeNetWorth()`), derives their **savings rate**, projects their portfolio forward **in real (today's-dollar) terms**, and reports a **retirement age**, **years-to-FI**, their **FIRE number**, **Coast FIRE**, and **Barista FIRE** milestones — with a projection chart. All math lives in a pure, unit-tested `src/lib/fire.ts` built before any UI, per the roadmap risk note.

This was promoted from a PRD §Non-Goal on 2026-06-11 (roadmap slice **S-09**). During planning the scope was reframed from the roadmap's contribution-driven "tracker" into a playingwithfire.co-style **savings-rate-driven retirement planner** (income & expenses → savings rate → retirement age), per user decision.

## Current State Analysis

The codebase already contains every dependency this feature needs — no new libraries (see `research.md`):

- **Starting principal**: `computeNetWorth(assets, displayCurrency, rates): number` (`src/lib/net-worth.ts:40-56`) returns net worth as a single number in the display currency. It is currently **unused by production code** (both live sites re-implement the loop inline) — S-09 is its first real caller. Rates come from `getRates(supabase)` (`src/lib/exchange-rates.ts:46-86`), which always returns a full `Record<Currency, number>` over `PLN | USD | EUR` (with a static fallback).
- **Display currency**: resolved once in `src/middleware.ts:18-33` into `Astro.locals.displayCurrency` (typed at `src/env.d.ts:1-7`); SSR pages read `Astro.locals.displayCurrency ?? "USD"`. A page at `src/pages/dashboard/fire.astro` is **auto-protected** because `PROTECTED_ROUTES = ["/dashboard"]` is a prefix match (`src/middleware.ts:4,35`).
- **Persistence**: `user_preferences` (1:1 with `auth.users`, auto-created by the `on_auth_user_created` trigger, RLS already `USING` + `WITH CHECK`). The `theme` column migration (`supabase/migrations/20260603120000_user_preferences_theme.sql`) is the add-a-setting precedent. Every authed user already has a row, so new columns are either `NOT NULL DEFAULT` or nullable.
- **Settings API**: `PUT /api/user-preferences` (`src/pages/api/user-preferences/index.ts:55-143`) is the handler template — auth → null-guard → `getUser()` → validate → `.upsert(..., { onConflict: "user_id" })`. Error shape `{ error: { code, message, context? } }` enforced via local `ErrorShape` + `satisfies`. The asset handlers (`src/pages/api/assets/index.ts`) use **Zod**, the established pattern for numeric range validation.
- **Charting**: Recharts `^3.8.1` (`package.json:39`). The only chart, `src/components/NetWorthChart.tsx`, already imports `ReferenceLine` (used for a "Start" marker at `:137-140`) — exactly the primitive for a FIRE-target line. Reuse its `ResponsiveContainer` (with `initialDimension` for island hydration), CSS-variable colors (`--chart-1..--chart-5` in `src/styles/global.css`), and inline `toLocaleString` formatting.
- **Test infra**: Vitest with `vite-tsconfig-paths` (`@/` alias resolves), `include: ["src/**/*.test.{ts,tsx}"]`, `environment: "node"`. House style (`src/lib/net-worth.test.ts`): explicit `import { describe, expect, it } from "vitest"` (no globals), `@/` alias imports, one `describe` per function, oracle values from first principles in inline comments, `toBe` for exact integers and `toBeCloseTo(expected, 6)` for division/exponentiation. CI (`.github/workflows/ci.yml`) runs `astro sync → typecheck → lint → test:ci → (gated) test:e2e → build` — a stale `database.types.ts` fails CI.

What's missing: the entire feature — the pure math, the persisted inputs, the page, the form, and the chart.

## Desired End State

An authenticated user navigates to `/dashboard/fire` and sees a calculator pre-filled with their persisted inputs (or sensible defaults on first visit) and a starting principal seeded from their current net worth. As they edit income, expenses, return, inflation, SWR, or age, the **results and chart recompute live** (client-side, via the same `fire.ts`): their FIRE number, savings rate, years-to-FI, projected retirement age, and Coast/Barista FIRE thresholds update instantly. A Save button persists the inputs to `user_preferences`. A persistent "estimate, not financial advice" disclaimer is visible near the results. All figures are in the user's display currency, in **today's purchasing power** (real terms), clearly labelled.

**Verification**: `npm run test:run` (fire.ts + handler tests green), `npm run typecheck` (regenerated types clean), `npm run lint`, `npm run build` all pass; manual walk-through of the calculator at `/dashboard/fire` shows correct, live-updating projections and a persisted reload.

### Key Discoveries:

- `src/lib/net-worth.ts:40-56` — `computeNetWorth` is the starting-principal source; this feature is its first production caller (consolidating a known duplication smell, `net-worth.ts:32-38`).
- `src/components/NetWorthChart.tsx:1,118,137-140` — clone target: `ReferenceLine`, `ResponsiveContainer` with `initialDimension`, CSS-var colors.
- `src/pages/api/user-preferences/index.ts:55-143` — extend this handler (don't add a second select-projection-widening site).
- `supabase/migrations/20260603120000_user_preferences_theme.sql` — copy-paste precedent for adding columns to `user_preferences`.
- `context/foundation/lessons.md:25-33` — Currency cast boundary: cast DB `currency` rows `as Currency` at the call site; do not widen `convertAmount`.
- `fire.ts` is pure TS → importable in **both** the Astro SSR frontmatter and the React island, enabling live client recompute with zero server round-trips.

## What We're NOT Doing

- **No income/expense growth rates** — income and expenses are held flat over the projection (deferred; user decision).
- **No one-off cash-flow events** (inheritance, home sale, big expense) — deferred to a possible v2.
- **No Monte Carlo / variable returns / volatility** — single deterministic real-return path only.
- **No explicit withdrawal-phase drawdown simulation** — the projection stops at the FIRE crossing; it does not model post-retirement spend-down.
- **No multi-person / household mode, pensions, or Social Security inputs.**
- **No multiple saved scenarios per user** — single-scenario persistence (columns on `user_preferences`); a `fire_settings` table is explicitly out of scope.
- **No new shared `formatCurrency` helper** — follow the established inline `toLocaleString` house convention (a shared formatter is a noted optional cleanup, not part of this change).
- **No middleware edit** — the page is auto-protected by the `/dashboard` prefix.

## Implementation Approach

Build bottom-up, math-first (roadmap mandate). Phase 1 delivers a fully-tested pure `fire.ts` with a closed-form-verified projection. Phase 2 adds persistence (migration + regenerated types + extended API). Phase 3 builds the SSR page and the interactive form/results island that recomputes live through `fire.ts`. Phase 4 clones the chart and wires it into the live recompute. Because `fire.ts` is pure and runs on both server and client, the same function computes the initial SSR render and every subsequent keystroke update — there is exactly one source of projection truth.

## Critical Implementation Details

- **Real-return convention (the roadmap's top correctness hazard).** The user enters a **nominal** return and an **inflation** rate. `fire.ts` converts once to a **real return** `realReturn = (1 + nominal) / (1 + inflation) - 1` and runs the **entire** projection — balance growth, FIRE number comparison, Coast FIRE discounting — in real (today's-dollar) terms. There is no nominal stream and no per-year re-inflation of the target; this single-convention choice is what avoids the nominal/real mixing bug. The chart Y-axis and all figures must be labelled as today's-money.
- **Compounding & contribution timing (the off-by-one the tests pin).** Annual step; the year's savings are added at **end of year** (ordinary annuity): `balance_{n+1} = balance_n * (1 + realReturn) + annualSavings`. `yearsToFi` is the smallest integer `n` such that `balance_n >= fireNumber`. `retirementAge = currentAge + yearsToFi`. If `balance_0 >= fireNumber` already, `yearsToFi = 0` (retire now).
- **Unreachable cases must return a sentinel, not loop forever.** If `annualSavings <= 0` and `balance_0 < fireNumber` and `realReturn <= 0`, FI is never reached — cap the projection at a horizon (`maxYears`, default `100 - currentAge`) and return `yearsToFi: null` / `retirementAge: null`. Guard `safeWithdrawalRate === 0` (FIRE number would divide by zero) and treat as invalid.
- **Coast / Barista definitions.** `coastFireNumber = fireNumber / (1 + realReturn) ** (traditionalRetirementAge - currentAge)`; `isCoastFi = startingPrincipal >= coastFireNumber`. Barista uses an optional part-time income: `baristaFireNumber = (annualExpenses - baristaIncome) / safeWithdrawalRate` (floored at 0); when `baristaIncome` is null/0, the Barista row equals the full FIRE number and the UI may collapse it. If `traditionalRetirementAge <= currentAge`, Coast FIRE is undefined — surface "already past traditional retirement age" rather than computing a negative exponent.

## Phase 1: Pure FIRE Math Library

### Overview

Implement `src/lib/fire.ts` as a pure, dependency-free module and pin its behavior with table-driven tests. No Supabase, no React, no I/O — importable on server and client alike.

### Changes Required:

#### 1. FIRE projection module

**File**: `src/lib/fire.ts`

**Intent**: Provide the single source of projection truth: convert nominal+inflation to a real return, derive the FIRE number / savings rate, project the portfolio year-by-year in real terms, and report years-to-FI, retirement age, and Coast/Barista milestones. Pure function(s), no external dependencies.

**Contract**: Export an input type and a result type plus a `computeFireProjection(inputs): FireResult`.

```ts
export interface FireInputs {
  startingPrincipal: number;          // today's currency, real
  annualIncome: number;
  annualExpenses: number;
  nominalReturn: number;              // e.g. 0.07
  inflationRate: number;              // e.g. 0.03
  safeWithdrawalRate: number;         // e.g. 0.04 (> 0)
  currentAge: number;
  traditionalRetirementAge: number;   // default 65, must be > currentAge for Coast
  baristaIncome?: number;             // optional part-time semi-retirement income
  maxYears?: number;                  // projection horizon; default 100 - currentAge
}

export interface FireProjectionPoint {
  age: number;
  balance: number;                    // real terms
}

export interface FireResult {
  realReturn: number;
  fireNumber: number;                 // annualExpenses / safeWithdrawalRate
  annualSavings: number;              // annualIncome - annualExpenses
  savingsRate: number;                // annualSavings / annualIncome (0 if income <= 0)
  yearsToFi: number | null;           // null if unreachable within maxYears
  retirementAge: number | null;       // currentAge + yearsToFi, else null
  coastFireNumber: number | null;     // null if traditionalRetirementAge <= currentAge
  isCoastFi: boolean;
  baristaFireNumber: number;          // (expenses - baristaIncome)/SWR, floored at 0
  isBaristaFi: boolean;               // startingPrincipal >= baristaFireNumber
  projection: FireProjectionPoint[];  // age vs real balance, from currentAge to FI (or horizon)
}
```

Real-return, end-of-year-annuity, unreachable-sentinel, and Coast/Barista rules per **Critical Implementation Details**. Keep all values as raw floats; no rounding inside the module.

#### 2. Table-driven tests

**File**: `src/lib/fire.test.ts`

**Intent**: Verify every branch of the projection against oracles computed from first principles, with explicit attention to the FP / off-by-one hazards.

**Contract**: `import { describe, expect, it } from "vitest"`; import via `@/lib/fire`. One `describe` per exported function. Cover, with inline closed-form oracles in comments: real-return conversion (`toBeCloseTo(_, 6)`); FIRE number (`expenses/SWR`); savings rate including the `income <= 0` guard; a multi-year projection where each year's balance is computed by hand (end-of-year annuity) and `yearsToFi` is the exact crossing year (`toBe`); already-FI (`yearsToFi === 0`); unreachable (negative savings + non-positive real return → `yearsToFi: null`); `maxYears` horizon cap; Coast FIRE discounting and the `traditionalRetirementAge <= currentAge → null` guard; Barista with and without `baristaIncome`; a deliberate FP probe (`333.33`-class values) to catch ×/÷ scaling bugs. Use `toBeCloseTo(_, 6)` for any growth/division result, `toBe` for provably-exact integers.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:run`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- A hand-worked example (e.g. principal 100k, income 80k, expenses 40k, nominal 7%, inflation 3%, SWR 4%) produces a years-to-FI that matches a spreadsheet to the year.
- The unreachable case (expenses ≥ income, non-positive real return) returns `null` rather than hanging or producing a huge number.

**Implementation Note**: After automated verification passes, pause for human confirmation of the hand-worked oracle before proceeding to Phase 2.

---

## Phase 2: Persistence — Schema, Types, API

### Overview

Persist the calculator inputs per-user as `fire_*` columns on `user_preferences`, regenerate the DB types, and extend the existing preferences API to read/write them with range validation.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_user_preferences_fire.sql`

**Intent**: Add the FIRE input columns to `user_preferences`, inheriting its RLS, auto-create, and `updated_at` triggers. SWR gets a non-null default; the rest are nullable-until-set; traditional retirement age defaults to 65.

**Contract**: `ALTER TABLE user_preferences ADD COLUMN` for: `fire_current_age INTEGER`, `fire_annual_income NUMERIC(18,2)`, `fire_annual_expenses NUMERIC(18,2)`, `fire_expected_return NUMERIC(5,4)`, `fire_inflation_rate NUMERIC(5,4)`, `fire_safe_withdrawal_rate NUMERIC(5,4) NOT NULL DEFAULT 0.04`, `fire_starting_principal_override NUMERIC(18,2)`, `fire_traditional_retirement_age INTEGER NOT NULL DEFAULT 65`, `fire_barista_income NUMERIC(18,2)`. Add `CHECK` constraints mirroring the API bounds (rates in `[0,1]`, ages in a sane band, non-negative money) where they express cleanly in SQL. `NUMERIC(18,2)` is the project money convention (`assets.amount`).

#### 2. Regenerated DB types

**File**: `src/lib/database.types.ts`

**Intent**: Reflect the new columns so `typecheck` passes (CI gate).

**Contract**: Regenerate via the project's Supabase type-gen (`npx astro sync` shorthand). `Tables<'user_preferences'>` Row/Insert/Update gain the nine `fire_*` fields (numerics typed as `number`, nullable as documented). Do not hand-edit beyond regeneration.

#### 3. Extend the preferences API

**File**: `src/pages/api/user-preferences/index.ts`

**Intent**: Accept and validate the FIRE fields in the existing `PUT`, and include them in the response/select projection, while preserving the current `display_currency`/`theme` behavior.

**Contract**: Add a **Zod** schema (asset-handler pattern) for the FIRE fields — all optional, numbers with range refinements (`safeWithdrawalRate` and rates in `(0,1]` / `[0,1]`, `currentAge`/`traditionalRetirementAge` in a sane integer band with `traditional > current` cross-check, non-negative money). On validation failure return the existing `VALIDATION_ERROR` 400 shape. Merge validated fields into the `.upsert({ user_id, ...updates }, { onConflict: "user_id" })` and widen the `.select(...)` to include the `fire_*` columns. Keep the manual `display_currency`/`theme` allow-lists untouched.

#### 4. Handler tests

**File**: `src/pages/api/user-preferences/index.test.ts`

**Intent**: Cover the new validation and persistence paths.

**Contract**: Extend existing tests using the `createSupabaseMock` + `asClient` helper (per `lessons.md` / MEMORY `project_tsc_blocker_phase4`). Add cases: valid FIRE payload upserts and echoes back; out-of-range rate → 400 `VALIDATION_ERROR`; `traditional <= current` age → 400; partial payload (only some `fire_*` fields) leaves others untouched.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase (`supabase db reset` or equivalent).
- Regenerated types compile: `npm run typecheck`
- Handler + lib tests pass: `npm run test:run`
- Linting passes: `npm run lint`

#### Manual Verification:

- `PUT /api/user-preferences` with a FIRE payload persists and returns the values on a subsequent `GET`/page load.
- An out-of-range value is rejected with the correct error shape.

**Implementation Note**: After automated verification passes, pause for human confirmation that the migration + type regen are clean before proceeding to Phase 3.

---

## Phase 3: SSR Page + Interactive Form/Results Island

### Overview

Build the `/dashboard/fire` page: seed the starting principal from net worth, load persisted inputs and display currency, and render an interactive island that recomputes the results live through `fire.ts` and persists via the API.

### Changes Required:

#### 1. SSR page

**File**: `src/pages/dashboard/fire.astro`

**Intent**: Server-render the page shell, compute the seeded starting principal, and pass persisted inputs + display currency into the island.

**Contract**: Mirror `dashboard.astro` data flow — page-level `if (!user) redirect("/auth/signin")` guard; `displayCurrency = Astro.locals.displayCurrency ?? "USD"`; fetch `assets` joined with `category:asset_categories(*)`; `rates = await getRates(supabase)`; call `computeNetWorth((assets ?? []).map(a => ({ amount: a.amount, currency: a.currency as Currency, category: { is_liability: a.category.is_liability } })), displayCurrency, rates)` (cast per the Currency-boundary lesson). Fetch the persisted `fire_*` fields from `user_preferences`. Render the form island with `client:load`, passing `displayCurrency`, the seeded principal, and the persisted inputs (or defaults).

#### 2. Form + results island

**File**: `src/components/fire/FireCalculatorForm.tsx`

**Intent**: Collect the inputs, recompute live via `fire.ts` on every change, render the results panel + disclaimer, and Save to the API.

**Contract**: Props: `{ displayCurrency: Currency; startingPrincipal: number; initialInputs: Partial<FireInputs> }`. Local state seeded from `initialInputs` (defaults: SWR 0.04, traditional retirement age 65, starting principal = the seeded net worth which the user may override). On any input change, call `computeFireProjection(state)` and render the results panel: FIRE number, savings rate (with the income & expenses framing), years-to-FI, **retirement age** headline, Coast FIRE / Barista FIRE rows (Barista collapses when no part-time income). Inputs use `getByLabel`-friendly labelled fields; money/rate formatting via inline `toLocaleString` (rates as %). A persistent inline **"Estimate, not financial advice"** disclaimer near the results. A Save button issues a partial `PUT /api/user-preferences` with the `fire_*` fields then reloads (matching `SettingsForm.tsx` convention). Must satisfy `react-compiler` (no manual memo violations) and `astro/no-set-html-directive`. Pass the computed `projection` to the chart (Phase 4) — structure the component so the chart slots in.

#### 3. Navigation link

**File**: existing dashboard nav (the component rendering the dashboard/settings links)

**Intent**: Make `/dashboard/fire` reachable.

**Contract**: Add a "FIRE" (or "Retirement") link alongside the existing dashboard/settings nav entries, following the established markup.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes (incl. `react-compiler`, `astro/no-set-html-directive`): `npm run lint`
- Build succeeds: `npm run build`
- Existing + new unit tests pass: `npm run test:run`

#### Manual Verification:

- `/dashboard/fire` loads for an authed user with the starting principal pre-filled from their net worth; unauthenticated access redirects to `/auth/signin`.
- Editing income/expenses/return/inflation/SWR/age updates the FIRE number, savings rate, years-to-FI, and retirement age **live** (no reload).
- Save persists; reloading the page shows the saved inputs.
- The disclaimer is visible; figures are labelled as today's-money in the display currency.

**Implementation Note**: After automated verification passes, pause for human confirmation of the live-recompute UX before proceeding to Phase 4.

---

## Phase 4: Projection Chart Island

### Overview

Clone `NetWorthChart` into a FIRE projection chart, wire it into the form so it recomputes live, and handle the empty / never-reaches-FI states.

### Changes Required:

#### 1. Chart component

**File**: `src/components/fire/FireProjectionChart.tsx`

**Intent**: Render the year-by-year real-terms projection with a FIRE-number target line.

**Contract**: Clone `NetWorthChart.tsx` structure — same Recharts imports, `ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}`, CSS-var colors, inline `toLocaleString` ticks, `CustomTooltip` shape. Props: `{ projection: FireProjectionPoint[]; fireNumber: number; displayCurrency: Currency; retirementAge: number | null }`. X-axis = `age`, Y-axis = real `balance`. A `ReferenceLine` at `fireNumber` (use `var(--chart-3)` / `var(--chart-4)` to distinguish from the line). Render an empty / "won't reach FI within the projection horizon at this savings rate" message when `projection` is empty or `retirementAge` is null (Recharts won't render empty data — follow the `NetWorthChart.tsx:82-96` empty-card pattern). Label the axis as today's-money.

#### 2. Wire chart into the form

**File**: `src/components/fire/FireCalculatorForm.tsx`

**Intent**: Render the chart from the same live-computed `FireResult` so it updates with the results panel.

**Contract**: Pass the current `projection`, `fireNumber`, `retirementAge`, and `displayCurrency` into `<FireProjectionChart />`. No second computation path — one `computeFireProjection` call per render feeds both the results panel and the chart.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Unit tests pass: `npm run test:run`

#### Manual Verification:

- The chart renders the projection curve with a FIRE-number reference line and updates live as inputs change.
- The never-reaches-FI case shows the explanatory message instead of a broken/empty chart.
- The chart is legible in both light and dark themes (CSS-var colors) and at mobile widths.

**Implementation Note**: After automated verification passes, pause for final human confirmation of the full calculator.

---

## Testing Strategy

### Unit Tests:

- `src/lib/fire.test.ts` — the math contract: real-return conversion, FIRE number, savings rate (incl. `income <= 0`), year-by-year projection with hand-computed oracles, exact `yearsToFi` crossing year, already-FI, unreachable → `null`, `maxYears` cap, Coast discounting + `trad <= current` guard, Barista with/without part-time income, FP probe.
- `src/pages/api/user-preferences/index.test.ts` — FIRE payload upsert + echo, range-validation rejections (rates, ages, cross-check), partial-payload non-clobber.

### Integration Tests:

- E2E (Playwright) is **out of scope for this plan** but a natural follow-up via `/10x-e2e`: load `/dashboard/fire`, assert the seeded principal, edit an input and assert live result change, Save and assert persistence on reload. (Note the CI e2e gate is conditional on Supabase secrets, per commit `503b066`.)

### Manual Testing Steps:

1. Sign in, open `/dashboard/fire`; confirm starting principal matches the dashboard net worth.
2. Enter income 80k, expenses 40k, nominal 7%, inflation 3%, SWR 4%, age 30; confirm savings rate 50%, a plausible retirement age, and a chart crossing the FIRE line; cross-check years-to-FI against a spreadsheet.
3. Set expenses > income; confirm the "won't reach FI" message and null retirement age.
4. Toggle Coast inputs (traditional retirement age) and a Barista part-time income; confirm those rows update.
5. Save, reload; confirm inputs persisted. Switch display currency in settings; confirm the calculator reflects it.

## Performance Considerations

The projection is an O(years) loop (≤ ~70 iterations) recomputed per keystroke on the client — negligible. No server round-trip on edit (only on Save). SSR does one `computeNetWorth` over the user's assets and one `getRates` call (cached, TTL 3600s), matching the dashboard's existing cost.

## Migration Notes

Adding columns to `user_preferences`: every existing user already has a row (auto-create trigger), so nullable columns backfill as `NULL` and the two `NOT NULL DEFAULT` columns (SWR 0.04, traditional retirement age 65) backfill to their defaults. No data migration needed. The type regeneration (`astro sync`) is a CI gate — it must be committed with the migration.

## References

- Research: `context/changes/fire-calculator/research.md`
- Roadmap slice: `context/foundation/roadmap.md` S-09
- Starting principal: `src/lib/net-worth.ts:40-56`, `src/lib/exchange-rates.ts:46-86`
- Chart clone target: `src/components/NetWorthChart.tsx:1,82-96,118,137-140`
- Persistence precedent: `supabase/migrations/20260603120000_user_preferences_theme.sql`, `src/pages/api/user-preferences/index.ts:55-143`
- Page/data-flow pattern: `src/pages/dashboard.astro:13-67`, `src/pages/dashboard/settings.astro`
- Test conventions: `src/lib/net-worth.test.ts`, `vitest.config.ts`
- Lessons: `context/foundation/lessons.md` (Currency cast boundary `:25-33`, RLS `:45-55`, `@/` alias `:35-43`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure FIRE Math Library

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:run`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`

#### Manual

- [x] 1.4 Hand-worked example matches a spreadsheet to the year
- [x] 1.5 Unreachable case returns `null` rather than hanging/overflowing

### Phase 2: Persistence — Schema, Types, API

#### Automated

- [ ] 2.1 Migration applies cleanly against local Supabase
- [ ] 2.2 Regenerated types compile: `npm run typecheck`
- [ ] 2.3 Handler + lib tests pass: `npm run test:run`
- [ ] 2.4 Linting passes: `npm run lint`

#### Manual

- [ ] 2.5 PUT persists FIRE payload and returns it on reload
- [ ] 2.6 Out-of-range value rejected with correct error shape

### Phase 3: SSR Page + Interactive Form/Results Island

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes (incl. react-compiler, no-set-html-directive): `npm run lint`
- [ ] 3.3 Build succeeds: `npm run build`
- [ ] 3.4 Existing + new unit tests pass: `npm run test:run`

#### Manual

- [ ] 3.5 Page loads with seeded principal; unauth redirects to signin
- [ ] 3.6 Editing inputs updates results live (no reload)
- [ ] 3.7 Save persists; reload shows saved inputs
- [ ] 3.8 Disclaimer visible; figures labelled today's-money in display currency

### Phase 4: Projection Chart Island

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build succeeds: `npm run build`
- [ ] 4.4 Unit tests pass: `npm run test:run`

#### Manual

- [ ] 4.5 Chart renders projection + FIRE reference line, updates live
- [ ] 4.6 Never-reaches-FI shows explanatory message, not a broken chart
- [ ] 4.7 Chart legible in light/dark and at mobile widths
