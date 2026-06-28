# Contributions vs Growth — Implementation Plan

## Overview

Split each snapshot-to-snapshot change in net worth into two forces: **contributions** (money the user added or withdrew) and **market growth** (everything else). The identity per interval is:

```
growth_t = (NW_t − NW_{t−1}) − net_contribution_t
```

We add a nullable `net_contribution` column to `snapshots`, capture it (signed) at save time via a dialog and allow editing/backfilling it on existing snapshots, compute the per-interval split in a pure, unit-tested `src/lib/contributions.ts`, and render the result as a diverging stacked-bar chart under the existing net-worth line chart. Intervals lacking a recorded contribution render as a neutral "unknown split" bar — never mislabeled, never crashing.

This is roadmap slice **S-17** (`context/foundation/roadmap.md`, Stream H).

## Current State Analysis

- **Snapshots schema** (`supabase/migrations/20260529190856_initial_schema.sql:42-51`): `snapshots` has 8 columns (`id, user_id, total_net_worth, display_currency, base_currency, source, note, created_at`). It has **never been column-added** — the column-add pattern must be borrowed from `20260619120000_assets_show_on_chart.sql` (single column, `BEGIN;/COMMIT;`) and `20260611120000_user_preferences_fire.sql` (money columns as `NUMERIC(18,2)`, inline comment documenting RLS inheritance + rollback).
- **Save flow is a bodyless POST** (`src/components/assets/NetWorthDisplay.tsx:36-110`, `SaveButton`): a single button that does `fetch("/api/snapshots", {method:"POST"})` with **no body**, then `window.location.reload()`. The server (`src/pages/api/snapshots/index.ts:47-168`) derives everything server-side and ignores the request body entirely. Capturing a contribution therefore requires a new input UI **and** a request-body contract that does not exist today.
- **Per-interval math precedent** (`src/lib/movers.ts`): `contribution(amount, currency, isLiability, displayCurrency, rates)` returns the converted amount with sign flipped for liabilities (`movers.ts:53-62`); `computeMovers` diffs signed contributions between two snapshots **at today's rates** so an FX/display-currency change since the snapshot does not create spurious movement (`movers.ts:64-112`). `EPSILON = 1e-2` is the dead-zone for float dust (`movers.ts:7`).
- **Net-worth chart** (`src/components/NetWorthChart.tsx`): a Recharts `LineChart` reading `total_net_worth` straight off snapshot rows (`:52-61`). The nearest stacked/multi-series template is `src/components/AssetTrendsChart.tsx` — its per-snapshot row construction (`:137-144`, one row per `created_at`, series values keyed onto the row) is exactly what a bar chart consumes.
- **Currency union** (`src/lib/exchange-rates.ts:3`): `Currency = "PLN" | "USD" | "EUR"`. `getRates(supabase)` returns `Record<Currency, number>` (units per USD, USD = 1.0).
- **Edit-endpoint precedent**: `src/pages/api/assets/[id]/index.ts` (PUT) and `src/pages/api/allocation-cards/[id].ts` (PATCH) both scope writes with `.eq("id", id).eq("user_id", user.id)`. No `snapshots/[id]` route exists yet.
- **Dialog precedent**: `src/components/InstallInstructionsModal.tsx` uses the **native `<dialog>` element** + `showModal()`. Only `@radix-ui/react-dropdown-menu` and `@radix-ui/react-slot` are installed — there is **no Radix Dialog**. We will use the native `<dialog>` pattern, not add a library.
- **Generated types** (`src/lib/database.types.ts:277-309`): `snapshots` Row/Insert/Update must each gain the new column.

## Desired End State

A logged-in user with snapshot history sees, under the net-worth line chart, a stacked-bar chart with one bar per snapshot interval. Each bar shows the contribution segment and the growth segment diverging around a zero reference line (a positive-contribution / negative-growth month shows both forces, and the visible net equals the total change). Intervals where no contribution was recorded show a single neutral "unknown split" bar. When the user clicks "Save Snapshot", a dialog asks for the optional signed amount of money added (or withdrawn) since the last snapshot; leaving it blank records an unknown split. The user can also set or correct the contribution on any existing snapshot, which backfills older bars.

