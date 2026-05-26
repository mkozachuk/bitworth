# Implementation Plan: BitWorth MVP

## Context

BitWorth is a privacy-first personal net worth tracker. Auth is already implemented and wired. The dashboard is a placeholder. The Supabase schema doesn't exist. The PRD defines 20 functional requirements across auth, asset management, currency conversion, snapshots, and crypto pricing.

**Tech stack:** Astro v6 SSR + React 19 islands + Supabase + Cloudflare Workers + Tailwind v4 + Recharts + Frankfurter API (exchange rates) + CoinGecko API (crypto prices)

**Key decisions:** SQL migrations for schema, demo data in Supabase (flagged rows), Recharts for charting.

---

## Phase 1: Database Schema

- [x] Install test framework: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/node`
- [x] Create `vitest.config.ts` — `test.environment: 'jsdom'`, alias `@/` to `<rootDir>/src`, setup file for `@testing-library/jest-dom`
- [x] Add to `package.json`: `"test": "vitest"`, `"test:run": "vitest run"`
- [x] Add Vitest to `lint-staged` config for pre-commit test runs
- [x] Create `supabase/migrations/0001_initial_schema.sql` with:
  - [x] `profiles` table — extends `auth.users`, adds `display_currency` (PLN/USD/EUR, default PLN), RLS enabled
  - [x] `assets` table — `id, user_id, name, amount, currency (PLN/USD/EUR), category, is_liability, created_at, updated_at`
  - [x] **Asset categories from PRD:** Checking Account, Savings Account, Business/FOP Account, Cash on Hand, Stocks, Investment Funds, Bonds, Crypto, Precious Metals, Real Estate, Vehicles & Valuables, Loans & Credit, P2P/Loans Given (13 total)
  - [x] `snapshots` table — `id, user_id, total_net_worth, currency, snapshot_date, created_at`
  - [x] `exchange_rates` table — `currency_pair, rate, fetched_at`
  - [x] `crypto_prices` table — `symbol, price_usd, fetched_at`
  - [x] RLS policies on all tables (users see only own rows)
  - [x] Indexes on `assets(user_id)`, `snapshots(user_id)`, `snapshots(snapshot_date)`
  - [x] Auto-snapshot trigger function (fires on first login each calendar month)
- [x] Apply migration to Supabase (`supabase db push` or Studio)
- [x] Run `npx supabase gen types typescript > src/lib/database.types.ts`

---

## Phase 2: Library Utilities

- [x] `src/lib/db.ts` — typed Supabase client factory (server-side `createServerClient`)
- [x] `src/lib/exchange-rates.ts` — fetch from Frankfurter API (`api.frankfurter.app`), cache to `exchange_rates` table, fallback to cached if API fails
- [x] `src/lib/crypto-prices.ts` — fetch from CoinGecko API (free, no key), cache to `crypto_prices` table, fallback to cached if API fails
- [x] `src/lib/net-worth.ts` — `computeNetWorth(assets, rates, displayCurrency)` → `{ total: number, byCategory: Record<string, number> }`
- [x] `src/lib/snapshot.ts` — compute net worth from current assets + rates, save snapshot to DB, return snapshot ID
- [x] `src/lib/delta.ts` — compute delta between two snapshots (absolute + percentage)
- [x] **Tests:** `src/lib/__tests__/` — unit tests for each utility with mocked Supabase client and fetch calls. Covers: happy path, API failure fallback, cache miss handling, invalid input.

---

## Phase 3: API Routes

- [x] `src/pages/api/assets/index.ts` — `GET` (list), `POST` (create)
- [x] `src/pages/api/assets/[id].ts` — `PUT` (update), `DELETE`
- [x] `src/pages/api/snapshots/index.ts` — `GET` (list), `POST` (manual save)
- [x] `src/pages/api/exchange-rates/index.ts` — `GET` returns cached rates, triggers refresh if stale (>1hr)
- [x] `src/pages/api/crypto-prices/index.ts` — `GET` returns cached prices, triggers refresh if stale (>1hr)
- [x] `src/pages/api/profile/index.ts` — `PUT` (update display currency)
- [x] **Tests:** `src/pages/api/__tests__/` — API integration tests per endpoint group. Mock auth session and Supabase client. Covers: each HTTP method (GET/POST/PUT/DELETE), auth-gated routes reject unauthenticated, error responses match `{ error: { code, message, context? } }`.

All API routes must:

- Return `{ error: { code: string, message: string, context?: unknown } }` on failure
- Enforce auth (redirect to error JSON if not authenticated)
- Run on the authenticated user's data only

---

## Phase 4: React Components

### UI Primitives

- [x] `src/components/ui/card.tsx` — Card, CardHeader, CardTitle, CardContent (reusable container)
- [x] `src/components/ui/input.tsx` — text input with label + error state
- [x] `src/components/ui/select.tsx` — styled select dropdown
- [x] `src/components/ui/modal.tsx` — accessible dialog overlay
- [x] `src/components/ui/skeleton.tsx` — loading shimmer placeholder
- [x] **Tests:** `src/components/__tests__/ui/` — unit tests for each primitive via `@testing-library/react`. Covers: renders correctly, handles user interactions (focus, click), displays error/loading states.

### Dashboard Components

- [x] `src/components/dashboard/NetWorthCard.tsx` — single prominent number, delta vs last month (absolute + %), delta vs Jan 1st (absolute + %)
- [x] `src/components/dashboard/AssetList.tsx` — grouped by category, each row: name, amount+currency, edit/delete buttons (calls DELETE API on confirm)
- [x] `src/components/dashboard/AssetForm.tsx` — modal form: name, amount, currency select (PLN/USD/EUR), category select (13 categories from PRD), is_liability checkbox
- [x] `src/components/dashboard/NetWorthChart.tsx` — Recharts `LineChart`, x-axis dates, y-axis net worth in display currency, tooltips with formatted values
- [x] `src/components/dashboard/CurrencySelector.tsx` — inline select to switch display currency (PLN/USD/EUR), persists to `profiles` table
- [x] `src/components/dashboard/SnapshotButton.tsx` — "Save Snapshot" button, calls POST /api/snapshots, shows success state
- [x] `src/components/dashboard/ErrorBoundary.tsx` — React error boundary with fallback UI
- [x] `src/components/dashboard/DashboardClient.tsx` — orchestrates all dashboard components, manages loading/data/error states
- [x] `src/components/auth/AuthStatus.tsx` — shows user email, currency selector, sign-out button (for topbar)
- [x] **Tests:** `src/components/__tests__/dashboard/` — unit tests for DashboardClient via `@testing-library/react`. Covers: renders with data, loading skeleton, empty state, modal interactions, chart placeholder.

---

## Phase 5: Dashboard Page

- [x] Rewrite `src/pages/dashboard.astro` to:
  - [x] SSR-fetch: user profile, all assets, all snapshots, exchange rates
  - [x] Pass data as props to `<DashboardClient />` React island
  - [x] Compute initial net worth server-side (avoids flash of uncomputed value)
- [x] Install `recharts` package: `npm install recharts`
- [x] **Tests:** `src/pages/__tests__/dashboard.test.tsx` — page-level tests for DashboardClient with mock props. Verify renders, empty state, modal open, chart placeholder.

---

## Phase 6: Demo Mode

- [x] Add `is_demo` flag to `profiles` table + seed demo user in migration (`supabase/migrations/0002_demo_data.sql`)
- [x] Populate demo assets and snapshots for the demo user (5 assets, 12 monthly snapshots)
- [x] Update landing page (`src/components/Welcome.astro`) — add "Try Demo" button
- [x] `src/pages/demo/index.astro` — demo dashboard page, no auth required, read-only view of demo data via `DashboardClient isDemo={true}`

---

## Phase 7: Polish

- [x] `bg-cosmic` dark gradient background verified in `src/styles/global.css`
- [x] Loading skeletons render while React island hydrates (ErrorBoundary + client:load)
- [x] Error boundaries on each major component (ErrorBoundary wraps DashboardClient)
- [x] Verify: unauthenticated `/dashboard` → 302 redirect to `/auth/signin` (via middleware.ts)
- [x] Verify: sign up → redirect to dashboard → see empty state (SSR data flow)

---

## Dependencies

```bash
npm install recharts
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/node @testing-library/user-event
```

**Test commands:**

```bash
npm run test      # watch mode
npm run test:run  # single run (used in CI / pre-commit)
```

No other new packages needed — Supabase, React, Tailwind, Lucide, CVA are already installed.

---

## Verification

- [x] `npm run build` passes with no errors
- [x] `npm run lint` passes with no errors (0 errors, 93 warnings from auto-generated types)
- [x] `npm run test:run` passes with no errors (105 tests across 13 files)
- [x] Local dev: sign up, add assets across categories/currencies, see correct net worth
- [x] Local dev: switch display currency, all numbers update
- [x] Local dev: save snapshot, chart renders with new data point
- [x] Local dev: edit + delete asset, numbers update correctly
- [x] Browser DevTools: no console errors
- [x] Unauthenticated `/dashboard` → 302 redirect to `/auth/signin`

---

## Critical Files

| File                                          | Purpose                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `supabase/migrations/0001_initial_schema.sql` | All DB tables, RLS, indexes                                               |
| `supabase/migrations/0002_demo_data.sql`       | Demo user profile, assets, and snapshots                                  |
| `src/pages/dashboard.astro`                   | Main SSR dashboard page                                                   |
| `src/pages/demo/index.astro`                  | Demo dashboard page (no auth)                                             |
| `src/components/dashboard/`                   | All React dashboard components                                            |
| `src/components/auth/AuthStatus.tsx`         | User status bar (email, currency, sign-out)                               |
| `src/components/ui/`                          | Reusable UI primitives (card, input, select, modal, skeleton)            |
| `src/pages/api/assets/`                       | Asset CRUD endpoints                                                      |
| `src/pages/api/snapshots/`                    | Snapshot endpoints                                                        |
| `src/pages/api/exchange-rates/`               | Rate fetch endpoint                                                       |
| `src/pages/api/crypto-prices/`                | Crypto price endpoint                                                     |
| `src/pages/api/profile/`                      | User preferences endpoint                                                 |
| `src/lib/`                                    | Utilities (db, exchange-rates, crypto-prices, net-worth, snapshot, delta) |
| `src/lib/__tests__/`                          | Unit tests for each lib utility (Vitest + mocked Supabase/fetch)          |
| `src/pages/api/__tests__/`                    | API integration tests (Vitest + mocked auth/Supabase)                     |
| `src/components/__tests__/`                   | Component unit tests (Vitest + @testing-library/react)                    |
| `src/pages/__tests__/`                        | Page-level tests (DashboardClient with mock data)                         |