# Per-Asset Trend Charts Implementation Plan

## Overview

Add a **per-asset opt-in flag** (`assets.show_on_chart`) and a read-only **Asset Trends** chart on the dashboard. The flag is set on the add/edit asset form and threaded through the standard 5-layer column path (migration → generated types → form → POST/PUT handlers → tests). The chart is a new Recharts island below the Net Worth chart, fed by a pure, unit-tested series builder (`src/lib/asset-trends.ts`) that reuses `movers.ts`'s `(name, category_id)` identity and signed `contribution()` logic over **all** snapshot history. A header-row master toggle (ephemeral, default OFF) reveals only the opted-in assets, with an absolute⇄% (indexed) sub-toggle that defaults to **indexed** so mismatched asset sizes stay legible.

## Current State Analysis

- **No per-asset chart flag exists.** `assets` has Row/Insert/Update shapes at `database.types.ts:50-99` with no boolean flag. The only prior `assets` alter is the nullable `quantity` column; the canonical `NOT NULL DEFAULT` migration shape to copy is `supabase/migrations/20260611120000_user_preferences_fire.sql:23,27`.
- **Dashboard loads only the latest snapshot's items.** `dashboard.astro:38-40` loads `snapshot_items` for `latestSnapshot.id` only (baseline for Top Movers). Per-asset trends need items for **every** snapshot — a new query.
- **Cross-snapshot identity is `(name, category_id)`, by design.** `snapshot_items` has no `asset_id` (`database.types.ts:145-201`); `movers.ts` already matches on this pair. `is_liability` and `icon` live on the **category** (`database.types.ts:27,29`), reachable via the `category:asset_categories(*)` join.
- **Reusable pure logic exists.** `movers.ts:47-50` (`key`), `:53-62` (`contribution` — converts then negates for liabilities), `:7` (`EPSILON = 1e-2`). `net-worth.ts:18-27` (`convertAmount`). `exchange-rates.ts` (`Currency` union, `getRates`). Both `movers.ts` and the snapshot write path convert at **today's** rates so a display-currency switch never fabricates movement — the new builder must follow suit (recompute from `original_amount`/`original_currency`, not the frozen `converted_amount`).
- **Recharts recipe is established.** `NetWorthChart.tsx:102-152` is the card+chart pattern to copy (ResponsiveContainer with `initialDimension` for island hydration, themed CSS-var strokes, custom Tooltip, empty-state early return). `global.css:28-32,62-66` define exactly **5** chart vars (`--chart-1..5`).
- **No Switch/Checkbox primitive, no Zod, no `<Legend>` anywhere.** Validation is hand-rolled at the handler boundary. Native checkbox styled `accent-purple-600` (SettingsForm precedent). `<Legend>` is net-new.

## Desired End State

- The add/edit asset form has a **"Show on chart"** checkbox; its value persists to `assets.show_on_chart` (default `false`) on both create and edit, including toggling it back off.
- The dashboard shows an **Asset Trends** card below the Net Worth chart. It is hidden by default each visit. A master toggle in its header reveals lines for **only** the assets with `show_on_chart = true`.
- When shown, the chart defaults to **indexed (%)** mode (each line rebased to 100 at its own first present snapshot) with an absolute⇄% sub-toggle. Lines are color-distinct via a generated palette, with a legend keyed on `asset.id`.
- Edge cases render honestly: missing-mid-series → broken line (null hole); zero/near-zero baseline → no indexed line (null); liabilities → signed in absolute mode, indexed against `Math.abs(baseline)` in % mode.
- Empty / single-snapshot / no-opted-in-asset states render a friendly placeholder, never a crash.

**Verification**: `npm run build`, `npm run lint`, and the Vitest suite pass; manually, toggling the flag on an asset and the master toggle on the dashboard draws the expected lines and mode switches correctly.

### Key Discoveries:

- Native unchecked checkboxes are **absent** from `FormData` — must mirror controlled state into a hidden input so PUT can detect "unchecked" (AssetForm already does this for crypto currency at `AssetForm.tsx:307`).
- `npx astro sync` does **not** regenerate Supabase types (CLAUDE.md is misleading); the real command is `npx supabase gen types typescript --local > src/lib/database.types.ts`, but for one column the established norm is hand-editing the 3 shapes.
- `snapshot_items` has no `user_id` — the all-snapshots query must scope by `user_id` on the **parent** `snapshots` (the nested select does this naturally).
- The assets RLS policy is row-scoped with `WITH CHECK` already (`20260602235644_rls_with_check.sql:17-21`) — no policy change needed for the new column.

## What We're NOT Doing

- **Not persisting the master toggle.** It is ephemeral/client-only, default OFF each visit. No `user_preferences` column this slice (deferred follow-up — research Area 4).
- **Not overlaying asset lines on the Net Worth chart.** Separate card with its own auto-scaling Y-axis (locked decision).
- **Not stitching renames/category-moves.** A change in `(name, category_id)` is a discontinuity (old line ends, new begins) — documented limitation, same as S-11.
- **Not adding `asset_id` to snapshots** or otherwise changing the snapshot write path.
- **No carry-forward or interpolation** across gaps — missing snapshots are honest holes.
- **No soft cap / "too many lines" affordance** — the generated palette makes any count of lines color-distinct.

## Implementation Approach

Three independent phases along the natural seams (mirrors the S-11 pattern: ship the column thread, then a pure tested module, then wire the UI):

1. Thread `show_on_chart` end-to-end so the opt-in is settable and persisted before any chart consumes it.
2. Build the pure series builder + palette helper with full unit coverage of the locked edge-case rules. No UI, no DB.
3. Build the chart island and wire the new all-snapshots query into `dashboard.astro`.

## Critical Implementation Details

- **Convert-at-today's-rates invariant.** The builder must recompute every point from `original_amount`/`original_currency` via `convertAmount` at one shared `rates` table — never read the frozen `converted_amount`. Otherwise a display-currency switch fabricates movement (the exact bug `movers.ts:64-74` guards against).
- **Indexed baseline is per-line, not global.** Each line rebases to 100 at **its own** first present snapshot, so a late-appearing asset still starts at 100. Zero/near-zero baseline (`Math.abs(first) < EPSILON`) → `indexed = null` (no line, mirrors `movers.ts` `pct === null`).
- **Liability sign in indexed mode.** `contribution()` returns a negative value for liabilities. Absolute mode plots that signed value. Indexed mode rebases against `Math.abs(baseline)` so a shrinking debt reads as growth in the natural direction; the tooltip/legend must surface the sign so a liability and an asset at the same % aren't misread.
- **Gap = null hole.** Emit `null` for snapshots where the asset is absent and render `<Line connectNulls={false} …>` so Recharts breaks the line rather than bridging it.

## Phase 1: Per-asset `show_on_chart` flag (schema → form → API)

### Overview