**Verification**: `npm run build`, `npm run lint`, and `npx vitest run` all pass; the new `contributions.test.ts` pins the split identity and edge cases; manual testing confirms the dialog, edit path, diverging bars, and unknown-split rendering.

### Key Discoveries:

- Save is a **bodyless POST** (`NetWorthDisplay.tsx:39-58`) — the contribution input and JSON body are net-new.
- Reuse the **signed-contribution + diff-at-today's-rates** convention from `movers.ts:53-112`; do not reinvent FX handling.
- Use the **native `<dialog>`** pattern (`InstallInstructionsModal.tsx`), not a new Radix dependency.
- Mirror the **`(parent_id)` write-scoping PATCH** pattern (`assets/[id]/index.ts`) for the new `snapshots/[id]` route, and pair RLS `USING` with `WITH CHECK` awareness (lessons.md §"RLS USING-only").
- `AssetTrendsChart.tsx:137-144` is the per-snapshot-row construction template for the bar chart.

## What We're NOT Doing

- **No savings-rate / income metric** — the app has no income tracking (change.md scope guard).
- **No per-asset attribution of growth** — the split is portfolio-level (one contribution number per interval), not per holding.
- **No automatic contribution inference** — the schema carries no flow/quantity data, so contributions must be user-entered.
- **No multi-currency contribution breakdown** — a single signed number stored in the snapshot's `display_currency` at entry; cross-currency reconciliation is the documented caveat, not a feature.
- **No backfill migration** — old snapshots keep `net_contribution = NULL` and render as "unknown split" until the user edits them.

## Implementation Approach

Build bottom-up so the riskiest math is provable before any UI exists: schema → pure lib (+ tests) → API write path (+ tests) → save dialog → edit/backfill UI → chart. The pure lib is the heart and is independently unit-tested against oracle values. The API phase establishes the request-body contract (POST gains a body; a new PATCH route handles edits). The two UI phases share one signed-amount input field component. The chart phase consumes `net_contribution` (already present on snapshot rows the dashboard fetches with `.select()`) and the pure lib.

## Critical Implementation Details

- **Sign convention**: `net_contribution > 0` = money added, `< 0` = money withdrawn, `NULL` = not recorded (unknown split). The split identity `growth = totalChange − contribution` holds for all signed values; a withdrawal correctly subtracts from the change so the remainder reads as growth.
- **FX timing**: the stored contribution is in the snapshot's entry-time `display_currency`. The lib converts it to the **current** display currency at **today's rates** (mirroring `movers.ts`), so switching display currency never injects spurious movement. This means a PLN-entered contribution viewed in USD reflects today's FX, not entry-day FX — the documented same-family caveat.
- **Diverging stack**: Recharts stacks positive and negative values from the zero baseline in opposite directions when both share a `stackId`. A `ReferenceLine y={0}` is required for the bar to read correctly. The "total change" is implied by the net of the two segments, not a third series.
- **NULL handling is load-bearing**: the lib must return a discriminated per-interval result (`{ kind: "split", contribution, growth } | { kind: "unknown", totalChange }`) so the chart can branch on it. Never coerce `NULL` to `0` (that silently mislabels contributions as growth — the failure mode change.md warns against).

---

## Phase 1: Schema & Types

### Overview

