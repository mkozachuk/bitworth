# Asset Balancer (S-15) — Target vs Real Allocation Implementation Plan

## Overview

Add a new **"Balance"** page where a user selects which of their existing (non-liability) assets form an investment set, assigns a target percentage to each, and compares **declared** (target) vs **real** (current-value) allocation as two side-by-side pie charts — so they can spot drift and know what to rebalance. Separately, each row on the assets page gains a calculated **"% of all assets"** label.

The feature decomposes into **one new table + one new pure helper + one new API route + one new page (with the first Recharts PieChart) + two in-place edits to the assets list**. Every piece copies a recent precedent already mapped in `context/changes/asset-balancer/research.md`.

## Current State Analysis

- **Assets** live in `assets` (user-owned, RLS-protected); liabilities are **not** a column — they're discriminated by `asset_categories.is_liability`, so balancer/label code must join `category:asset_categories(*)` and filter `!is_liability` (`AssetList.tsx:24-25`, `NetWorthDisplay.tsx:207`).
- **Allocation math** primitives already exist: `convertAmount` and `computeNetWorth` in `src/lib/net-worth.ts`, with `Currency = "PLN" | "USD" | "EUR"` and a `getRates(supabase)` rate source. `computeNetWorth` carries a `TODO(future-refactor)` noting callers re-implement its loop to expose `totalAssets`/`totalLiabilities` separately — this feature wants that breakdown.
- **Pure-helper + Vitest convention** is well established (`fire.ts` + `fire.test.ts`, `movers.ts`): I/O-free, raw floats, round only at the view edge, throw on invalid input, `EPSILON`-guarded `null` divide-by-zero, percentages on a **0–100** scale.
- **Charts** are all `LineChart` today; this is the **first PieChart** (Recharts `^3.8.1` supports it). Chart islands are presentational, fed pre-shaped server data, rendered `client:load`; colors come from `--chart-1..5` CSS variables, never hardcoded hex.
- **Dashboard pages** compute server-side in `.astro` frontmatter (auth guard → `createClient` → assets join → `getRates` → prefs) and pass flat props to islands. `/dashboard/*` is auto-protected by `middleware.ts` (`startsWith("/dashboard")`).
- **API routes** use two 401 guards (null client, then no-user), `.eq("user_id", user.id)` on every query, an inline `{ error: { code, message, context? } }` shape (newer routes use a `jsonError` helper), **hand-rolled validation (no Zod)**, and JSON bodies for non-form endpoints. Atomic multi-row writes are a known weak spot — the snapshots compensating-delete is the cautionary anti-pattern; `.upsert(array, { onConflict })` (single statement) is the sanctioned path.
- **Nav** items in `TopbarMenu.tsx` are hardcoded blocks (Dashboard / Assets / FIRE / Settings); the iOS Safari Radix dropdown fix is already wired there, so a new item inherits it.

## Desired End State

- A `/dashboard/balancer` page reachable from a new **"Balance"** nav item (between Assets and FIRE) renders two pie charts (declared + real) over the user's selected non-liability asset set, sharing one denominator and one per-asset color mapping. The page lets the user pick assets into the set, enter a target % per asset, see a live "targets sum = X%" indicator (non-blocking), and save.
- Saving persists rows in a new `allocation_targets` table; de-selecting an asset removes its row; deleting an asset auto-removes its target (FK cascade).
- Each assets-page row shows a muted "X% of all assets" sub-label (denominator = sum of positive non-liability values), hidden on liability rows.
- All allocation math lives in a unit-tested pure `src/lib/allocation.ts`.

**Verification**: `npm run build` + `npm run lint` pass; `allocation.test.ts` passes; migration applies via local Supabase; manual walkthrough of select → target → save → reload → both pies + label correct.

### Key Discoveries:

- Liability discriminator is `asset_categories.is_liability`, joined as `category:asset_categories(*)` — no column on `assets` (`research.md` §1; `initial_schema.sql:22`).
- `UNIQUE(user_id, asset_id)` is the constraint that makes `.upsert(..., { onConflict: "user_id,asset_id" })` atomic and idempotent (`lessons.md:57-67` motivates it).
- Currency cast boundary: declare `currency: string` on the helper input interface, cast `as Currency` only at the `convertAmount` call site — the lib-layer precedent (`movers.ts:14,60`, `asset-trends.ts:15`).
- `EPSILON = 1e-2` near-zero denominator → `null`, not `=== 0`, because converted floats carry rounding dust (`movers.ts:7,101`).
- Chart colors are `var(--chart-1)..var(--chart-5)` (`global.css:28-32`); both pies **must** reuse the same per-asset color mapping so slices are comparable.
- Tests import via the `@/` alias (`vitest.config.ts` has `tsconfigPaths()`); the `lessons.md:35-43` note about relative imports is stale.
- `npx astro sync` regenerates `src/lib/database.types.ts` — never hand-edit it.