Thread one boolean column end-to-end so the opt-in is settable on create/edit and persisted (including toggle-off). Ships independently of the chart.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260619120000_assets_show_on_chart.sql` (new)

**Intent**: Add the opt-in column with a safe default so existing rows are valid and the dashboard default (hidden) is the column default.

**Contract**: `BEGIN; ALTER TABLE assets ADD COLUMN show_on_chart BOOLEAN NOT NULL DEFAULT FALSE; COMMIT;` — filename `YYYYMMDDHHMMSS_snake_name.sql`, wrapped in `BEGIN; … COMMIT;`. No RLS change (row-scoped policy already has `WITH CHECK`).

#### 2. Generated types

**File**: `src/lib/database.types.ts`

**Intent**: Hand-edit the three `assets` shapes so the column is type-visible.

**Contract**: Row (`:51-63`) → `show_on_chart: boolean;`. Insert (`:64-76`) → `show_on_chart?: boolean;`. Update (`:77-89`) → `show_on_chart?: boolean;`.

#### 3. Asset form checkbox

**File**: `src/components/assets/AssetForm.tsx`

**Intent**: Add a "Show on chart" checkbox near the notes block, mirrored into a hidden input so the unchecked state reaches the PUT handler.

**Contract**: New `useState` seeded from `asset?.show_on_chart ?? false` (~`:33`). Native `<input type="checkbox" className="… accent-purple-600">` controlling that state, plus `<input type="hidden" name="show_on_chart" value={showOnChart ? "true" : "false"} />` (the hidden mirror is the load-bearing part — see the FormData gotcha). Insert near `AssetForm.tsx:312-327`.

#### 4. POST handler parse

**File**: `src/pages/api/assets/index.ts`

**Intent**: Read the mirrored field and include it in the insert payload.

**Contract**: After `:91`, `const show_on_chart = form.get("show_on_chart");`. In `.insert({…})` (`:119-128`) add `show_on_chart: show_on_chart === "true",`.

#### 5. PUT handler parse

**File**: `src/pages/api/assets/[id]/index.ts`

**Intent**: Read the mirrored field and include it in the conditional `updates` builder so toggle-off is captured.

**Contract**: After `:53` read `show_on_chart`; after `:76` add `if (show_on_chart !== null) updates.show_on_chart = show_on_chart === "true";` (the hidden mirror makes it always present on submit).

#### 6. Handler tests

**File**: `src/pages/api/assets/index.test.ts`, `src/pages/api/assets/[id]/index.test.ts`

**Intent**: Cover the new field; existing assertions (`user_id` only) remain green.

**Contract**: POST with `show_on_chart="true"` → asserted `payload.show_on_chart === true`. PUT with `"false"` → asserted `updates.show_on_chart === false`. Use `createSupabaseMock` / `findCall` from `src/test-utils/supabase-mock.ts`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase
- Type checking passes: `npm run build` (Astro check)
- Linting passes: `npm run lint`
- Unit tests pass: `npx vitest run src/pages/api/assets`

#### Manual Verification:

- Creating an asset with "Show on chart" checked persists `show_on_chart = true`
- Editing an asset to uncheck the box persists `show_on_chart = false` (not omitted)
- Existing assets default to unchecked / `false`

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Pure series builder + color palette helper

### Overview

Build the pure, unit-tested `buildAssetTrends` series math and a deterministic theme-aware color helper. No DB, no UI.

### Changes Required:

#### 1. Series builder

**File**: `src/lib/asset-trends.ts` (new)

**Intent**: Group all-snapshot items by `(name, category_id)`, compute each chronological point via `contribution()`, and attach an indexed value per the locked rules.

**Contract**: Exports `buildAssetTrends(items, displayCurrency, rates): AssetTrendSeries[]`. Reuse `key`, `contribution`, `EPSILON` from `movers.ts` and `convertAmount`/`Currency` from `net-worth.ts`. Types:

```ts
interface TrendItem {
  snapshotId: string;
  snapshotDate: string;        // parent snapshots.created_at (ISO) — the X value
  name: string;
  category_id: string;
  original_amount: number;
  original_currency: string;   // cast `as Currency` only at the convertAmount boundary
  is_liability: boolean;       // from category.is_liability
  icon: string | null;         // from category.icon
}
interface TrendPoint { date: string; value: number; indexed: number | null; }
interface AssetTrendSeries {
  name: string; category_id: string; icon: string | null; is_liability: boolean;
  points: TrendPoint[];        // chronological
}
```

Rules: `value` = `contribution(original_amount, original_currency as Currency, is_liability, displayCurrency, rates)` (signed). Points sorted ascending by `snapshotDate`. `indexed = Math.abs(firstValue) < EPSILON ? null : (value / Math.abs(firstValue)) * 100` where `firstValue` is the line's own first present point (abs baseline handles the liability sign). Missing snapshots produce **no point** for that line (the island maps absence → `null` when shaping Recharts rows).

#### 2. Color palette helper

**File**: `src/lib/asset-trends.ts` (same module) or `src/lib/chart-colors.ts` (new)

**Intent**: Deterministically map an asset index to a distinct, theme-legible color so any number of lines is distinguishable (chosen over cycling the 5 CSS vars).

**Contract**: `assetColor(index: number, total: number): string` returning an HSL string with evenly-spaced hues (`hue = (index / total) * 360`) at fixed saturation/lightness chosen to read on both light and dark backgrounds (e.g. `hsl(h, 65%, 50%)`). Deterministic and pure — same index/total → same color.

#### 3. Builder + helper unit tests

**File**: `src/lib/asset-trends.test.ts` (new)

**Intent**: Pin every locked edge-case rule.

**Contract**: Cases — multi-asset grouping by `(name, category_id)`; late-appearing asset rebases to 100 at its own first point; mid-series gap leaves a missing point (→ null hole downstream); zero/near-zero baseline → `indexed === null`; liability value negative in absolute, indexed against `abs(baseline)`; display-currency switch does not fabricate movement (convert-at-today's-rates); `assetColor` determinism + distinct hues for distinct indices.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/lib/asset-trends.test.ts`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- (None — pure module; correctness is fully covered by unit tests.)

