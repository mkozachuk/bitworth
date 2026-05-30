# Dashboard — Net Worth, Deltas, and Trend Chart Implementation Plan

## Overview

Add three things to the dashboard: (1) delta indicators on `NetWorthDisplay` (vs. last month, vs. January 1st), (2) a new `NetWorthChart` React island using Recharts to render snapshot history, and (3) a "Save Snapshot" button inside `NetWorthDisplay` that POSTs to a new API route, persists both `snapshots` and `snapshot_items` rows, and refreshes the chart.

## Current State Analysis

- `dashboard.astro` fetches assets and exchange rates server-side, passes them to `NetWorthDisplay` (hydrated `client:load`)
- `NetWorthDisplay` shows total net worth, assets, and liabilities — no deltas, no chart, no save button
- `displayCurrency` is hardcoded to `"USD"` in `dashboard.astro:19`; `user_preferences` table not read
- Schema (`snapshots`, `snapshot_items`) is migrated — no migration needed
- No charting library installed; `recharts` + `react-is` need to be added
- `getRates(supabase)` is server-side only (`src/lib/exchange-rates.ts`); client components must receive pre-converted values

## Desired End State

- `NetWorthDisplay` shows net worth + assets/liabilities (existing) + delta vs last month + delta vs Jan 1st + "Save Snapshot" button
- New `NetWorthChart` card below `NetWorthDisplay` renders a Recharts `LineChart` with snapshot history; dashed green `ReferenceLine` marks Jan 1st starting point
- Empty state: card with message and prominent "Save your first snapshot" button
- Save Snapshot: spinner on click → "Saved!" for 2s → revert; API inserts `snapshots` row + `snapshot_items` per asset; chart re-fetches
- `dashboard.astro` fetches `display_currency` from `user_preferences` and reads all snapshots for the chart

### Key Discoveries

- `getRates` is server-only — rates are computed server-side in `dashboard.astro` and passed as props; `NetWorthDisplay` uses these same rates for delta computation
- `total_net_worth` is stored in the user's display currency — delta comparisons are valid as-is, no re-conversion needed (`research.md:127-138`)
- Fetch chain error handling per `context/foundation/lessons.md`: must surface failures visibly — `fetchSnapshots` and `saveSnapshot` need error states
- API route error shape: `{ error: { code, message, context? } }` per `src/pages/api/assets/index.ts` — always use this pattern
- Existing `ErrorShape` interface pattern in `src/pages/api/assets/index.ts:5-7`

## What We're NOT Doing

- Auto-save snapshots (manual only — roadmap item S-02 owner is "user")
- Reading `user_preferences.display_currency` in `dashboard.astro` — `displayCurrency` stays hardcoded to `"USD"` for this change (identified as a follow-up in `research.md:264`)
- Multi-currency chart lines — single line in user's display currency
- Currency conversion on the chart Y-axis — values stay in display currency
- Modifying the auth flow, middleware, or any non-dashboard pages
- Installing any charting library other than `recharts`

## Implementation Approach

Split into three phases: (1) add `recharts` dependency, refactor `NetWorthDisplay` with deltas + save button + client-side rates fetch; (2) create `NetWorthChart` component + dashboard page updates; (3) wire everything together and verify end-to-end flow. The rates problem is solved by fetching rates client-side in the `NetWorthDisplay` island (using a lightweight internal fetch to `/api/rates` or a new endpoint) — this is needed because the snapshot save API route runs server-side and can use `getRates` directly, but `NetWorthDisplay` needs rates to compute the delta against server-computed totals.

## Phase 1: Install Recharts + Add Deltas + Save Snapshot Button

### Overview

Install `recharts` and `react-is`, extend `NetWorthDisplay` with delta indicators and the "Save Snapshot" button, and add an internal helper to fetch rates client-side.

### Changes Required

#### 1. Install charting dependency

**File**: `package.json`

**Intent**: Add `recharts` and `react-is` to enable the chart component.

**Contract**: Running `npm install recharts react-is` succeeds with no peer-dep warnings.

#### 2. Client-side rates fetcher

**File**: `src/pages/api/rates.ts` (create)

**Intent**: Lightweight endpoint so client-side React islands can fetch exchange rates without a full Supabase round-trip.

**Contract**: `GET /api/rates` returns `{ rates: Record<Currency, number> }` with the same shape as `getRates()` result. Auth guard: any authenticated user can hit it (public-ish data). Falls back to static rates on failure.

#### 3. NetWorthDisplay with deltas and save button

**File**: `src/components/assets/NetWorthDisplay.tsx`

**Intent**: Extend the existing card with (a) delta vs last month and vs Jan 1st, (b) a "Save Snapshot" button with spinner/success states, and (c) a client-side fetch of rates for delta computation. Receives `snapshots` prop from parent.

