# Dashboard Assets Summary — Implementation Plan

## Overview

Add a per-currency assets breakdown widget to the dashboard so users can quickly understand their exposure across currencies without navigating to the assets page.

## Current State Analysis

`NetWorthDisplay.tsx` already aggregates assets vs. liabilities totals across all currencies. The dashboard (`dashboard.astro`) fetches all assets server-side and passes them to `NetWorthDisplay`. S-02's snapshot/chart loop is complete. The one thing missing from the dashboard is a per-currency breakout.

Key constraints discovered:

- `dashboard.astro` already has assets data server-side — no new fetch needed for the summary widget.
- Exchange rates are already fetched in `dashboard.astro` via `getRates()` — available to pass as props.
- Existing Tailwind patterns: `border-white/10`, `bg-white/5`, `rounded-xl`, `text-white/60` caps labels, `rounded-full` currency badges — follow these exactly.
- `CurrencyBadge.tsx` exists and already colors USD/EUR/PLN — reuse it.
- No test directory exists yet — skip automated tests for this slice.

## Desired End State

On the dashboard, below the Net Worth card, users see a compact card with one row per currency that has non-zero assets. Each row shows: currency badge (colored dot + code), total value converted to display currency, and the sum of original amounts. Rows are sorted by largest exposure first. No drilldown.

## What We're NOT Doing

- Drilldown / expandable category breakdown (out of scope per user decision)
- Always-visible all-three-currencies rows (only currencies with assets shown)
- Navigating to assets page for details
- Auto-save on currency change

## Implementation Approach

New `AssetsSummary.tsx` React island (`client:load`) that receives `assets`, `rates`, and `displayCurrency` as props. Computes per-currency totals (filtering to non-zero), sorts descending, renders a compact card matching existing dashboard patterns. No new API routes, no new DB tables, no data fetching — purely a derived display component.

## Phase 1: New AssetsSummary component

### Overview

Create the `AssetsSummary.tsx` island that computes and renders the per-currency breakdown.

### Changes Required:

#### 1. New AssetsSummary component

**File**: `src/components/assets/AssetsSummary.tsx`

**Intent**: Compute per-currency totals from the assets prop (using the same `convertAmount` utility pattern from `NetWorthDisplay`), sort by largest exposure, and render a compact card. Reuses `CurrencyBadge` for consistent styling.

**Contract**: Props are `assets: AssetWithCategory[]`, `displayCurrency: Currency`, `rates: Record<Currency, number>`. Renders nothing if all asset totals are zero.

### Success Criteria:

#### Automated

- Linting passes: `npm run lint`

#### Manual

- Dashboard renders the new card below NetWorthDisplay when assets exist
- Card is hidden when all asset totals are zero
- Rows sorted by largest exposure first
- Only currencies with non-zero assets appear

---

## Phase 2: Wire into dashboard page

### Overview

Import and render `AssetsSummary` in `dashboard.astro` with assets and rates as props.

### Changes Required:

#### 1. Update dashboard.astro

**File**: `src/pages/dashboard.astro`

**Intent**: Add `AssetsSummary` import and render it between `NetWorthDisplay` and `NetWorthChart`.

**Contract**: Pass `assets`, `displayCurrency`, and `rates` as props to `AssetsSummary`. Component uses `client:load` directive.

### Success Criteria:

#### Automated

- Linting passes: `npm run lint`
- Type checking passes: `npx astro sync && npm run lint`

#### Manual

- Dashboard page loads without errors
- New card visible and correctly computed

## Testing Strategy

### Manual Testing Steps:

1. Navigate to `/dashboard` with no assets — the card should be hidden.
2. Add one asset in USD only — card shows one row: "USD · [converted amount] USD".
3. Add a second asset in EUR — card shows two rows sorted by largest converted total.
4. Add a liability in PLN — card shows three rows; liability subtracts from PLN total.
5. Verify currency ordering changes as asset amounts change (largest first).

## References

- Similar component pattern: `src/components/assets/NetWorthDisplay.tsx:123-160` (currentNetWorth computation)
- Currency badge: `src/components/assets/CurrencyBadge.tsx`
- Dashboard data flow: `src/pages/dashboard.astro:22-31` (assets + rates already fetched server-side)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: New AssetsSummary component

#### Automated

- [ ] 1.1 Linting passes

#### Manual

- [ ] 1.2 Dashboard renders the card with assets present
- [ ] 1.3 Card hidden when all totals are zero
- [ ] 1.4 Rows sorted by largest exposure
- [ ] 1.5 Only currencies with assets shown

### Phase 2: Wire into dashboard page

#### Automated

- [ ] 2.1 Linting + type checking passes

#### Manual

- [ ] 2.2 Dashboard page loads without errors
- [ ] 2.3 Card visible and correctly computed