**Implementation Note**: After automated verification passes, proceed to Phase 3.

---

## Phase 3: Asset Trends chart island + dashboard wiring

### Overview

Build the `AssetTrendsChart` island (Recharts recipe from `NetWorthChart`), header-row master + mode toggles, legend, and edge-state placeholders; add the all-snapshots query to `dashboard.astro` and mount the island after `NetWorthChart`.

### Changes Required:

#### 1. Chart island

**File**: `src/components/AssetTrendsChart.tsx` (new)

**Intent**: Render opted-in asset lines from the pure builder, with master visibility and absolute⇄% mode controls in the card header, defaulting to indexed when shown.

**Contract**: Props:

```ts
interface AssetTrendsChartProps {
  assets: AssetWithCategory[];          // current assets → opted-in line set (show_on_chart) + display names + asset.id
  snapshots: SnapshotRow[];             // ascending by created_at
  snapshotItems: SnapshotItemRow[];     // for EVERY snapshot; carries parent date + category join
  displayCurrency: Currency;
  rates: Record<Currency, number>;
  defaultVisible?: boolean;             // default false
}
// local state: visible: boolean (init defaultVisible); mode: "percent" | "absolute" (init "percent")
```

Behavior: filter to assets with `show_on_chart`; call `buildAssetTrends`; shape Recharts rows keyed by `snapshots.created_at`, mapping absent points to `null`. One `<Line connectNulls={false} dataKey={asset.id} name={asset.name} stroke={assetColor(i, n)} dot={false} strokeWidth={2} />` per opted-in asset (selecting `value` or `indexed` per mode). Add `<Legend />` keyed on `asset.id`. Card+chart recipe copied from `NetWorthChart.tsx:102-152` (`ResponsiveContainer initialDimension`, themed grid/axes, custom Tooltip surfacing sign + mode). Master toggle = a `<button type="button">` with `aria-label` (PasswordToggle pattern); mode sub-toggle = radio-cards (SettingsForm `:100-124`), both in the header row next to the title. Empty/single-snapshot/no-opted-in states → friendly placeholder (mirror `NetWorthChart.tsx:82-96`), never crash.

#### 2. All-snapshots items query + island mount

**File**: `src/pages/dashboard.astro`

**Intent**: Load every snapshot's items (with category join) and mount the island after `NetWorthChart`.

**Contract**: New nested query: `from("snapshots").select("id, created_at, display_currency, snapshot_items(*, category:asset_categories(*))").eq("user_id", user.id).order("created_at", { ascending: true })` (one round trip; scopes by parent `user_id`; attaches each item to its parent `created_at`). Flatten into a `snapshotItems` array carrying `snapshotDate` (parent `created_at`). Mount `<AssetTrendsChart … client:load />` after the `<NetWorthChart>` close (`:78`), inside the existing `{ assets && (...) }` block, passing `assets`, `snapshots`, the flattened `snapshotItems`, `displayCurrency`, `rates`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- Asset Trends card is hidden by default on dashboard load; master toggle reveals it
- Only opted-in assets appear as lines; each is color-distinct with a correct legend label
- Indexed mode is the default when shown; switching to absolute re-scales correctly
- A liability line reads in the natural direction (debt paydown = upward) in indexed mode
- A deleted-then-re-added asset shows a broken line, not a bridged one
- Empty / single-snapshot / no-opted-in-asset states show a placeholder, not a crash
- No regression to Net Worth chart or Top Movers

