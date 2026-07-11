# Dashboard Top Movers Implementation Plan

## Overview

Replace the static "Your assets will appear here" placeholder on the dashboard with a **Top Movers** panel: which assets rose and fell the most since the user's last saved snapshot, shown as top gainers and top losers (amount + percentage), plus a small "new since snapshot" note. When there is no snapshot yet to compare against, a friendly placeholder prompts the user to save one.

The risky part — diffing current assets against a snapshot whose items carry no stable `asset_id` — is isolated into a pure, unit-tested `src/lib/movers.ts`. The dashboard loads the latest snapshot's `snapshot_items` server-side and hands them to a new `TopMovers` React island that replaces the placeholder.

## Current State Analysis

- **Placeholder to replace:** `src/pages/dashboard.astro:72-84` — a static card with a "Manage assets" link. Sits after `NetWorthDisplay`, `AssetsSummary`, and `NetWorthChart`.
- **`snapshot_items` is written but never read.** Schema (`src/lib/database.types.ts:145-201`): each row has `name`, `category_id`, `original_amount`, `original_currency`, `converted_amount` (frozen in the snapshot's `display_currency`), `exchange_rate_usd`, `display_order`, `snapshot_id`. There is **no `asset_id`** and **no `is_liability`** column — liability-ness must be resolved via the `snapshot_items_category_id_fkey` → `asset_categories` join.
- **Snapshot write shape** (`src/pages/api/snapshots/index.ts:139-151`) confirms what's stored per item, including `original_amount`/`original_currency` — which is what lets us re-convert the baseline at today's rates.
- **Current asset load** (`dashboard.astro:22`): `assets` with `category:asset_categories(*)` embedded → each asset exposes `category.is_liability`, `amount`, `currency`, `name`, `category_id`.
- **Snapshots already loaded ascending** (`dashboard.astro:26-30`); the latest is the last element.
- **Reusable building blocks:**
  - `convertAmount(amount, from, to, rates)` — `src/lib/net-worth.ts:18-27`.
  - `DeltaIndicator` sign/colour/format pattern — `src/components/assets/NetWorthDisplay.tsx:19-34` (`+$X (+Y%)`, green/red, `toLocaleString` with 2 fraction digits).
  - `categoryEmoji(iconName)` — `src/lib/category-icons.ts` (per-row glyph).
  - `AssetsSummary` (`src/components/assets/AssetsSummary.tsx`) — structural template for a presentational island: `client:load`, `Props { assets, displayCurrency, rates }`, returns `null` when empty.
- **Server rates** come from `getRates(supabase)` (`dashboard.astro:24`) — today's rates. Passing this single `rates` object to both sides of the diff keeps current and baseline on identical rates.

### Key Discoveries:

- **`snapshot_items` carries `original_amount` + `original_currency`** — this is the key that makes the "re-convert baseline at today's rates" decision implementable; we are not stuck with the frozen `converted_amount`.
- **No `is_liability` on `snapshot_items`** — baseline items must be loaded with a `category:asset_categories(*)` join, exactly like the assets query.
- **Currency-cast boundary lesson** (`context/foundation/lessons.md` "Currency cast boundary"): `Tables<'assets'>['currency']` and `snapshot_items.original_currency` are typed `string`; cast `as Currency` at the call site, never widen `convertAmount`.
- **Read-only feature** — the atomic-write and RLS-`WITH CHECK` lessons do not apply (no writes); the relevant lesson is keeping fragile logic in a pure, tested module.

## Desired End State

On `/dashboard`, in the slot currently occupied by the placeholder:

- **With a comparable snapshot:** a "Top Movers" panel showing up to 3 top gainers and up to 3 top losers side by side, each row with the category emoji, asset name, signed amount change (in the display currency), and signed percentage — ranked by absolute net-worth-contribution change. A small "New since snapshot" line lists assets added since the last snapshot. The "Manage assets" link is gone.
- **No snapshot (or the latest snapshot has no items):** a friendly placeholder prompting the user to save a snapshot.
- **No movers but new assets exist:** the "New since snapshot" note renders; the ranked lists show a quiet "no changes since your last snapshot" message.

Verification: `npm run lint`, `npm run build`, and `npx vitest run` all pass; `src/lib/movers.test.ts` covers the matching and edge cases; manual check on the dashboard across the snapshot / no-snapshot / new-asset / currency-changed states.

## What We're NOT Doing

- **No new API endpoint** — the latest snapshot's items are loaded server-side in `dashboard.astro` (consistent with the existing snapshots load). No `GET /api/movers`.
- **No schema change** — no `asset_id` column, no unique constraint, no migration. Matching stays on `(name, category_id)`.
- **No per-asset trend chart** — that is S-12 (`per-asset-trends`); this slice is the single-snapshot diff only.
- **No removed-asset surfacing** — snapshot items with no current match are simply absent (not shown as "sold/removed").
- **No client-side rates fetch inside the island** — the server `rates` prop is the single source for both sides of the diff (no sessionStorage round-trip).
- **No change to the snapshot write path** (`api/snapshots`) — purely a read consumer.

## Implementation Approach

Two phases, logic-first:

1. Build and unit-test `src/lib/movers.ts` in isolation — a pure function over plain inputs (current assets, baseline items, display currency, rates) returning `{ gainers, losers, newAssets }`. This de-risks the `(name, category_id)` matching and the signed-contribution / near-zero-% math before any rendering exists.
2. Wire it in: add the latest-snapshot `snapshot_items` query to `dashboard.astro`, build the `TopMovers` island modelled on `AssetsSummary`, and replace the placeholder `<div>`.

**Core diff model** (decisions from planning):

- **Contribution (signed, net-worth framing):** each item's value = `convertAmount(amount, currency, displayCurrency, rates)`, negated when its category `is_liability`. A shrinking debt therefore reads as a gainer.
- **Baseline re-converted at today's rates:** baseline contribution uses the snapshot item's `original_amount` + `original_currency` converted at the **same** `rates` as the current side. Both sides share one currency and one rate set, so the per-asset change isolates real holding changes and is robust to a display-currency switch since the snapshot.
- **Matching:** key = `(name, category_id)`. Current asset with a baseline match → a mover (`change = currentContribution − baselineContribution`). Current asset with no match → `newAssets`. Baseline item with no current match → absent.
- **Percentage:** `pct = change / |baselineContribution| * 100`, but **suppressed (`null` → rendered "—")** when `|baselineContribution|` is below a small epsilon (zero / near-zero baseline). The amount change still ranks and renders.
- **Ranking:** by `|change|` descending; gainers (`change > 0`) and losers (`change < 0`) split into two lists, top 3 each. A `change` of ~0 (below epsilon) is neither.

## Critical Implementation Details

- **Currency cast boundary:** `asset.currency` and `item.original_currency` are typed `string`. Cast `as Currency` at the call site into `convertAmount`; do not widen the helper (see lessons.md "Currency cast boundary").
- **Epsilon, not `=== 0`:** both the "near-zero baseline → suppress %" guard and the "no change → exclude from gainers/losers" guard must use a small epsilon (e.g. `1e-2`, i.e. under one minor unit) rather than exact float equality, because converted amounts are floats.
- **Latest snapshot selection:** the `snapshots` array is loaded `ascending`, so the latest is `snapshots[snapshots.length - 1]`. Guard for an empty array before indexing.

## Phase 1: Pure movers module + unit tests

### Overview

Create `src/lib/movers.ts` and its test file. No UI, no Astro, no Supabase — pure functions over plain typed inputs.

### Changes Required:

#### 1. Movers computation module

**File**: `src/lib/movers.ts`

**Intent**: Compute top gainers, top losers, and new assets by diffing current assets against the latest snapshot's items, using signed net-worth contributions with both sides converted at today's rates. Isolates the fragile `(name, category_id)` matching into one tested place.

**Contract**: Export the input/output types and a pure function. Suggested shape:

```ts
import { convertAmount, type Currency } from "./net-worth";

export interface MoverAsset {        // current-side input (subset of assets row + category)
  name: string;
  category_id: string;
  amount: number;
  currency: string;                  // cast `as Currency` internally
  is_liability: boolean;
  icon: string | null;               // category.icon, for the row emoji
}
export interface MoverBaselineItem {  // snapshot_items row + joined category
  name: string;
  category_id: string;
  original_amount: number;
  original_currency: string;         // cast `as Currency` internally
  is_liability: boolean;
}
export interface Mover {
  name: string;
  icon: string | null;
  change: number;                    // signed contribution delta, in displayCurrency
  pct: number | null;                // null when baseline ~0 (suppressed)
}
export interface NewAsset { name: string; icon: string | null; value: number; } // signed contribution
export interface MoversResult { gainers: Mover[]; losers: Mover[]; newAssets: NewAsset[]; }

export function computeMovers(
  current: MoverAsset[],
  baseline: MoverBaselineItem[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
  limit?: number,                    // default 3
): MoversResult;
```

Internals: build a `Map` of baseline by `\`${name} ${category_id}\`` → signed baseline contribution; iterate current assets computing signed current contribution; matched → push to a movers array with `change`/`pct` (epsilon-guarded); unmatched → `newAssets`. Sort movers by `|change|` desc, partition by sign with an epsilon dead-zone, slice each to `limit`. `EPSILON = 1e-2`.

#### 2. Unit tests (table-driven)

**File**: `src/lib/movers.test.ts`

**Intent**: Pin the matching and every edge case before any UI consumes the function. Mirror the `net-worth.test.ts` / `fire.test.ts` style.

**Contract**: Cover, at minimum — (a) a plain gainer and a plain loser ranked by absolute amount; (b) a liability that *shrank* surfaces as a gainer (sign handling); (c) a liability that *grew* surfaces as a loser; (d) `(name, category_id)` match succeeds across a currency change (baseline `original_currency` ≠ current `currency`, both re-converted) and yields the correct holding delta with no spurious rate noise; (e) a current asset with no baseline match lands in `newAssets`, never in gainers/losers; (f) a baseline item with no current match is absent from all three lists; (g) near-zero baseline → `pct === null` but the row still ranks/renders by amount; (h) an unchanged asset (`|change| < EPSILON`) appears in neither gainers nor losers; (i) `limit` caps each list to 3 and ranks the right 3 by `|change|`; (j) empty `current` and empty `baseline` both return empty lists without throwing.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or `npx astro check` if faster)
- Lint passes: `npm run lint`
- Unit tests pass: `npx vitest run src/lib/movers.test.ts`

