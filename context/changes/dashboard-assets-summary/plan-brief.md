# Dashboard Assets Summary — Plan Brief

> Full plan: `context/changes/dashboard-assets-summary/plan.md`

## What & Why

Users need to quickly understand their currency exposure — how much of their net worth is in PLN vs EUR vs USD — without leaving the dashboard or navigating to the assets page. Right now the dashboard only shows a single net worth number and a trend chart. This slice adds the per-currency breakdown that makes the dashboard complete.

## Starting Point

`NetWorthDisplay` already aggregates assets across all currencies into one number. `dashboard.astro` already fetches all assets server-side with rates available. S-02 (net worth + chart) is done. S-04 drops in below it with a derived display component.

## Desired End State

A compact card below `NetWorthDisplay` showing one row per currency the user holds assets in. Each row: currency badge (dot + code), total converted to display currency, original sum. Sorted largest exposure first. Hidden when all totals are zero.

## Key Decisions Made

| Decision              | Choice                              | Why                                             | Source |
| --------------------- | ----------------------------------- | ---------------------------------------------- | ------ |
| Layout position       | Inline card below NetWorthDisplay   | Keeps it in the main scroll path with net worth | Plan  |
| Sort order            | Largest converted total first       | Natural priority — biggest exposure is most visible | User |
| Zero-asset currencies | Hidden (only show currencies with assets) | No meaningless rows when user holds one currency | User |
| Drilldown             | None — totals only                  | Simpler component; users go to assets page for details | User |

## Scope

**In scope:** New `AssetsSummary.tsx` island, wiring into `dashboard.astro`, server-side props passthrough.

**Out of scope:** Expandable category breakdown, all-three-currencies rows, navigation to assets page, test suite.

## Architecture / Approach

New React island (`client:load`) that receives `assets`, `rates`, `displayCurrency` as props from the server-rendered `dashboard.astro`. Computes per-currency totals using the same `convertAmount` pattern from `NetWorthDisplay`. No new API routes, no DB changes. Follows existing Tailwind card patterns (`border-white/10`, `bg-white/5`, `rounded-xl`).

## Phases at a Glance

| Phase | What it delivers                                | Key risk                                      |
| ----- | ----------------------------------------------- | -------------------------------------------- |
| 1     | `AssetsSummary.tsx` component                   | Correct currency conversion math             |
| 2     | Card wired into `dashboard.astro`               | Props wiring and SSR compatibility           |

**Prerequisites:** S-01 (assets table) and S-02 (dashboard base) are both done.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- **Liabilities in summary:** The plan includes liabilities in per-currency totals (same as `NetWorthDisplay`). If a liability shares a currency with an asset, they cancel each other out in that row. Assumed correct — user manages assets page for detail.

## Success Criteria (Summary)

- Card renders below `NetWorthDisplay` when user has assets
- Card is hidden when all totals are zero
- Currency rows appear sorted by largest converted total
- Only currencies with non-zero totals appear
- Dashboard loads without errors