**Implementation Note**: Final phase — confirm all manual checks before closing the change.

---

## Testing Strategy

### Unit Tests:

- `buildAssetTrends`: grouping, per-line indexed baseline, late-appearing assets, mid-series gaps, zero baseline → null, liability sign + abs indexing, convert-at-today's-rates invariance.
- `assetColor`: determinism and distinct hues.
- Asset POST/PUT handlers: `show_on_chart` round-trips true/false.

### Integration Tests:

- None added beyond handler tests; the chart is a presentational island fed by server props (no API surface).

### Manual Testing Steps:

1. Edit an asset, check "Show on chart", save → reload dashboard, toggle master on → line appears.
2. Toggle absolute⇄%; confirm small assets stay legible in % mode.
3. Edit a liability category asset to opt in → confirm direction reads naturally in % mode.
4. Delete an asset from a mid-history snapshot scenario (or use seeded data) → confirm broken line.
5. Visit dashboard with no opted-in assets / one snapshot → confirm placeholder.

## Performance Considerations

The all-snapshots `snapshot_items` query is one nested round trip; volume is bounded by a single user's snapshot history. The builder is O(items) and runs server-side once per dashboard load. Acceptable at expected scale; revisit only if a user accumulates very large snapshot history.

## Migration Notes

Single additive column with `NOT NULL DEFAULT FALSE` — existing rows are valid immediately and default to hidden. No backfill. Rollback is a `DROP COLUMN`.

## References

- Related research: `context/changes/per-asset-trends/research.md`
- Reuse: `src/lib/movers.ts:7,47-50,53-62`, `src/lib/net-worth.ts:18-27`, `src/lib/exchange-rates.ts`
- Recharts recipe: `src/components/NetWorthChart.tsx:102-152`
- Migration shape: `supabase/migrations/20260611120000_user_preferences_fire.sql:23,27`
- Form hidden-input precedent: `src/components/assets/AssetForm.tsx:307`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Per-asset `show_on_chart` flag

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase
- [x] 1.2 Type checking passes (`npm run build`)
- [x] 1.3 Linting passes (`npm run lint`)
- [x] 1.4 Unit tests pass (`npx vitest run src/pages/api/assets`)

#### Manual

- [x] 1.5 Creating an asset with "Show on chart" checked persists `show_on_chart = true`
- [x] 1.6 Editing an asset to uncheck the box persists `show_on_chart = false`
- [x] 1.7 Existing assets default to unchecked / `false`

### Phase 2: Pure series builder + color palette helper

#### Automated

- [ ] 2.1 Unit tests pass (`npx vitest run src/lib/asset-trends.test.ts`)
- [ ] 2.2 Type checking passes (`npm run build`)
- [ ] 2.3 Linting passes (`npm run lint`)

### Phase 3: Asset Trends chart island + dashboard wiring

#### Automated

- [ ] 3.1 Type checking passes (`npm run build`)
- [ ] 3.2 Linting passes (`npm run lint`)
- [ ] 3.3 Full unit suite passes (`npx vitest run`)

#### Manual

- [ ] 3.4 Asset Trends card hidden by default; master toggle reveals it
- [ ] 3.5 Only opted-in assets appear; each color-distinct with correct legend label
- [ ] 3.6 Indexed mode default; switching to absolute re-scales correctly
- [ ] 3.7 Liability line reads in natural direction in indexed mode
- [ ] 3.8 Deleted-then-re-added asset shows a broken line, not bridged
- [ ] 3.9 Empty / single-snapshot / no-opted-in-asset states show placeholder, not crash
- [ ] 3.10 No regression to Net Worth chart or Top Movers
