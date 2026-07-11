# Review Fixes — dashboard-snapshots-chart

Generated from impl-review (2026-05-31). Items pending triage.

## Pending

- F1: Wrap snapshot + snapshot_items inserts in atomic transaction (api/snapshots/index.ts)
- F2: Lift inline arrow callbacks to stable references (dashboard.astro)
- F3: Standardize unauthenticated error message to "Not authenticated" (api/snapshots/index.ts)
- F4: Remove unused `getRates` call (api/snapshots/index.ts)
- F5: Fix pre-existing lint crash in dashboard/assets/index.astro (ESLint config or upgrade)
- F6: Remove dead `fetchError` state (NetWorthChart.tsx)
- F7: Add auth check or document intentional unauthenticated access (api/rates.ts)

## Resolved