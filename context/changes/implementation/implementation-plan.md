# Implementation Plan: BitWorth MVP

## Context

BitWorth is a privacy-first personal net worth tracker. Auth is already implemented and wired. The dashboard is a placeholder. The Supabase schema doesn't exist. The PRD defines 20 functional requirements across auth, asset management, currency conversion, snapshots, and crypto pricing.

**Tech stack:** Astro v6 SSR + React 19 islands + Supabase + Cloudflare Workers + Tailwind v4 + Recharts + Frankfurter API (exchange rates) + CoinGecko API (crypto prices)

**Key decisions:** SQL migrations for schema, demo data in Supabase (flagged rows), Recharts for charting.

---

## Phase 1: Database Schema

- [ ] Install test framework: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/node`
- [ ] Create `vitest.config.ts` — `test.environment: 'jsdom'`, alias `@/` to `<rootDir>/src`, setup file for `@testing-library/jest-dom`
- [ ] Add to `package.json`: `"test": "vitest"`, `"test:run": "vitest run"`
- [ ] Add Vitest to `lint-staged` config for pre-commit test runs
- [ ] Create `supabase/migrations/0001_initial_schema.sql` with:
  - [ ] `profiles` table — extends `auth.users`, adds `display_currency` (PLN/USD/EUR, default PLN), RLS enabled
  - [ ] `assets` table — `id, user_id, name, amount, currency (PLN/USD/EUR), category, is_liability, created_at, updated_at`
  - [ ] `snapshots` table — `id, user_id, total_net_worth, currency, snapshot_date, created_at`
  - [ ] `exchange_rates` table — `currency_pair, rate, fetched_at`
  - [ ] `crypto_prices` table — `symbol, price_usd, fetched_at`
  - [ ] RLS policies on all tables (users see only own rows)
  - [ ] Indexes on `assets(user_id)`, `snapshots(user_id)`, `snapshots(snapshot_date)`
  - [ ] Auto-snapshot trigger function (fires on first login each calendar month)
- [ ] Apply migration to Supabase (`supabase db push` or Studio)
- [ ] Run `npx supabase gen types typescript --project-id ... > src/lib/database.types.ts`

---

## Phase 2: Library Utilities

- [ ] `src/lib/db.ts` — typed Supabase client factory (server-side `createServerClient`)
- [ ] `src/lib/exchange-rates.ts` — fetch from Frankfurter API (`api.frankfurter.app`), cache to `exchange_rates` table, fallback to cached if API fails
- [ ] `src/lib/crypto-prices.ts` — fetch from CoinGecko API (free, no key), cache to `crypto_prices` table, fallback to cached if API fails
- [ ] `src/lib/net-worth.ts` — `computeNetWorth(assets, rates, displayCurrency)` → `{ total: number, byCategory: Record<string, number> }`
- [ ] `src/lib/snapshot.ts` — compute net worth from current assets + rates, save snapshot to DB, return snapshot ID
- [ ] `src/lib/delta.ts` — compute delta between two snapshots (absolute + percentage)
- [ ] **Tests:** `src/lib/__tests__/` — unit tests for each utility with mocked Supabase client and fetch calls. Covers: happy path, API failure fallback, cache miss handling, invalid input.

---

## Phase 3: API Routes

- [ ] `src/pages/api/assets/index.ts` — `GET` (list), `POST` (create)
- [ ] `src/pages/api/assets/[id].ts` — `PUT` (update), `DELETE`
- [ ] `src/pages/api/snapshots/index.ts` — `GET` (list), `POST` (manual save)
- [ ] `src/pages/api/exchange-rates/index.ts` — `GET` returns cached rates, triggers refresh if stale (>1hr)
- [ ] `src/pages/api/crypto-prices/index.ts` — `GET` returns cached prices, triggers refresh if stale (>1hr)
- [ ] `src/pages/api/profile/index.ts` — `PUT` (update display currency)
- [ ] **Tests:** `src/pages/api/__tests__/` — API integration tests per endpoint group. Mock auth session and Supabase client. Covers: each HTTP method (GET/POST/PUT/DELETE), auth-gated routes reject unauthenticated, error responses match `{ error: { code, message, context? } }`.

All API routes must:
- Return `{ error: { code: string, message: string, context?: unknown } }` on failure
- Enforce auth (redirect to error JSON if not authenticated)
- Run on the authenticated user's data only

---

## Phase 4: React Components

### UI Primitives
- [ ] `src/components/ui/card.tsx` — Card, CardHeader, CardTitle, CardContent (reusable container)
- [ ] `src/components/ui/input.tsx` — text input with label + error state
- [ ] `src/components/ui/select.tsx` — styled select dropdown
- [ ] `src/components/ui/modal.tsx` — accessible dialog overlay
- [ ] `src/components/ui/skeleton.tsx` — loading shimmer placeholder
- [ ] **Tests:** `src/components/__tests__/ui/` — unit tests for each primitive via `@testing-library/react`. Covers: renders correctly, handles user interactions (focus, click), displays error/loading states.

### Dashboard Components
- [ ] `src/components/dashboard/NetWorthCard.tsx` — single prominent number, delta vs last month (absolute + %), delta vs Jan 1st (absolute + %)
- [ ] `src/components/dashboard/AssetList.tsx` — grouped by category, each row: name, amount+currency, edit/delete buttons (calls DELETE API on confirm)
- [ ] `src/components/dashboard/AssetForm.tsx` — modal form: name, amount, currency select (PLN/USD/EUR), category select (12 categories from PRD), is_liability checkbox
- [ ] `src/components/dashboard/NetWorthChart.tsx` — Recharts `LineChart`, x-axis dates, y-axis net worth in display currency, tooltips with formatted values
- [ ] `src/components/dashboard/CurrencySelector.tsx` — inline select to switch display currency (PLN/USD/EUR), persists to `profiles` table
- [ ] `src/components/dashboard/SnapshotButton.tsx` — "Save Snapshot" button, calls POST /api/snapshots, shows success state
- [ ] `src/components/dashboard/ErrorBoundary.tsx` — React error boundary with fallback UI
- [ ] `src/components/dashboard/DashboardClient.tsx` — orchestrates all dashboard components, manages loading/data/error states
- [ ] `src/components/auth/AuthStatus.tsx` — shows user email, currency selector, sign-out button (for topbar)
- [ ] **Tests:** `src/components/__tests__/dashboard/` — unit tests for each dashboard component via `@testing-library/react` with mock props. Covers: renders with data, loading skeleton, empty state, error state, modal open/close interactions, chart renders with mock data.

---

## Phase 5: Dashboard Page

- [ ] Rewrite `src/pages/dashboard.astro` to:
  - [ ] SSR-fetch: user profile, all assets, all snapshots, exchange rates
  - [ ] Pass data as props to `<DashboardClient />` React island
  - [ ] Compute initial net worth server-side (avoids flash of uncomputed value)
- [ ] Install `recharts` package: `npm install recharts`
- [ ] **Tests:** `src/pages/__tests__/dashboard.test.tsx` — page-level tests for dashboard.astro SSR output via `@testing-library/react`. Verify page renders, passes correct props to DashboardClient, unauthenticated redirect, skeleton during hydration.

---

## Phase 6: Demo Mode (nice-to-have)

- [ ] Add `is_demo` flag to `profiles` table + seed demo user in migration
- [ ] Populate demo assets and snapshots for the demo user
- [ ] Update landing page (`src/pages/index.astro`) — add "Try Demo" button
- [ ] `src/pages/demo/index.astro` — demo dashboard page, no auth required, read-only view of demo data

---

## Phase 7: Polish

- [ ] Add `bg-cosmic` dark gradient background to dashboard
- [ ] Ensure loading skeletons render while React island hydrates
- [ ] Error boundaries on each major component
- [ ] Verify: unauthenticated `/dashboard` → redirects to `/auth/signin`
- [ ] Verify: sign up → redirect to dashboard → see empty state

---

## Dependencies

```bash
npm install recharts
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/node
```

**Test commands:**
```bash
npm run test      # watch mode
npm run test:run  # single run (used in CI / pre-commit)
```

No other new packages needed — Supabase, React, Tailwind, Lucide, CVA are already installed.

---

## Verification

- [ ] `npm run build` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:run` passes with no errors (all Vitest unit tests green)
- [ ] Local dev: sign up, add assets across categories/currencies, see correct net worth
- [ ] Local dev: switch display currency, all numbers update
- [ ] Local dev: save snapshot, chart renders with new data point
- [ ] Local dev: edit + delete asset, numbers update correctly
- [ ] Browser DevTools: no console errors
- [ ] Unauthenticated `/dashboard` → 302 redirect to `/auth/signin`

---

## Critical Files

| File | Purpose |
|---|---|
| `supabase/migrations/0001_initial_schema.sql` | All DB tables, RLS, indexes |
| `src/pages/dashboard.astro` | Main SSR dashboard page |
| `src/components/dashboard/` | All React dashboard components |
| `src/pages/api/assets/` | Asset CRUD endpoints |
| `src/pages/api/snapshots/` | Snapshot endpoints |
| `src/pages/api/exchange-rates/` | Rate fetch endpoint |
| `src/pages/api/crypto-prices/` | Crypto price endpoint |
| `src/pages/api/profile/` | User preferences endpoint |
| `src/lib/` | Utilities (db, exchange-rates, crypto-prices, net-worth, snapshot, delta) |
| `src/lib/__tests__/` | Unit tests for each lib utility (Vitest + mocked Supabase/fetch) |
| `src/pages/api/__tests__/` | API integration tests (Vitest + mocked auth/Supabase) |
| `src/components/__tests__/` | Component unit tests (Vitest + @testing-library/react) |
| `src/components/ui/` | Reusable UI primitives (card, input, select, modal, skeleton) |