Add a nullable signed `net_contribution` column to `snapshots` and propagate it to the generated types.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_snapshots_net_contribution.sql`

**Intent**: Add a nullable money column to record the signed contribution captured at (or after) snapshot save. Nullable because existing snapshots and any save where the user leaves the field blank have no value.

**Contract**: `BEGIN; ALTER TABLE snapshots ADD COLUMN net_contribution NUMERIC(18,2); COMMIT;` — nullable (no `NOT NULL`, no default), `NUMERIC(18,2)` to match money columns. Lead with a comment documenting RLS inheritance (existing `snapshots` policy covers the column) and the rollback (`ALTER TABLE snapshots DROP COLUMN net_contribution`). Mirror `20260619120000_assets_show_on_chart.sql` structure.

#### 2. Generated types

**File**: `src/lib/database.types.ts`

**Intent**: Reflect the new column in the `snapshots` type blocks so TS knows it exists.

**Contract**: Add `net_contribution: number | null;` to `Row`, `net_contribution?: number | null;` to `Insert`, and `net_contribution?: number | null;` to `Update` in the `snapshots` block (`:277-309`). Regenerate via `npx astro sync` against local Supabase if available; otherwise hand-edit to match.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase (`supabase db reset` or `supabase migration up`)
- Type checking passes: `npx tsc --noEmit` (or `npm run build`)
- Linting passes: `npm run lint`

#### Manual Verification:

- `net_contribution` column visible on `snapshots` in Supabase Studio, nullable, type `numeric`
- Existing snapshots show `NULL` for the new column

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Pure Split Library + Tests

### Overview

Compute the per-interval contribution-vs-growth split in a pure, deterministic, unit-tested module. No DB, no React.

### Changes Required:

#### 1. The contributions lib

**File**: `src/lib/contributions.ts`

**Intent**: Given an ordered list of snapshots (each carrying `total_net_worth`, `display_currency`, and `net_contribution`), produce one per-interval result that either splits the change into contribution + growth or flags it as an unknown split. Reuse `convertAmount` and convert the stored contribution to the current display currency at today's rates.

**Contract**: Export a discriminated result type and a builder.
- Input snapshot shape (minimal): `{ totalNetWorth: number; displayCurrency: Currency; netContribution: number | null; date: string }`.
- Result per interval: `IntervalSplit = { date: string; totalChange: number } & ({ kind: "split"; contribution: number; growth: number } | { kind: "unknown" })`.
- `buildContributionSplits(snapshots, displayCurrency, rates): IntervalSplit[]` — for each adjacent pair `(prev, curr)`: `totalChange = curr.totalNetWorth − prev.totalNetWorth` (both already in their own display currency; see caveat below). If `curr.netContribution == null` → `{ kind: "unknown" }`. Else `contribution = convertAmount(curr.netContribution, curr.displayCurrency, displayCurrency, rates)`, `growth = totalChange − contribution`, `{ kind: "split", contribution, growth }`. Apply the `EPSILON` dead-zone (import or re-declare `1e-2`) so float dust near zero reads as zero. First snapshot has no predecessor → no interval emitted. Empty / single-snapshot input → `[]`.

*Note on totalChange currency*: `total_net_worth` is stored per-snapshot in that snapshot's display currency. v1 assumes display currency is stable across the compared pair (the existing mixed-currency caveat already surfaced by `NetWorthChart`'s warning banner). Do **not** add cross-snapshot NW re-conversion here — only the contribution is re-converted, matching the movers convention. Document this assumption in a header comment.

#### 2. Unit tests

**File**: `src/lib/contributions.test.ts`

**Intent**: Pin the split identity and every edge case with first-principles oracle values, mirroring `movers.test.ts` structure (factory builder, module-scoped `RATES` fixture, oracle comments, `.toBeCloseTo(_, 6)` for non-round floats).

**Contract**: Cases — positive growth (`contribution + growth = totalChange`); negative growth (markets drop, contribution positive); withdrawal (negative contribution); `net_contribution = null` → `kind: "unknown"`; `net_contribution = 0` → `kind: "split"` with `growth = totalChange` (distinct from null); cross-currency contribution conversion (entry PLN, view USD); EPSILON dead-zone (tiny totalChange/growth → 0); single snapshot → `[]`; empty → `[]`.

### Success Criteria:

#### Automated Verification:

- New tests pass: `npx vitest run src/lib/contributions.test.ts`
- Full suite still green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Spot-check one split by hand against the formula to confirm the oracle, not the implementation, drives the expected values

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: API Write Path (POST body + PATCH endpoint)

### Overview

Establish the request-body contract: the POST handler accepts an optional signed `net_contribution`; a new `snapshots/[id]` PATCH route sets/corrects it on an existing snapshot.

### Changes Required:

#### 1. POST accepts a body

**File**: `src/pages/api/snapshots/index.ts`

**Intent**: Parse an optional JSON body and persist a signed `net_contribution` on the inserted snapshot. The handler currently ignores the body entirely; everything else (auth, NW computation, items) stays as-is.

**Contract**: Parse `request.json()` defensively (the bodyless legacy call must still succeed → treat missing/empty body as `net_contribution: undefined`). Validate: if present, must be a finite number (reject `NaN`/non-numeric with a `400 VALIDATION_ERROR` in the canonical `{ error: { code, message } }` shape). Signed values allowed (no `>= 0` constraint). Add `net_contribution` to the insert payload (`:113-119`) only when provided; omit otherwise so the column stays `NULL`. Keep the existing atomic compensating-delete behavior for items (lessons.md §1).

#### 2. New PATCH route for editing/backfilling

**File**: `src/pages/api/snapshots/[id].ts`

**Intent**: Let the user set or correct `net_contribution` on an existing snapshot (enables backfilling history). Write-scoped to the caller.

**Contract**: `export const PATCH: APIRoute` mirroring `assets/[id]/index.ts` / `allocation-cards/[id].ts`: auth guard → require `params.id` (`400 MISSING_ID` if absent) → parse JSON body for `net_contribution` (finite number, or explicit `null` to clear). `supabase.from("snapshots").update({ net_contribution }).eq("id", id).eq("user_id", user.id).select().single()`. Return `404`/empty handling consistent with the assets route; canonical error shape throughout. The `.eq("user_id", user.id)` filter is the write-scope defense (lessons.md §"RLS USING-only is not enough" — the update payload deliberately never includes `user_id`).

#### 3. Include the column in reads

**File**: `src/pages/api/snapshots/index.ts` (GET select)

**Intent**: Surface `net_contribution` to any client reading via GET.

**Contract**: Add `net_contribution` to the explicit GET `.select(...)` list (`:33`). The dashboard SSR uses `.select()` (all columns) so it already picks it up once the column exists.

#### 4. API tests

**File**: `src/pages/api/snapshots/index.test.ts` (extend) and a new `src/pages/api/snapshots/[id].test.ts`

**Intent**: Pin the new contract: POST with a contribution persists it; POST without a body still succeeds with `NULL`; POST with a non-numeric contribution → `400`; PATCH updates the value scoped to the user; PATCH with `null` clears it.

**Contract**: Reuse the existing MockSupabaseClient harness and the `asClient` cast helper noted in memory (`project_tsc_blocker_phase4`). Cover the signed (negative) case explicitly.

### Success Criteria:

#### Automated Verification:

- API tests pass: `npx vitest run src/pages/api/snapshots`
- Full suite green: `npx vitest run`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- `curl`/devtools: POST with `{ "net_contribution": 500 }` persists `500`; bodyless POST persists `NULL`; PATCH on an existing id updates the value; PATCH from a different user does not affect another user's row

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Save Dialog UI

### Overview

Replace the bodyless one-click save with a dialog that captures the optional signed contribution, then POSTs a JSON body.

### Changes Required:

#### 1. Signed-amount input field (shared component)

**File**: `src/components/assets/ContributionField.tsx` (new)

**Intent**: A small reusable controlled field for the signed contribution amount, with a clear "+ added / − withdrawn" affordance and a "leave blank if unknown" hint. Used by both the save dialog (Phase 4) and the edit UI (Phase 5).

**Contract**: Controlled `value: string` + `onChange`, a numeric input that accepts negatives, a short helper line stating the display currency and that blank = unknown split. No submission logic — parent owns it.

#### 2. Save dialog

**File**: `src/components/assets/NetWorthDisplay.tsx` (modify `SaveButton`, `:36-110`)

**Intent**: On click, open a native `<dialog>` containing the `ContributionField` + Confirm/Cancel. Confirm POSTs `{ net_contribution }` (omit the key when blank) as JSON; preserve the existing idle/loading/saved/error/retry states and the post-success `window.location.reload()`.

**Contract**: Use the native `<dialog>` + `showModal()`/`close()` pattern from `InstallInstructionsModal.tsx` (do **not** add Radix Dialog). The `fetch("/api/snapshots", {method:"POST", credentials:"include"})` call gains `headers: {"Content-Type":"application/json"}` and a `body` when a contribution is entered; a blank field sends no `net_contribution`. Show the current display currency in the dialog (passed as a prop from the dashboard, already available).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes (incl. `react-compiler`): `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Clicking "Save Snapshot" opens the dialog; entering `500` saves a snapshot with `net_contribution = 500`; entering `-200` saves `-200`; leaving blank saves `NULL`; Cancel saves nothing
- Loading/saved/error states still behave; page reloads on success

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 5.

