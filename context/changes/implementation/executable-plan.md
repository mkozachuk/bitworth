# Plan: Multi-Agent Implementation of BitWorth MVP

## Context

The BitWorth MVP implementation plan is defined in `context/changes/implementation/implementation-plan.md`. Auth is complete, the dashboard is a placeholder, the database schema doesn't exist, and 20 functional requirements span 7 phases. We need to implement everything using 4 subagents (Architect, Developer, Tester, Business Analyst) with a verification-and-feedback loop.

**All changes are provided and verified on local setup only.** Production deployment is out of scope — everything runs locally via `npm run dev` with a local Supabase instance (`supabase start` via Docker).

## Agent Roles & Workflow

Each phase is implemented in a sequential verification loop per feature:

```
Developer writes code
  → Architect reviews design/architecture (spawned Agent, general-purpose)
    → Business Analyst verifies requirements coverage (spawned Agent, general-purpose)
      → Tester verifies correctness + writes tests (spawned Agent, general-purpose)
        → If any agent flags issues → Developer fixes → loop repeats until approved
```

**Key constraint:** Subagents run sequentially (foreground) per phase — parallel subagents on the same file would cause conflicts. Independent phases can run in parallel. Each spawned agent receives the full implementation context and the specific phase's requirements as input.

**Test framework:** Vitest + @testing-library/react. Every feature must have unit tests written alongside the implementation. Tests use mocks for Supabase client and external API calls (fetch). Test files live next to the code they test (e.g. `src/lib/__tests__/net-worth.test.ts`). All tests must pass before a phase is considered complete.

---

## Phase 1: Database Schema

**Developer first.** Run with: full schema requirements from implementation-plan.md Phase 1.

**Deliverable:** `supabase/migrations/0001_initial_schema.sql`

**Tests:** Migration syntax and RLS policy smoke test via `supabase db diff --dry-run` (no unit tests needed for SQL schema — verified by running the migration against local Supabase).

Once Developer completes, sequential passes:

- **Architect** reviews: table design, RLS policies, index choices, trigger logic
- **BA** verifies: all 5 tables present, 12 asset categories from PRD covered, RLS correct
- **Tester** verifies: migration runs without error, RLS enforces isolation

**Parallelization:** Phases 2–7 are blocked on Phase 1 (no DB → no lib, no API, no UI). After Phase 1, Phases 2 and 3 can run in parallel (lib utilities vs API routes are independent).

---

## Phase 2: Library Utilities (can run parallel with Phase 3)

**Developer** writes all 6 utility files in `src/lib/`:

- `db.ts` — typed Supabase server client (reuse `createClient` from existing `lib/supabase.ts`)
- `exchange-rates.ts` — Frankfurter API, cache to `exchange_rates` table
- `crypto-prices.ts` — CoinGecko API, cache to `crypto_prices` table
- `net-worth.ts` — compute net worth (convert all assets to display currency)
- `snapshot.ts` — save snapshot to DB
- `delta.ts` — compute delta between two snapshots

**Architect** reviews: each utility's API surface, error handling, cache invalidation logic
**BA** verifies: all currency pairs handled, fallback behavior documented
**Tester** verifies: each utility with unit tests (mock Supabase responses via Vitest)

**Tests:** `src/lib/__tests__/` — one test file per utility. Mock Supabase client (`vi.mock` on `~/lib/db`) and fetch calls. Covers: happy path, API failure fallback to cached data, cache miss fallback, invalid input handling.

---

## Phase 3: API Routes (can run parallel with Phase 2)

**Developer** writes all API endpoints in `src/pages/api/`:

- `assets/index.ts` — GET + POST
- `assets/[id].ts` — PUT + DELETE
- `snapshots/index.ts` — GET + POST
- `exchange-rates/index.ts` — GET (cached, triggers refresh if stale)
- `crypto-prices/index.ts` — GET (cached, triggers refresh if stale)
- `profile/index.ts` — PUT (update display currency)

**Architect** reviews: route structure, auth enforcement pattern, error shape (must be `{ error: { code, message, context? } }`)
**BA** verifies: all 7 endpoints covered, each enforces auth on user data only
**Tester** verifies: each endpoint with API tests (mock auth, exercise each method)