**Contract**:
- Props interface adds: `snapshots?: Snapshot[]` (server fetches, passes down; empty array if none)
- Delta computation: `current.total_net_worth - lastMonth.total_net_worth` and `current.total_net_worth - janSnap.total_net_worth`; format as `+$X (Y%)` / `-$X (Y%)`; show green/red color
- "Save Snapshot" button at bottom of card (below assets/liabilities grid), full-width, `bg-purple-600 hover:bg-purple-500` styling
- Button states: default → loading spinner (SVG) + "Saving..." → "Saved!" for 2s → default
- On error: button shows "Retry" with red tint
- `fetchChain` error handling per lessons.md: on fetch failure, render inline error message in card, not silent
- Calls `POST /api/snapshots` on save; on success, triggers `onSnapshotSaved` prop callback (parent refreshes chart data)

#### 4. Snapshot types

**File**: `src/lib/database.types.ts`

**Intent**: Add `snapshots` and `snapshot_items` table types (not currently generated since schema was migrated separately).

**Contract**: `Tables<"snapshots">` and `Tables<"snapshot_items">` types available for use in components and API routes.

### Success Criteria

#### Automated

- `npm install recharts react-is` succeeds
- `npm run build` succeeds with new components and API route
- `npm run lint` passes
- TypeScript compiles without errors (`npx astro sync` generates types first)

#### Manual

- NetWorthDisplay shows delta vs last month and vs Jan 1st (or "No baseline" if none)
- "Save Snapshot" button visible inside NetWorthDisplay card
- Clicking Save shows spinner → "Saved!" → reverts; snapshot appears in DB

---

## Phase 2: Create NetWorthChart Component + Dashboard Updates

### Overview

Add `NetWorthChart` React component, update `dashboard.astro` to fetch snapshots server-side and pass data to both components, and create the snapshot API route.

### Changes Required

#### 1. NetWorthChart component

**File**: `src/components/NetWorthChart.tsx` (create)

**Intent**: Line chart showing net worth over time from snapshot history.

**Contract**:
- Props: `snapshots: Snapshot[]`, `displayCurrency: Currency`
- Data shape: `SnapshotPoint[]` = `{ date: string, netWorth: number }` where date is ISO string, netWorth is already in display currency
- Renders `ResponsiveContainer(width="100%", height=300)` with `LineChart`
- `Line` with `type="monotone"`, `dot={false}`, `stroke="#a78bfa"` (purple), `strokeWidth={2}`
- `ReferenceLine` at Jan 1st net worth with `strokeDasharray="3 3"`, green label "Start"
- `CartesianGrid` with `stroke="#ffffff10"` (subtle dark grid)
- Custom `Tooltip` with glass styling matching card theme
- X-axis ticks: month abbreviations via `toLocaleDateString('en-US', { month: 'short' })`
- Y-axis ticks: formatted with `toLocaleString()`
- Empty state: card with message "No snapshots yet. Save your first one to see your trend." and a prominent "Save your first snapshot" button (same style as the one in NetWorthDisplay, triggers parent callback)
- `initialDimension={{ width: 600, height: 300 }}` on `ResponsiveContainer` to avoid initial render -1 warning

#### 2. Snapshot API route

**File**: `src/pages/api/snapshots/index.ts` (create)

**Intent**: Handle GET (fetch all snapshots for user) and POST (save new manual snapshot with itemized items).

**Contract**:

`GET`:
- Auth guard → 401
- Returns `{ data: Snapshot[] }` with `id, total_net_worth, display_currency, source, created_at`
- Ordered `created_at ASC` for chart

`POST`:
- Auth guard → 401
- Fetch current assets (same query as dashboard.astro)
- Read display currency from `user_preferences` table (`dashboard.astro` still hardcodes but this route reads it)
- Compute total net worth via `getRates(supabase)` + conversion (server-side, can reuse existing logic pattern from `NetWorthDisplay`)
- Insert `snapshots` row: `{ user_id, total_net_worth, display_currency, base_currency: 'USD', source: 'manual' }`
- Insert `snapshot_items` rows: one per asset with `asset_id`, `amount`, `currency`, `exchange_rate_usd` at snapshot time
- Return `{ data }` on success; `{ error: { code, message } }` on failure
- Use exact `ErrorShape` pattern from `src/pages/api/assets/index.ts`

#### 3. dashboard.astro updates

**File**: `src/pages/dashboard.astro`

**Intent**: Fetch snapshots alongside assets, pass to both components.

**Contract**:
- Add snapshot query after assets query: `.from("snapshots").select().eq("user_id", user.id).order("created_at", { ascending: true })`
- Pass `snapshots` prop to `NetWorthDisplay` and `NetWorthChart`
- Pass `displayCurrency` to both components
- Render `<NetWorthChart>` below `<NetWorthDisplay>` in the component tree
- `NetWorthDisplay` receives `onSnapshotSaved` callback that re-validates the page (causes fresh data fetch on next render)

### Success Criteria

#### Automated