## What We're NOT Doing

- **No** manual-override investment total (option b denominator) — v1 denominator is the sum of selected non-liability assets' current converted values. Follow-up only.
- **No** `show_balancer` settings toggle — the page + nav item are always present (the `show_fire_dashboard` gate is the template if ever added).
- **No** hard-block on declared targets ≠ 100% — non-blocking with a live flag; declared pie renders raw targets, real pie normalizes by construction.
- **No** liabilities in the balancer set, and **no** "% of all assets" label on liability rows.
- **No** one-click "normalize to 100%" button in v1.
- **No** full-replace RPC — writes are upsert + delete-missing.
- **No** generic Checkbox/Switch component — use inline native inputs (none exists in `src/components/ui/`).
- **No** new charting library, **no** Zod, **no** shared `formatPercent` abstraction.
- **No** middleware change — `/dashboard/balancer` is auto-protected.

## Implementation Approach

Build bottom-up so each layer is verifiable before the next depends on it: **data → math → API → page/UI → assets-label**. The math layer (`allocation.ts`) is the load-bearing correctness surface and returns **one structured object** so both pies and the label share a single denominator and color mapping (mitigating the roadmap's "pies must agree" risk). The page computes everything server-side and feeds presentational islands. The assets-page label (Phase 5) is fully independent and could ship alone.

## Critical Implementation Details

- **Both pies, one denominator, one color map.** The declared pie renders **raw** entered target percentages (so an under/over-100% sum is visibly honest); the real pie is normalized to 100% by construction (each slice = asset value ÷ sum of selected values × 100). Both iterate the **same ordered slice list** from `allocation.ts` so slice _i_ is the same asset and the same `--chart-(i mod 5 + 1)` color in both charts. Building two independent color arrays is the bug to avoid.
- **Storage scale is 0–100.** `target_pct NUMERIC(5,2)` with `CHECK (target_pct >= 0 AND target_pct <= 100)`. The math layer is already 0–100, so there is **no** ×100/÷100 conversion at the DB boundary — keep it that way.
- **Save = upsert then delete-missing.** Two RLS-filtered statements: `.upsert(rows, { onConflict: "user_id,asset_id" })`, then delete this user's `allocation_targets` whose `asset_id` is **not** in the submitted payload. Order is upsert-first so a save that only changes percentages never transiently empties the set. Each statement is idempotent; not jointly transactional, but order-safe.

---

## Phase 1: Data Layer — `allocation_targets` table + types

### Overview

Create the `allocation_targets` table with RLS and regenerate the TypeScript types. No application code consumes it yet.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260624120000_allocation_targets.sql`

**Intent**: Persist a per-`(user, asset)` target percentage as a user-owned, RLS-protected table that auto-cleans when an asset is deleted and supports idempotent upserts.

**Contract**: `BEGIN; … COMMIT;` wrapped, with an intent/RLS/rollback comment header (mirror `20260623120000_*`). Table `allocation_targets`:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
- `asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE`
- `target_pct NUMERIC(5,2) NOT NULL CHECK (target_pct >= 0 AND target_pct <= 100)`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `UNIQUE(user_id, asset_id)` — enables `onConflict: "user_id,asset_id"`
- index on `user_id`
- `update_updated_at()` BEFORE UPDATE trigger (the shared trigger from `initial_schema.sql:115-118`)
- `ENABLE ROW LEVEL SECURITY` + the direct policy:

```sql
CREATE POLICY "Users own their allocation targets" ON allocation_targets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

#### 2. Regenerate types

**File**: `src/lib/database.types.ts`

**Intent**: Make `Tables<"allocation_targets">` available to API/route code.

**Contract**: Run `npx astro sync` against the migrated local DB; do **not** hand-edit. Expect a new `allocation_targets: { Row, Insert, Update, Relationships }` entry with the `asset_id → assets` relationship.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase (`supabase db reset` or `supabase migration up`)
- `database.types.ts` contains an `allocation_targets` key after `npx astro sync`
- Type checking passes: `npx astro check` (or `npm run build`)
- Linting passes: `npm run lint`

#### Manual Verification:

- Inserting a row as user A and selecting it as user B returns nothing (RLS isolates per user)
- Deleting an asset removes its `allocation_targets` row (cascade)
- A second insert with the same `(user_id, asset_id)` upserts rather than erroring (unique constraint)

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Allocation Math — pure `src/lib/allocation.ts`

### Overview

Add the I/O-free helper that computes the structured allocation result both pies and the per-asset label consume, plus its Vitest suite.

### Changes Required:

#### 1. Allocation helper

**File**: `src/lib/allocation.ts`

**Intent**: Compute, from the selected assets + their entered targets + rates + display currency, a single structured object exposing: the total selected value, an ordered per-asset slice list (value, raw declared %, normalized real %), and the declared-targets sum — so callers never re-derive a denominator. Resolves the `computeNetWorth` `TODO` by exposing totals directly.

**Contract**: Pure module (no Supabase/React/I/O), header contract comment mirroring `fire.ts:1-12`. Input interface declares `currency: string` (cast `as Currency` only at the `convertAmount` call — lib-layer precedent). Percentages on a **0–100** scale. Near-zero denominator (sum of selected values < `EPSILON = 1e-2`) → `realPct = null` for slices and a guarded structured result (empty/zeroed), not a throw, matching `movers.ts`. Suggested shape:

```ts
interface AllocationSlice {
  asset_id: string;
  name: string;
  value: number;        // converted into display currency, raw float
  targetPct: number;    // raw entered target, 0–100
  realPct: number | null; // value / totalSelected * 100, null if denom ~0
}
interface AllocationResult {
  slices: AllocationSlice[]; // ordered; index drives the shared color mapping
  totalSelected: number;     // sum of slice values (the shared denominator)
  declaredSum: number;       // sum of targetPct (for the live ≠100% flag)
}
```

A separate exported helper computes the assets-page **"% of all assets"** share (denominator = sum of positive non-liability converted values) — kept in this module so all share-math is unit-tested in one place. Invalid/negative target inputs are validated at the API edge, not here; the helper assumes already-parsed numbers.

#### 2. Tests

**File**: `src/lib/allocation.test.ts`

**Intent**: Pin the math against first-principles oracles and guard the ×100/÷100 scaling-bug class.

**Contract**: Vitest, import via `@/lib/allocation`. `describe` per exported function. `toBe` for exact integers/short-circuits, `toBeCloseTo(_, 6)` for any division. Include a `333.33`-class probe; an `overrides`-factory fixture; explicit `Record<Currency, number>` rate literals. Cover: empty set → guarded result; single asset → 100% real; multi-currency conversion; declared sum ≠ 100 surfaced in `declaredSum`; near-zero denominator → `realPct: null`; the per-asset-share helper excludes liabilities and ~0 denominator → `null`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/lib/allocation.test.ts`
- Type checking passes: `npx astro check` (or `npm run build`)
- Linting passes: `npm run lint`

#### Manual Verification:

- Spot-check a hand-computed 3-asset, 2-currency example against the helper output

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: API Route — `allocation-targets` GET + PUT

### Overview

Add the endpoint that reads the user's target set and saves it (upsert submitted rows + delete de-selected rows).

### Changes Required:

#### 1. Route handler

**File**: `src/pages/api/allocation-targets/index.ts`

**Intent**: Expose `GET` (return this user's `allocation_targets` rows) and `PUT` (validate a JSON array body, upsert it, then delete this user's rows whose `asset_id` is absent from the payload), under the standard auth + error conventions.

**Contract**:

- Two 401 guards: null client → 401 `UNAUTHORIZED`; `supabase.auth.getUser()` no-user → 401 `UNAUTHORIZED`. Inline `jsonError` helper supporting `context` (copy `backup/import.ts:9-15`).
- `GET`: `.from("allocation_targets").select("*").eq("user_id", user.id)` → `{ data }` 200.
- `PUT`: parse `await request.json()` in try/catch → 400 `VALIDATION_ERROR` on bad JSON. Body is `Array<{ asset_id: string; target_pct: number }>`; check `Array.isArray`. Per-row hand-rolled validation (copy the field-spec loop in `user-preferences/index.ts:37-102`): `asset_id` is a non-empty string, `target_pct` is `typeof === "number" && Number.isFinite` and `0 <= target_pct <= 100`. Reject duplicate `asset_id`s in the payload.
- Write: stamp `user_id: user.id` from the session onto each row (never from body). `.upsert(rows, { onConflict: "user_id,asset_id" })`, then `.delete().eq("user_id", user.id).not("asset_id", "in", (<submitted asset_ids>))` — delete this user's rows for assets not in the payload. An empty payload clears the whole set. Return `{ data }` 200.
- Success bodies always `Content-Type: application/json`.

**Note on the delete filter**: Supabase `.in(...)` with a negation expresses "asset_id not in submitted list". If the submitted list is empty, the delete simplifies to "delete all of this user's rows" (clearing the set) — handle that branch explicitly to avoid an empty-`in` edge case.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` (or `npm run build`)
- Linting passes: `npm run lint`

#### Manual Verification:

- Unauthenticated `GET`/`PUT` → 401 with the correct error shape
- `PUT` with a 2-row body persists 2 rows; re-`PUT` with 1 of those rows deletes the other (de-select works)
- `PUT` with `target_pct: 150` or a non-number → 400 `VALIDATION_ERROR`
- `PUT` with `[]` clears the user's set
- Rows are scoped per user (cannot read/write another user's targets)

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: Balance Page + Pie Charts + Nav

### Overview

Build the `/dashboard/balancer` page (server compute), the first Recharts PieChart island (two pies + the asset-picker/target editor with the live sum flag), and the "Balance" nav item.

### Changes Required:

#### 1. Page

**File**: `src/pages/dashboard/balancer.astro`

**Intent**: Server-compute the data both pies and the editor need and pass flat props to a `client:load` island.

**Contract**: Copy the `fire.astro` frontmatter sequence: `DashboardLayout` import → auth guard (`const { user } = Astro.locals; if (!user) return Astro.redirect("/auth/signin")`) → `createClient(Astro.request.headers, Astro.cookies)` → `displayCurrency = Astro.locals.displayCurrency ?? "USD"` → assets `.select("*, category:asset_categories(*)").eq("user_id", user.id)` → `getRates(supabase)` → read existing `allocation_targets` for this user. Filter to non-liability assets for the selectable set. Pass to the island: the non-liability assets (id, name, converted value), the saved targets map, `displayCurrency`, and the precomputed `AllocationResult`. Per-page `type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> }`.

#### 2. Pie chart island + editor

**File**: `src/components/balancer/BalancerView.tsx` (and a `BalancerPieChart.tsx` if the chart is split out)

**Intent**: Render the asset-picker + per-asset target-% inputs with a live "targets sum = X%" indicator, and the two pie charts (declared raw, real normalized) sharing the ordered slice list and color mapping. Persist via `PUT /api/allocation-targets`.

**Contract**: Copy `FireProjectionChart.tsx` conventions: named `recharts` imports (`PieChart`, `Pie`, `Cell`, `Legend`, `Tooltip`, `ResponsiveContainer`), typed `interface Props` with pre-shaped data, **empty-data guard** returning a placeholder card when the set is empty, card wrapper `rounded-2xl border border-zinc-200 bg-white/80 p-6 dark:border-white/10 dark:bg-white/5` + uppercase header, `<ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>`, a local `CustomTooltip` via `content={...}`. Colors: build **one** `Cell` color array cycling `var(--chart-1)..var(--chart-5)` indexed by slice order; **both** pies consume it. Picker: native checkboxes restricted to non-liability assets (no generic component exists). Target inputs: per-asset numeric input (reference `CategorySelect.tsx` for styled control patterns). Live indicator reads `declaredSum`; warn styling when ≠ 100, never disables save. On save, `PUT` the `[{ asset_id, target_pct }]` array; re-fetch or optimistically update. `react-compiler` is enforced — keep the component compiler-clean.

#### 3. Nav item

**File**: `src/components/TopbarMenu.tsx`

**Intent**: Add a "Balance" entry linking to `/dashboard/balancer`.

**Contract**: Add `Scale` to the Lucide import (`:3`). Insert a `<DropdownMenu.Item asChild>` block (`href="/dashboard/balancer"`, `<Scale className="size-4" />`, label "Balance") between the Assets item (`:53-57`) and FIRE (`:59`). No active-route handling (none exists). The item inherits the existing iOS Safari dropdown fix.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` (or `npm run build`)
- Linting passes: `npm run lint` (no `react-compiler` errors)

#### Manual Verification:

- "Balance" appears between Assets and FIRE; navigates to `/dashboard/balancer`; works on iOS Safari
- Selecting assets + entering targets updates the declared pie with raw percentages; real pie shows normalized current-value shares
- Both pies use the same color per asset; slices line up for comparison
- Live "sum = X%" indicator warns at ≠100% but save still works
- Save → reload preserves the set and percentages; de-selecting an asset and saving removes it
- Empty set renders the placeholder card, not a broken chart
- Layout/contrast correct in light and dark mode

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 5: Per-Asset "% of all assets" Label

### Overview

Add a muted "X% of all assets" sub-label to each non-liability assets-page row, with the denominator computed once in the parent.

### Changes Required:

#### 1. Denominator + prop threading

**File**: `src/components/assets/AssetList.tsx`

**Intent**: Compute the shared denominator (sum of positive non-liability converted values) once and pass it to rows/cards.

**Contract**: Using the full asset array + `displayCurrency` + `rates` already in scope, compute `totalAssets` via the per-asset-share helper from `allocation.ts` (or an inline `convertAmount` + reduce mirroring `AssetsSummary.tsx:14-29`), excluding liabilities and non-positive values. Pass `totalAssets` as a new prop to `AssetRow` (map at `:105-113`) and `AssetCard` (map at `:117-127`).

#### 2. Render the label

**Files**: `src/components/assets/AssetRow.tsx`, `src/components/assets/AssetCard.tsx`

**Intent**: Show each asset's share of the asset pool, hidden on liability rows.

**Contract**: Add `totalAssets: number` to the shared props interface (`:9-14`). Compute the row's share = converted value ÷ `totalAssets` × 100, guarded against a ~0 denominator (`null` → render nothing). Render only when the row is **non-liability**; omit entirely on liability rows. Use the muted sub-label style `text-xs text-zinc-500 dark:text-white/40`. Format at the view edge (`.toFixed(1)` + `%`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` (or `npm run build`)
- Linting passes: `npm run lint`

#### Manual Verification:

- Each non-liability row shows a sensible "X% of all assets" in [0, 100]; shares of non-liability rows sum to ~100%
- Liability rows show no label
- Label updates correctly when display currency changes
- Layout intact on desktop (`AssetRow`) and mobile (`AssetCard`)

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Testing Strategy

### Unit Tests:

- `allocation.test.ts` (Phase 2): empty set guard; single-asset 100%; multi-currency conversion; `declaredSum` for ≠100% targets; near-zero denominator → `realPct: null`; per-asset-share helper excludes liabilities and guards ~0 denominator; a `333.33`-class scaling probe.

### Integration Tests:

- None automated for v1 (the repo has no API-route integration harness). API behavior is covered by manual verification in Phase 3.

### Manual Testing Steps:

1. Sign in; open **Balance** from the nav; confirm it sits between Assets and FIRE.
2. Select 3 non-liability assets in different currencies; enter targets 50/30/20; confirm declared pie shows 50/30/20 and real pie shows current-value shares; confirm both pies color each asset identically.
3. Enter targets summing to 70%; confirm the live indicator warns but save succeeds; reload and confirm persistence.
4. De-select one asset; save; reload; confirm it's gone from the set and both pies.
5. Clear all selections; save; confirm the placeholder card renders and the set is empty on reload.
6. On the Assets page, confirm each non-liability row shows "X% of all assets", liability rows show none, and non-liability shares sum to ~100%.
7. Delete an asset that had a target; confirm no orphaned target (Balance set updates).
8. Repeat key checks on iOS Safari and in dark mode.

## Performance Considerations

All allocation math is O(n) over a single user's assets (tens, not thousands) computed server-side; no performance budget concern. Rates are cached (`getRates` 1-hour Supabase cache). The two pies render from the same precomputed slice list — no duplicate computation.

## Migration Notes

- New table only; no data backfill. Existing users start with an empty balancer set (placeholder card until they select assets).
- Rollback: drop `allocation_targets` (the migration header documents the rollback statement).

## References

- Research: `context/changes/asset-balancer/research.md`
- Roadmap slice: `context/foundation/roadmap.md:307-324` (S-15)
- Lessons (priors): `context/foundation/lessons.md:5-13` (atomic writes), `:45-55` (RLS WITH CHECK), `:57-67` (missing-unique-constraint), `:25-33` (Currency cast), `:81-89` (SECURITY DEFINER search_path)
- Table DDL template: `supabase/migrations/20260529190856_initial_schema.sql:28-39`
- RLS policy template: `supabase/migrations/20260602235644_rls_with_check.sql:17-21`
- Math primitives: `src/lib/net-worth.ts:18-27,40-56`; `src/lib/movers.ts:7,101,14,60`
- Pure-helper + test house style: `src/lib/fire.ts:1-12`, `src/lib/fire.test.ts`
- Chart island: `src/components/fire/FireProjectionChart.tsx`; colors `src/styles/global.css:28-32`
- Page template: `src/pages/dashboard/fire.astro`; rates wiring `src/pages/dashboard/assets/index.astro:27,49-61`
- Nav: `src/components/TopbarMenu.tsx:3,46-69`
- Assets list edit sites: `src/components/assets/{AssetList,AssetRow,AssetCard}.tsx`
- API conventions: `src/pages/api/assets/index.ts:5-32`, `src/pages/api/user-preferences/index.ts:37-102`, `src/pages/api/backup/import.ts:9-15`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Layer — allocation_targets table + types

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — 82ffafb
- [x] 1.2 database.types.ts contains an allocation_targets key after npx astro sync — 82ffafb
- [x] 1.3 Type checking passes — 82ffafb
- [x] 1.4 Linting passes — 82ffafb

#### Manual

- [x] 1.5 RLS isolates targets per user — 82ffafb
- [x] 1.6 Deleting an asset cascades to its allocation_targets row — 82ffafb
- [x] 1.7 Duplicate (user_id, asset_id) upserts rather than errors — 82ffafb

### Phase 2: Allocation Math — pure src/lib/allocation.ts

#### Automated

- [x] 2.1 Unit tests pass (vitest run src/lib/allocation.test.ts) — ece1af4
- [x] 2.2 Type checking passes — ece1af4
- [x] 2.3 Linting passes — ece1af4

#### Manual

- [x] 2.4 Hand-computed 3-asset, 2-currency example matches helper output — ece1af4

### Phase 3: API Route — allocation-targets GET + PUT

#### Automated

- [x] 3.1 Type checking passes — b53566a
- [x] 3.2 Linting passes — b53566a

#### Manual

- [x] 3.3 Unauthenticated GET/PUT → 401 with correct error shape — b53566a
- [x] 3.4 PUT persists rows; re-PUT without a row deletes it (de-select) — b53566a
- [x] 3.5 Invalid target_pct / non-number → 400 VALIDATION_ERROR — b53566a
- [x] 3.6 PUT [] clears the user's set — b53566a
- [x] 3.7 Rows scoped per user — b53566a

### Phase 4: Balance Page + Pie Charts + Nav

#### Automated

- [x] 4.1 Type checking passes — 1d6f669
- [x] 4.2 Linting passes (no react-compiler errors) — 1d6f669

#### Manual

- [x] 4.3 Balance nav item between Assets and FIRE; navigates; works on iOS Safari — 1d6f669
- [x] 4.4 Declared pie shows raw targets; real pie shows normalized shares — 1d6f669
- [x] 4.5 Both pies use the same color per asset; slices line up — 1d6f669
- [x] 4.6 Live sum indicator warns at ≠100% but save still works — 1d6f669
- [x] 4.7 Save → reload preserves set; de-select + save removes asset — 1d6f669
- [x] 4.8 Empty set renders placeholder card — 1d6f669
- [x] 4.9 Correct in light and dark mode — 1d6f669

### Phase 5: Per-Asset "% of all assets" Label

#### Automated

- [x] 5.1 Type checking passes — e5b350d
- [x] 5.2 Linting passes — e5b350d

#### Manual

- [x] 5.3 Non-liability rows show a sensible 0–100% share; shares sum to ~100% — e5b350d
- [x] 5.4 Liability rows show no label — e5b350d
- [x] 5.5 Label updates when display currency changes — e5b350d
- [x] 5.6 Layout intact on desktop and mobile — e5b350d