**Tests:** `src/pages/api/__tests__/` — one test file per endpoint group (assets, snapshots, exchange-rates, crypto-prices, profile). Mock auth session via `vi.mock('~/lib/supabase')` and Supabase client. Covers: GET returns correct shape, POST creates resource, PUT updates, DELETE removes, auth-gated routes reject unauthenticated requests, error responses match `{ error: { code, message, context? } }` shape.

---

## Phase 4: React Components (blocked on Phases 1–3)

Split into two parallel tracks once Phase 3 is done:

**Track A (UI Primitives) — Developer writes:**

- `src/components/ui/card.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/modal.tsx`
- `src/components/ui/skeleton.tsx`

**Track B (Dashboard Components) — Developer writes:**

- `NetWorthCard.tsx`, `AssetList.tsx`, `AssetForm.tsx`, `NetWorthChart.tsx`
- `CurrencySelector.tsx`, `SnapshotButton.tsx`, `ErrorBoundary.tsx`
- `DashboardClient.tsx`, `AuthStatus.tsx`

Sequential passes after each track:

- **Architect** reviews: component APIs, prop types, integration with recharts
- **BA** verifies: all 7 dashboard components present, all 12 asset categories in form
- **Tester** verifies: components render, modal opens/closes, chart renders with mock data

**Tests:** `src/components/__tests__/` — one test file per component. Uses `@testing-library/react` for DOM testing with mock props. Covers: component renders with valid props, shows correct data, handles empty/loading/error states, modal opens/closes, chart renders with mock data via Recharts mock.

---

## Phase 5: Dashboard Page (blocked on Phase 4)

**Developer** rewrites `src/pages/dashboard.astro` and installs `recharts`.

Sequential passes:

- **Architect** reviews: SSR data flow, prop passing to React island
- **BA** verifies: page shows all data from SSR, no client-side fetching waterfall
- **Tester** verifies: page renders with real data, skeleton shows during hydration

**Tests:** `src/pages/__tests__/` — page-level tests for `dashboard.astro` SSR output. Verify page renders, passes correct props to DashboardClient, handles unauthenticated redirect.

---

## Phase 6: Demo Mode (nice-to-have, after Phase 5)

Sequential loop: Developer → Architect → BA → Tester.

---

## Phase 7: Polish

Sequential loop: Developer → Architect → BA → Tester.

---

## Orchestration Model

**Developer = main agent (me).** I write the code and coordinate the loop.
**Architect, BA, Tester = spawned general-purpose agents.** Each spawned agent receives full context (implementation plan + code output) and returns a structured review with a pass/fail verdict and specific fix requests.

**Feedback loop pattern:**

```
Developer writes code
  → Spawn Architect agent → if issues: Developer fixes → Architect re-reviews
  → Architect approved → Spawn BA agent → if issues: Developer fixes → BA re-reviews
  → BA approved → Spawn Tester agent → if issues: Developer fixes → Tester re-reviews
  → All approved → phase complete
```

**Fix priority:** Architect (structural) > BA (requirements) > Tester (correctness). Issues are routed back to Developer with specific fix instructions.

---

## Phase Execution Order

```
Phase 1 (Schema)        → sequential loop [Dev→Arch→BA→Tester]
   ↓
Phases 2 + 3 (parallel) → each has own sequential loop
   ↓
Phase 4 (Components)    → parallel tracks A+B, each with sequential loop
   ↓
Phase 5 (Dashboard)     → sequential loop
   ↓
Phase 6 (Demo)          → sequential loop
   ↓
Phase 7 (Polish)        → sequential loop
   ↓
Final verification      → run build, lint, smoke test
```

---

## Verification

After all phases:

- `npm run build` passes
- `npm run lint` passes
- `npm run test:run` passes (all Vitest tests green)
- Auth flow: sign up → dashboard (empty state) → add assets → see net worth
- Currency switch updates all numbers
- Save snapshot → chart renders new point
- Edit/delete asset updates numbers
- Browser DevTools: no console errors
- Unauthenticated `/dashboard` → 302 to `/auth/signin`