- `npm run build` succeeds
- `npm run lint` passes
- TypeScript compiles without errors

#### Manual

- Chart renders correctly with 2+ snapshots
- Empty state shows when no snapshots exist
- Chart axis labels and tooltip format correctly

---

## Phase 3: Integration + Refinement

### Overview

Wire the full save-and-refresh flow, add loading states, handle edge cases, and run final verification.

### Changes Required

#### 1. Save + refresh flow

- When `NetWorthDisplay` saves a snapshot, it calls `onSnapshotSaved` prop
- Parent (`dashboard.astro` via Astro's component model) re-renders on island boundary — `NetWorthDisplay` and `NetWorthChart` receive updated `snapshots` prop from the server re-render
- `NetWorthChart` shows the new data point immediately

#### 2. Loading states

- `NetWorthChart` shows a subtle loading state (fade-in animation or simple skeleton text) while parent re-fetches
- `NetWorthDisplay` save button handles concurrent requests: disable button while in-flight

#### 3. Edge cases

- Zero assets: `NetWorthDisplay` shows `$0.00`; save snapshot still works (inserts `total_net_worth = 0`)
- API route failure: `NetWorthDisplay` error state per lessons.md (fetch chain rule)
- Snapshot fetch failure in `dashboard.astro`: `snapshots` defaults to `[]`, both components handle empty array gracefully
- Chart with single data point: `LineChart` renders one dot (Recharts handles this gracefully)

### Success Criteria

#### Automated

- All tests pass (if any exist)
- Full `npm run build` clean

#### Manual

- Complete flow: open dashboard → see net worth → click Save Snapshot → button cycles through states → new data point appears in chart
- Delta values update after saving a new snapshot
- Empty state → first save → chart renders with one data point
- Error state: simulate API failure, verify error is surfaced visibly in UI

---

## Testing Strategy

### Unit Tests

- `NetWorthDisplay`: delta computation logic (test with mocked snapshots — last month, Jan 1st, no baseline)
- Delta formatting: positive/negative values, zero, percentage calculation
- Button state machine: default → loading → success → default

### Integration Tests

- `POST /api/snapshots`: happy path, unauthenticated → 401, zero assets → inserts with `total_net_worth = 0`
- `GET /api/snapshots`: returns ordered data for authenticated user, filtered by `user_id`

### Manual Testing Steps

1. Open dashboard with no snapshots → verify empty state in chart area
2. Click "Save Snapshot" → verify spinner → "Saved!" → chart area updates (single point)
3. Add/modify an asset → save snapshot again → chart shows two points with a line
4. Verify Jan 1st reference line appears when snapshot predates Jan 1st
5. Verify deltas update correctly after second snapshot
6. Verify error state if API fails (test with network tab or temporarily break the endpoint)

---

## Performance Considerations

- Snapshot save is a write-heavy operation: one `snapshots` insert + N `snapshot_items` inserts per asset. Target: <200ms end-to-end.
- `snapshot_items` insert can be parallelized: insert all in one `Promise.all` batch.
- No indexing concern: `idx_snapshots_user_created` covers the chart query.
- `NetWorthChart` re-renders only when `snapshots` prop changes (React.memo or key).

---

## Migration Notes

No migrations needed — schema already exists. No existing data needs backfilling.

---

## References

- Internal research: `context/changes/dashboard-snapshots-chart/research.md`
- Recharts docs: `context/changes/dashboard-snapshots-chart/recharts-docs.md`
- Existing API route pattern: `src/pages/api/assets/index.ts`
- Lessons (fetch chain errors): `context/foundation/lessons.md`

---

## Progress

### Phase 1: Recharts + Deltas + Save Button

#### Automated

- [x] 1.1 `npm install recharts react-is` succeeds
- [x] 1.2 `npm run build` succeeds
- [x] 1.3 `npm run lint` passes
- [x] 1.4 TypeScript compiles without errors

#### Manual

- [x] 1.5 NetWorthDisplay shows delta vs last month and vs Jan 1st — d98dc4e
- [x] 1.6 "Save Snapshot" button visible in card, click cycles through spinner → "Saved!" → revert — d98dc4e

### Phase 2: NetWorthChart + Dashboard Updates

#### Automated

- [x] 2.1 `npm run build` succeeds
- [x] 2.2 `npm run lint` passes

#### Manual

- [ ] 2.3 Chart renders correctly with 2+ snapshots
- [ ] 2.4 Empty state shows when no snapshots exist
- [ ] 2.5 Chart axis labels and tooltip format correctly

### Phase 3: Integration + Refinement

#### Automated

- [ ] 3.1 Full `npm run build` clean

#### Manual

- [ ] 3.2 Complete end-to-end flow (save → refresh → chart updates)
- [ ] 3.3 Delta values update correctly after saving
- [ ] 3.4 Empty state → first save → chart renders
- [ ] 3.5 Error state surfaced visibly in UI