---

## Phase 5: Edit / Backfill UI

### Overview

Let the user set or correct `net_contribution` on an existing snapshot, so older intervals can be backfilled into real splits.

### Changes Required:

#### 1. Edit affordance

**File**: surface on the contributions chart card (Phase 6 component) and/or a snapshot list row — **File**: `src/components/ContributionsChart.tsx` (created in Phase 6) or a small `src/components/assets/EditContributionDialog.tsx` (new)

**Intent**: Provide a per-snapshot "edit contribution" action that opens a dialog pre-filled with the snapshot's current `net_contribution` (or blank), reusing `ContributionField`, and PATCHes `snapshots/[id]`.

**Contract**: Native `<dialog>` + `ContributionField`; on confirm, `fetch(\`/api/snapshots/${id}\`, {method:"PATCH", headers, body: JSON.stringify({ net_contribution })})` (send explicit `null` to clear). On success, reload or refresh the chart data. Reuse the error shape and loading states from the save dialog. Identify which snapshot to edit by `id` from the bar/interval the user clicks.

*Note on interval→snapshot mapping*: an interval is the pair `(prev, curr)`; the contribution belongs to **`curr`** (money added *since* the previous snapshot). The edit action targets `curr.id`. Make this explicit in the UI label ("contribution recorded for <curr date>").

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Editing an old snapshot's contribution turns its "unknown split" bar into a real split after refresh
- Clearing a contribution (set to blank/null) returns the bar to "unknown split"
- The edit targets the correct snapshot (the later one in the interval)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 6.