#### Manual Verification:

- Spot-check one table case by hand (e.g. the currency-change case) to confirm the expected numbers match intuition.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Dashboard wiring + TopMovers island

### Overview

Load the latest snapshot's items server-side, build the `TopMovers` island, and replace the placeholder.

### Changes Required:

#### 1. Latest-snapshot items query

**File**: `src/pages/dashboard.astro`

**Intent**: After the existing snapshots load, fetch the most recent snapshot's `snapshot_items` (with category join for `is_liability` + `icon`) so the island has a baseline. Skip the query when there are no snapshots.

**Contract**: Derive `latestSnapshot = snapshots?.[snapshots.length - 1]`. If present, query `snapshot_items` filtered by `snapshot_id = latestSnapshot.id` with `select("*, category:asset_categories(*)")`. Shape baseline + current into the `MoverAsset[]` / `MoverBaselineItem[]` inputs (or pass raw rows and let the island map — keep mapping in one place). Pass `displayCurrency` and `rates` (already in scope).

#### 2. TopMovers island

**File**: `src/components/assets/TopMovers.tsx`

**Intent**: Presentational island (modelled on `AssetsSummary`) that calls `computeMovers` and renders the gainers/losers/new-assets and the no-snapshot empty state. No interactivity, no data fetching.

**Contract**: `Props { assets: AssetWithCategory[]; baselineItems: SnapshotItemWithCategory[]; hasSnapshot: boolean; displayCurrency: Currency; rates: Record<Currency, number> }`. Behaviour:
- `!hasSnapshot` (no snapshot, or latest snapshot has zero items) → friendly placeholder card prompting "Save a snapshot to see your top movers" (no "Manage assets" link).
- Has snapshot → two columns (Top Gainers / Top Losers) using the `DeltaIndicator` sign/colour/format idiom (`+$X (+Y%)`, green/red, `pct === null` renders "—" in place of the percentage); each row prefixed with `categoryEmoji(icon)` and the asset name.
- `newAssets.length > 0` → a small "New since snapshot" line below the columns.
- Snapshot exists but `gainers` and `losers` are both empty → quiet "No changes since your last snapshot" message (still showing the new-assets note if any).
- Use the card container styling from the existing placeholder / `AssetsSummary` for visual consistency; responsive two-column via `grid-cols-1 sm:grid-cols-2` like `NetWorthDisplay`.

