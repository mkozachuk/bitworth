# Dashboard — Net Worth, Deltas, and Trend Chart — Plan Brief

> Full plan: `context/changes/dashboard-snapshots-chart/plan.md`
> Research: `context/changes/dashboard-snapshots-chart/research.md`
> Recharts docs: `context/changes/dashboard-snapshots-chart/recharts-docs.md`

## What & Why

The dashboard currently shows a net worth number with no context: users don't know if they're up or down compared to last month or the start of the year, have no visual history, and can't save a point-in-time snapshot to build that history. We're adding delta indicators, a Recharts trend chart, and a manual snapshot save button to make the dashboard genuinely useful for tracking financial progress.

## Starting Point

`NetWorthDisplay` (`src/components/assets/NetWorthDisplay.tsx`) renders a glass card with net worth, assets, and liabilities — no deltas, no chart, no save action. The `snapshots` and `snapshot_items` tables are already migrated. No charting library is installed. `displayCurrency` is hardcoded to `"USD"` in `dashboard.astro`.

## Desired End State

`NetWorthDisplay` shows the existing net worth + assets/liabilities + two delta rows (vs last month, vs Jan 1st) formatted as `+$X (Y%)` in green/red. A "Save Snapshot" button sits below the breakdown, cycling through spinner → "Saved!" (2s) → default. A new `NetWorthChart` card below renders a purple Recharts `LineChart` from snapshot history with a dashed green `ReferenceLine` at Jan 1st. Empty state shows a message and prominent first-snapshot button. Server-side `dashboard.astro` fetches all snapshots and passes them to both components.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Save button location | Inside NetWorthDisplay card, below breakdown | Natural spot next to the number being captured; keeps card self-contained | Plan (user confirmed) |
| Save feedback UX | Spinner → "Saved!" (2s) → default | Standard async feedback; non-intrusive; matches user expectations | Plan (user confirmed) |
| Chart empty state | Message + prominent "Save your first snapshot" button | Button is front-and-center for onboarding; zero empty-card jank | Plan (user confirmed) |
| snapshot_items | Yes, save itemized per asset | Enables future re-conversion to different currencies; richer historical data | Plan (user confirmed) |
| Delta format | Both dollar amount and percentage, side by side | Most informative; conveys both absolute scale and relative magnitude | Plan (user confirmed) |
| Rates for client | New `/api/rates` endpoint | `getRates` is server-side only; client components need a lightweight fetch path | Plan |

## Scope

**In scope:**
- Install `recharts` + `react-is`
- Extend `NetWorthDisplay` with delta indicators and "Save Snapshot" button
- New `NetWorthChart` Recharts component with empty/populated states
- New `/api/snapshots` endpoint (GET + POST with `snapshot_items`)
- New `/api/rates` endpoint for client-side rate access
- `dashboard.astro` fetches and passes snapshot data
- `database.types.ts` additions for snapshot tables

**Out of scope:**
- Reading `user_preferences.display_currency` (stays hardcoded to `"USD"`)
- Auto-save snapshots (manual only)
- Multi-currency chart lines
- Modifying auth flow, middleware, or non-dashboard pages

## Architecture / Approach

Three-phase incremental implementation:
1. **Phase 1** — dependency install + client-side `/api/rates` + `NetWorthDisplay` deltas + save button
2. **Phase 2** — `NetWorthChart` component + `/api/snapshots` endpoint + `dashboard.astro` updates
3. **Phase 3** — integration, error states, edge cases, final verification

The snapshot save is a server-side API call from the client island. On success, the parent Astro page re-renders on the island boundary, refreshing both `NetWorthDisplay` (with new deltas) and `NetWorthChart` (with new data point).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Recharts + Deltas + Save Button | Rates endpoint, extended `NetWorthDisplay` with deltas and working save button | Client-side rates fetch — needs new `/api/rates` endpoint |
| 2. NetWorthChart + Dashboard Updates | `NetWorthChart` Recharts component, `/api/snapshots` endpoint, `dashboard.astro` data wiring | Snapshot save POST must insert N+1 rows atomically |
| 3. Integration + Refinement | Full end-to-end flow, error states, edge cases | Astro island boundary re-render timing for chart refresh |

**Prerequisites:** Node 18+, `.env` with `SUPABASE_URL` + `SUPABASE_KEY`, schema migrated
**Estimated effort:** ~2-3 sessions across 3 phases

## Open Risks & Assumptions

- `recharts` React 19 compatibility: v3.x claimed compatible; watch for `react-is` peer-dep warnings on install
- `displayCurrency` hardcoded to `"USD"` means deltas and chart are in USD regardless of user preference — follow-up needed
- `snapshot_items` insert is N+1 per asset — acceptable for personal finance (tens of assets), but worth monitoring on larger accounts
- Astro island boundary: the parent page re-render on `NetWorthDisplay` save success may not automatically refresh `NetWorthChart` in the same render pass — may need a shared state solution (URL param, store) if Astro's island hydration doesn't cascade updates

## Success Criteria (Summary)

- User sees net worth with `+$X (Y%)` delta indicators in green/red
- "Save Snapshot" button cycles through states and persists to `snapshots` + `snapshot_items` tables
- Trend chart renders historical snapshots with Jan 1st reference line
- Empty state guides user to save their first snapshot
- Full `npm run build` and `npm run lint` pass