---

## Phase 6: Stacked-Bar Chart + Dashboard Wiring

### Overview

Render the per-interval split as a diverging stacked-bar chart under the net-worth line chart, with a neutral "unknown split" bar for unrecorded intervals.

### Changes Required:

#### 1. Chart component

**File**: `src/components/ContributionsChart.tsx` (new)

**Intent**: Consume snapshots + the pure lib and render a Recharts `BarChart` with diverging contribution/growth segments around a zero reference line, plus a distinct neutral bar for `kind: "unknown"` intervals. Mirror the container/axis/tooltip styling and the per-snapshot row construction of `AssetTrendsChart.tsx`.

**Contract**: Props `{ snapshots: Tables<"snapshots">[]; displayCurrency: Currency; rates: Record<Currency, number> }`. Build rows via `buildContributionSplits(...)`: each row = one interval keyed by `date`, with `contribution`, `growth`, and a separate `unknownTotal` field (only one of the split fields vs `unknownTotal` is populated per row). Two `<Bar>` with a shared `stackId` for `contribution` + `growth` (diverging — positive and negative stack opposite the zero baseline); a third `<Bar>` (no stack, muted `var(--muted-foreground)`-ish color) for `unknownTotal`. Add `<ReferenceLine y={0} />`. Tooltip shows contribution, growth, and total change (and an explanation line for unknown intervals). Legend distinguishes Contribution / Growth / Unknown split. Reuse `VALID_CURRENCIES` validation and the mixed-currency warning banner pattern from `NetWorthChart.tsx`. Empty/insufficient-history state mirrors `NetWorthChart`'s empty state. Wire the Phase 5 edit affordance per clicked bar.