#### 3. Replace the placeholder

**File**: `src/pages/dashboard.astro`

**Intent**: Swap the static placeholder `<div>` (lines 72-84) for `<TopMovers ... client:load />`, dropping the "Manage assets" link.

**Contract**: Remove the placeholder block; render `TopMovers` in its slot (after `NetWorthChart`), passing `assets`, the baseline items, `hasSnapshot`, `displayCurrency`, `rates`. Follow the `client:load` + `as` cast pattern used by the sibling islands.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npm run build`
- Lint passes: `npm run lint`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- **No snapshot:** fresh account (or no snapshots) shows the "save a snapshot" placeholder, not a crash or empty card.
- **Happy path:** with a snapshot saved, then an asset value edited up and another down, the panel shows the right gainer/loser with correct signed amount + %.
- **Liability sign:** reducing a liability shows it as a gainer; increasing it shows it as a loser.
- **New asset:** an asset added after the last snapshot appears only under "New since snapshot", never in the ranked lists.
- **Currency change:** switch display currency (S-05 settings) after a snapshot — the panel still renders sane per-asset changes (no wrong-currency comparison).
- **No-change state:** with no edits since the snapshot, the quiet "no changes" message renders.
- **Mobile (~360px):** columns stack without horizontal scroll.
- No regressions to `NetWorthDisplay`, `AssetsSummary`, or `NetWorthChart`.

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation across the states above.

---

## Testing Strategy

### Unit Tests:

- `src/lib/movers.test.ts` — table-driven, per the Phase 1 case list (matching, liability sign, currency change, new/removed assets, near-zero %, dead-zone, limit, empty inputs).

### Integration Tests:

- None added (no new API route; the diff logic is fully covered by the pure-function unit tests).

### Manual Testing Steps:

1. Load `/dashboard` with no snapshots → expect the "save a snapshot" placeholder.
2. Save a snapshot, edit one asset up and one down, reload → expect correct gainer/loser with amount + %.
3. Reduce a liability → expect it under Top Gainers.
4. Add a new asset → expect it only under "New since snapshot".
5. Change display currency in settings, reload → expect sane per-asset changes, no currency mismatch.
6. Narrow to ~360px → expect stacked columns, no horizontal scroll.

## Performance Considerations

One extra indexed query (`snapshot_items` by `snapshot_id`) on dashboard load — negligible. The diff is O(current + baseline) over a handful of rows, computed once. No client-side fetch added.

## Migration Notes

None — read-only feature, no schema or data changes.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-11 (`dashboard-top-movers`)
- Change identity: `context/changes/dashboard-top-movers/change.md`
- Reuse: `convertAmount` `src/lib/net-worth.ts:18-27`; `DeltaIndicator` `src/components/assets/NetWorthDisplay.tsx:19-34`; `categoryEmoji` `src/lib/category-icons.ts`; island template `src/components/assets/AssetsSummary.tsx`
- Snapshot write shape: `src/pages/api/snapshots/index.ts:139-151`
- Lessons: `context/foundation/lessons.md` — "Currency cast boundary"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure movers module + unit tests

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 5e4654d
- [x] 1.2 Lint passes: `npm run lint` — 5e4654d
- [x] 1.3 Unit tests pass: `npx vitest run src/lib/movers.test.ts` — 5e4654d

#### Manual

- [x] 1.4 Spot-check one table case (currency-change) by hand — 5e4654d

### Phase 2: Dashboard wiring + TopMovers island

#### Automated

- [x] 2.1 Type checking / build passes: `npm run build` — 737a07b
- [x] 2.2 Lint passes: `npm run lint` — 737a07b
- [x] 2.3 Full unit suite passes: `npx vitest run` — 737a07b

#### Manual

- [x] 2.4 No snapshot → "save a snapshot" placeholder, no crash — 737a07b
- [x] 2.5 Happy path → correct gainer/loser with amount + % — 737a07b
- [x] 2.6 Liability sign → shrinking debt shows as gainer — 737a07b
- [x] 2.7 New asset → appears only under "New since snapshot" — 737a07b
- [x] 2.8 Currency change → sane per-asset changes, no mismatch — 737a07b
- [x] 2.9 No-change state → quiet "no changes" message — 737a07b
- [x] 2.10 Mobile ~360px → columns stack, no horizontal scroll — 737a07b
- [x] 2.11 No regressions to NetWorthDisplay / AssetsSummary / NetWorthChart — 737a07b