#### 2. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Render the new chart island directly under `<NetWorthChart>`.

**Contract**: Insert `<ContributionsChart snapshots={...} displayCurrency={displayCurrency} rates={rates} client:load />` after the `<NetWorthChart>` island (after line 190, before `<AssetTrendsChart>`). `snapshots` and `rates` are already loaded in the frontmatter (`:30-36`); `net_contribution` is included via the existing `.select()` all-columns read.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes (incl. `react-compiler`): `npm run lint`
- Build passes: `npm run build`
- Full test suite green: `npx vitest run`

#### Manual Verification:

- A split interval renders contribution + growth diverging around zero; the net visually equals the total change
- A negative-growth interval (drop) renders the growth segment below zero with contribution above
- An interval with no recorded contribution renders the single neutral "unknown split" bar
- Tooltip and legend read correctly; chart sits directly under the net-worth chart and is responsive
- No regression in the net-worth or asset-trends charts

**Implementation Note**: After automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `src/lib/contributions.test.ts` — split identity, negative growth, withdrawal (negative contribution), null → unknown, zero → split-with-growth, cross-currency conversion, EPSILON dead-zone, single/empty input (oracle-driven, mirroring `movers.test.ts`).

### Integration Tests:

- `src/pages/api/snapshots/index.test.ts` (extend) — POST persists contribution; bodyless POST → NULL; non-numeric → 400.
- `src/pages/api/snapshots/[id].test.ts` (new) — PATCH updates scoped to user; PATCH null clears; signed values.

### Manual Testing Steps:

1. Save a snapshot with `+500` contribution → bar shows contribution above zero, growth as remainder.
2. Save with `-200` (withdrawal) → contribution segment negative, growth = totalChange + 200.
3. Save with blank → "unknown split" neutral bar.
4. Edit an old snapshot to add a contribution → its bar converts to a real split after refresh.
5. Clear a contribution → bar returns to "unknown split".
6. Force a market-drop interval (lower NW with no contribution recorded vs one with) → confirm negative growth renders below the zero line.
7. Switch display currency in settings → confirm contributions re-convert without spurious movement and the mixed-currency banner appears if snapshots differ.

## Performance Considerations

The split is O(n) over snapshots (a single adjacent-pair pass), computed client-side from already-fetched rows — negligible. No new network round-trips beyond the existing snapshot fetch; the chart reuses the SSR-loaded `snapshots` + `rates`.

## Migration Notes

The migration is purely additive and nullable — no backfill, no data transformation, zero downtime. Rollback is `ALTER TABLE snapshots DROP COLUMN net_contribution`. Existing snapshots render as "unknown split" until edited.

## References

- Change identity: `context/changes/contributions-vs-growth/change.md`
- Roadmap slice S-17: `context/foundation/roadmap.md` (Stream H)
- Per-interval/FX precedent: `src/lib/movers.ts:53-112`
- Migration pattern: `supabase/migrations/20260619120000_assets_show_on_chart.sql`, `20260611120000_user_preferences_fire.sql`
- Chart template: `src/components/AssetTrendsChart.tsx:137-144`
- Dialog pattern: `src/components/InstallInstructionsModal.tsx`
- PATCH/write-scope pattern: `src/pages/api/assets/[id]/index.ts`
- Lessons: atomic multi-table writes (§1), RLS USING+WITH CHECK, currency cast boundary, `vite-tsconfig-paths` for `@/*` alias

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & Types

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — efad988
- [x] 1.2 Type checking passes (`npx tsc --noEmit` / `npm run build`) — efad988
- [x] 1.3 Linting passes (`npm run lint`) — efad988

#### Manual

- [x] 1.4 `net_contribution` column visible, nullable, type `numeric` in Supabase Studio (verified: psql information_schema → `numeric(18,2)`, is_nullable=YES) — efad988
- [x] 1.5 Existing snapshots show `NULL` for the new column (verified: psql → 5 snapshots, 0 non-null net_contribution) — efad988

### Phase 2: Pure Split Library + Tests

#### Automated

- [x] 2.1 New tests pass (`npx vitest run src/lib/contributions.test.ts`) — 127bda4
- [x] 2.2 Full suite still green (`npx vitest run`) — 127bda4
- [x] 2.3 Type checking passes (`npx tsc --noEmit`) — 127bda4
- [x] 2.4 Linting passes (`npm run lint`) — 127bda4

#### Manual

- [x] 2.5 Hand-checked one split against the formula (oracle, not implementation) (verified: PLN→USD cross-currency case — 1000 PLN ÷ 3.85 = 259.7402597 USD, growth = 1000 − 259.7402597 = 740.2597403; identity holds independent of impl) — 127bda4

### Phase 3: API Write Path

#### Automated

- [x] 3.1 API tests pass (`npx vitest run src/pages/api/snapshots`) — 48422a3
- [x] 3.2 Full suite green (`npx vitest run`) — 48422a3
- [x] 3.3 Type checking passes (`npx tsc --noEmit`) — 48422a3
- [x] 3.4 Linting passes (`npm run lint`) — 48422a3

#### Manual

- [x] 3.5 POST with contribution persists it; bodyless POST → NULL; non-numeric → 400; PATCH updates user-scoped; cross-user PATCH no-op (verified: real HTTP round-trip vs local Supabase — POST{500}→persisted 500; bodyless→null; "lots"→400 VALIDATION_ERROR; A PATCH own row→−200/null/999 all 200; user B PATCH on A's row left it at 999.00 unchanged. Note: cross-user/not-found PATCH returns 500 UPDATE_FAILED, not 404 — but this matches the assets-route precedent the plan mirrors, since real PostgREST `.single()` errors on 0 rows; the row-isolation security property holds either way) — 48422a3

### Phase 4: Save Dialog UI

#### Automated

- [x] 4.1 Type checking passes (`npx tsc --noEmit`) — 35c1581
- [x] 4.2 Linting passes incl. `react-compiler` (`npm run lint`) — 35c1581
- [x] 4.3 Build passes (`npm run build`) — 35c1581

#### Manual

- [x] 4.4 Dialog captures `+`, `−`, and blank contributions correctly; states + reload intact (verified: Playwright drove the live dialog vs local Supabase — +500→persisted 500, −200→persisted −200, blank→NULL, Cancel→no snapshot, all with 201 + reload to /dashboard. Also fixed a regression the dialog introduced in e2e/empty-snapshot.spec.ts which expected an immediate POST on click) — 35c1581

### Phase 5: Edit / Backfill UI

#### Automated

- [x] 5.1 Type checking passes (`npx tsc --noEmit`)
- [x] 5.2 Linting passes (`npm run lint`)
- [x] 5.3 Build passes (`npm run build`)

#### Manual

- [ ] 5.4 Editing an old snapshot converts "unknown split" → real split; clearing reverts; correct snapshot targeted

### Phase 6: Stacked-Bar Chart + Dashboard Wiring

#### Automated

- [ ] 6.1 Type checking passes (`npx tsc --noEmit`)
- [ ] 6.2 Linting passes incl. `react-compiler` (`npm run lint`)
- [ ] 6.3 Build passes (`npm run build`)
- [ ] 6.4 Full test suite green (`npx vitest run`)

#### Manual

- [ ] 6.5 Split, negative-growth, and unknown-split intervals all render correctly; tooltip/legend correct; no chart regressions
