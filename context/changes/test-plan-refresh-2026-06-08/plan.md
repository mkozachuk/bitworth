# DOM Hydration & E2E on Critical UI — Implementation Plan

## Overview

Add Phase 5 to the test plan rollout: install Playwright and happy-dom, ship a DOM hydration test on the NetWorthDisplay React island, add two Playwright e2e tests (dashboard total after hydration + empty-assets snapshot path), wire e2e into CI, and update the test-plan document to close the deferred DOM test and OPEN lessons.

Source: `context/changes/test-plan-refresh-2026-06-08/change.md` — refresh brief accepted 2026-06-08.

## Current State Analysis

The test rollout has 4 completed phases: runner bootstrap (Vitest), critical-path API integration, external API failure & cache, and quality-gates wiring. 60+ test scenarios pass across 10 test files, all unit/integration, all running in Vitest with `environment: "node"`.

No DOM testing infrastructure exists — no happy-dom, no jsdom, no @testing-library/react. No Playwright or e2e infrastructure exists — no `@playwright/test`, no config, no e2e directory.

Phase 1 deferred a DOM integration test on the dashboard total to "a follow-up phase that installs DOM tooling" (`test-plan.md:64`). Two lessons are marked OPEN with no test: §6 (`(snapshot_id, asset_id)` unique constraint) and §7 (empty-assets snapshot POST creates parent row). Lessons §4 has an empty Rule/Applies to body.

### Key Discoveries:

- Dashboard renders NetWorthDisplay as a `client:load` React island (`src/pages/dashboard.astro:44-53`); the total only appears after hydration — unit tests on `computeNetWorth` don't catch hydration failures
- NetWorthDisplay computes `currentNetWorth = totalAssets - totalLiabilities` (`src/components/assets/NetWorthDisplay.tsx:137-149`) and displays it in a `<p>` with `text-4xl font-bold` styling (`:192-199`)
- Snapshot POST handler creates a parent row even when `assets.length === 0` with `total_net_worth: 0` (`src/pages/api/snapshots/index.ts:107`) — current behavior, to be pinned by the e2e test
- CI is a single job (`.github/workflows/ci.yml`) running: checkout → npm ci → astro sync → typecheck → lint → test:ci → build
- Vitest supports per-file environment override via `environmentMatchGlobs` config or inline `// @vitest-environment happy-dom` pragma
- Auth is email+password via POST to `/api/auth/signin` with form data; `/dashboard` is the only protected route (`src/middleware.ts:4`)
- Vitest include pattern (`src/**/*.test.ts`) does not match `.tsx` files — needs updating for JSX-based DOM tests
- `.gitignore` has no entries for Playwright artifacts (`test-results/`, `playwright-report/`)

## Desired End State

After this plan completes:

- A Vitest DOM test verifies that NetWorthDisplay renders the correct total for a mixed-currency asset set, catching hydration-only regressions without a browser
- A Playwright e2e verifies that the post-hydration dashboard total matches the expected value from known test assets, catching SSR/hydration mismatches in the production build
- A Playwright e2e verifies that saving a snapshot on an empty account creates a zero-value chart data point, closing OPEN lessons §6 and §7
- CI enforces the e2e gate — `npm run test:e2e` runs after unit/integration tests and before build
- Test-plan.md §3 shows Phase 5 complete, §5 shows e2e enforced, §6.3 and §6.7 document how to add e2e and DOM tests
- Lessons.md §4 has its Rule/Applies to body filled

## What We're NOT Doing

- Visual regression / Argos / Lost Pixel (§7 documents "no visual diff in this rollout")
- New abuse/security risks (§2 already covers them; no row changes without explicit user direction)
- AI-native layer (project has no AI surface)
- Rewriting §1 strategy or §2 risk map (per refresh brief hard rule)
- Adding MSW (no network mocking infrastructure needed — e2e tests hit the real app)
- Testing multiple browsers (Chromium only — 2-3 e2e tests don't justify the matrix)
- Snapshot history sorting or orphan-row tests (already covered by Phase 2 integration tests)

## Implementation Approach

Four phases, ordered by dependency:

1. **Tooling first** — install deps, create configs, add scripts. Nothing runs yet but the infrastructure is in place.
2. **DOM test** — the cheaper, faster test that runs in CI without a browser. Catches rendering bugs.
3. **E2e tests** — the full-stack tests that catch hydration and interaction bugs. Depend on Playwright config from Phase 1.
4. **CI + docs** — wire the gate and update the canonical documents. Last because it depends on all tests passing.

This order ensures each phase is independently verifiable and commits can land incrementally.

## Critical Implementation Details

### Supabase requirement for e2e

Playwright e2e tests require a reachable Supabase instance — the preview server connects to it at runtime. Locally, `supabase start` provides this with auto-confirmed users (no email verification). In CI, the same `SUPABASE_URL` and `SUPABASE_KEY` secrets already used by `npm run build` are available. The `test:e2e` step needs these env vars set so the preview server can reach Supabase.

### Auth in e2e tests

The signin API (`src/pages/api/auth/signin.ts`) expects form-encoded POST (email + password) and responds with a redirect + Set-Cookie. Playwright handles this natively — submit the form, follow the redirect, cookies are stored in the browser context. Each test creates its own user with a timestamp-based email (`test-<timestamp>@e2e.local`) to satisfy the test-independence rule from CLAUDE.md.

---

## Phase 1: Tooling & Configuration

### Overview

Install happy-dom, @testing-library/react, and @playwright/test. Create the Playwright config with a build+preview webServer. Update the Vitest config for DOM test environment and `.tsx` test discovery. Add npm scripts and gitignore entries.

### Changes Required:

#### 1. Dev dependencies

**File**: `package.json`

**Intent**: Add the three testing packages needed for DOM and e2e tests. happy-dom provides the DOM environment for Vitest; @testing-library/react provides the render/query API; @playwright/test provides the e2e framework.

**Contract**: `devDependencies` gains `happy-dom`, `@testing-library/react`, `@playwright/test`. No runtime dependencies change.

#### 2. Vitest configuration

**File**: `vitest.config.ts`

**Intent**: Enable happy-dom for DOM test files while keeping the node environment as default. Also widen the test include pattern to discover `.tsx` test files (needed for JSX-based DOM tests).

**Contract**: `test.include` changes from `["src/**/*.test.ts"]` to `["src/**/*.test.{ts,tsx}"]`. Add `environmentMatchGlobs: [["src/**/*.dom.test.tsx", "happy-dom"]]` to the `test` config. Existing `environment: "node"` stays as the default.

#### 3. Playwright configuration

**File**: `playwright.config.ts` (new)

**Intent**: Configure Playwright to test the production build of the app, with a single Chromium browser project.

**Contract**: `webServer` runs `npm run build && npm run preview` with `SUPABASE_URL` and `SUPABASE_KEY` from `process.env`. `baseURL` points to Astro's preview port (`http://localhost:4321`). `testDir` is `e2e/`. Single project: `chromium`. `retries: 0` (deterministic tests, no flake masking).

#### 4. E2e test script

**File**: `package.json`

**Intent**: Add a `test:e2e` script that runs Playwright, matching the `test:ci` pattern for the CI gate.

**Contract**: `scripts["test:e2e"]` = `"playwright test"`.

#### 5. E2e directory

**File**: `e2e/` (new directory)

**Intent**: Create the directory where Playwright test specs and helpers live.

**Contract**: `e2e/` at repo root. Playwright discovers `*.spec.ts` files here per the `testDir` config.

#### 6. Gitignore entries

**File**: `.gitignore`

**Intent**: Exclude Playwright-generated artifacts from version control.

**Contract**: Add `test-results/`, `playwright-report/`, and `blob-report/` entries.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npm run typecheck`
- Existing tests unaffected: `npm run test:ci`
- Playwright installed: `npx playwright --version`

#### Manual Verification:

- Playwright browser installs without errors: `npx playwright install chromium`
- `npm run test:e2e` reports "no test files found" (e2e/ is empty — expected)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: DOM Hydration Test

### Overview

Write a Vitest DOM test that renders NetWorthDisplay with known props in happy-dom and asserts the displayed total matches an independently computed value. This is the deferred "small integration test on the dashboard render of the total" from Phase 1 of the rollout (`test-plan.md:64`).

### Changes Required:

#### 1. NetWorthDisplay DOM test

**File**: `src/components/assets/NetWorthDisplay.dom.test.tsx` (new)

**Intent**: Verify that NetWorthDisplay renders the correct net worth total given a known set of mixed-currency assets, a liability, and exchange rates. The expected total is hand-derived (not copied from the implementation) to avoid the oracle problem documented in §2 Risk #1 response guidance.

**Contract**: Uses `@testing-library/react` `render()` + `screen` queries. Props follow the `NetWorthDisplay` interface at `src/components/assets/NetWorthDisplay.tsx:9-15`: `assets` (array of `AssetWithCategory`), `displayCurrency` (`Currency`), `rates` (`Record<Currency, number>`), `snapshots` (empty array). Test cases:

- **Mixed-currency total**: 2+ assets in different currencies plus 1 liability. Assert the rendered text contains the expected total formatted with the component's locale formatting. The expected value is independently hand-computed, not derived from `computeNetWorth`.
- **Empty assets**: Empty assets array with valid rates. Assert the total renders as zero — the same state the e2e empty-snapshot test will verify at the browser level.

Queries: `getByText` or `getAllByText` matching the formatted total + currency code. No test-ids needed — the total is the only `text-4xl` element containing the currency code.

The component imports `convertAmount` from `@/lib/exchange-rates` and `computeNetWorth` from `@/lib/net-worth` — these must resolve in the happy-dom environment. The `vite-tsconfig-paths` plugin (already in vitest.config.ts) handles `@/` alias resolution. If the component imports browser-only APIs or Astro internals that fail in happy-dom, mock them at the module boundary.

### Success Criteria:

#### Automated Verification:

- DOM test passes in test:ci: `npm run test:ci`
- TypeScript compiles: `npm run typecheck`

#### Manual Verification:

- Verify happy-dom environment active: run `npx vitest run --reporter=verbose` and confirm the DOM test file runs in `happy-dom` (not `node`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Playwright E2E Tests

### Overview

Write two Playwright e2e specs: one that loads the dashboard and asserts the hydrated total matches the expected value from known test assets, and one that saves a snapshot on an empty account and asserts a zero-value snapshot is created.

### Changes Required:

#### 1. Auth helper

**File**: `e2e/helpers/auth.ts` (new)

**Intent**: Provide a reusable function that creates a test user (unique email with timestamp suffix) via the signup API and signs them in, returning an authenticated page context. This satisfies the test-independence rule — each test gets its own user with no shared state.

**Contract**: Exports a function that takes a Playwright `Page`, signs up via POST `/api/auth/signup` (form data: email, password), then signs in via POST `/api/auth/signin`. The function navigates through the redirect flow and returns when the authenticated session is established. Email format: `test-<timestamp>@e2e.local`. Password: a fixed test-safe value. Requires local Supabase with auto-confirm enabled (the default for `supabase start`).

#### 2. Dashboard hydration e2e

**File**: `e2e/dashboard-hydration.spec.ts` (new)

**Intent**: Verify that after the React island hydrates on `/dashboard`, the visible net worth total matches the expected value computed from test assets. This catches the hydration-timing regression that the DOM test (Phase 2) and the unit test on `computeNetWorth` cannot — only a real browser with real SSR output reveals hydration mismatches.

**Contract**: The test:
1. Creates a test user and signs in via the auth helper
2. Creates 2-3 assets via POST `/api/assets` with known amounts in a single currency (display currency = USD, all amounts in USD) — avoids exchange-rate dependency in the assertion
3. Navigates to `/dashboard`
4. Waits for the net worth total to become visible (the React island hydrates and renders the `text-4xl` total)
5. Asserts the visible total text contains the expected sum of the created asset amounts
6. Cleans up: deletes created assets via the API

Locators: `page.getByText()` matching the expected total + "USD" — no CSS selectors per CLAUDE.md e2e rules. Waits: `toBeVisible()`, not `waitForTimeout()`.

#### 3. Empty-assets snapshot e2e

**File**: `e2e/empty-snapshot.spec.ts` (new)

**Intent**: Verify that a user with no assets can click "Save Snapshot" and a zero-value snapshot is created. This pins the current behavior (parent row created with `total_net_worth: 0` per `src/pages/api/snapshots/index.ts:107`) and closes OPEN lessons §6 and §7 by exercising the chart-rendering path for the empty case.

**Contract**: The test:
1. Creates a test user and signs in via the auth helper (fresh user, no assets)
2. Navigates to `/dashboard`
3. Waits for the page to render (the "Save Snapshot" button is visible)
4. Clicks the "Save Snapshot" button
5. Waits for the POST `/api/snapshots` response to confirm the save completed
6. Asserts a snapshot was created with `total_net_worth: 0` — verify via GET `/api/snapshots` or by asserting the chart area updates with a zero data point
7. Cleans up: deletes the created snapshot via the API

Locators: `page.getByRole('button', { name: /save snapshot/i })` for the save button. Waits: `waitForResponse()` on POST `/api/snapshots`, then assertions use `toBeVisible()`.

### Success Criteria:

#### Automated Verification:

- E2e specs pass: `npm run test:e2e` (requires `supabase start`)
- TypeScript compiles: `npm run typecheck`

#### Manual Verification:

- Headed run confirms correct behavior: `npx playwright test --headed`
- No stale test data remains in local Supabase after test run (check via Supabase Studio at `localhost:54323`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: CI Gate + Document Sync

### Overview

Wire Playwright into the CI workflow so the e2e gate is enforced on every PR. Then update the test-plan document (§3, §5, §6.3, §6.6, §6.7, §8) and lessons.md §4 to close out Phase 5 of the rollout. The document updates must land together per the refresh brief's hard rules.

### Changes Required:

#### 1. CI workflow — Playwright gate

**File**: `.github/workflows/ci.yml`

**Intent**: Add a Playwright browser install + e2e run step to the existing CI job, positioned after `npm run test:ci` and before `npm run build`. This enforces the e2e gate (test-plan §5: "e2e on critical flows" → enforced).

**Contract**: New steps inserted between the existing `npm run test:ci` step (line 22) and `npm run build` step (line 23):
1. Install Chromium + system deps: `npx playwright install chromium --with-deps`
2. Run e2e: `npm run test:e2e` with `SUPABASE_URL` and `SUPABASE_KEY` env vars from secrets (same secrets the build step uses)

#### 2. Test-plan §3 — Phase 5 row

**File**: `context/foundation/test-plan.md`

**Intent**: Add the Phase 5 row to the Phased Rollout table and update the surrounding prose (the "Why N phases" note and the Phase 1 deferral paragraph).

**Contract**: §3 table gains row 5: "DOM hydration & e2e on critical UI | Install Playwright; ship DOM hydration test + e2e on dashboard total and empty-assets snapshot path | #1 (DOM half), #3 (chart-rendering half) | DOM (happy-dom) + Playwright e2e | complete | `context/changes/test-plan-refresh-2026-06-08/`". Update the "Why 4 phases" paragraph to "Why 5 phases." Note in the Phase 1 deferral paragraph that Phase 5 delivered the deferred DOM test.

#### 3. Test-plan §4 — Stack table

**File**: `context/foundation/test-plan.md`

**Intent**: Update the Playwright and DOM rows in the Stack table from TBD to their installed versions.

**Contract**: Playwright row changes version from `TBD` to the installed version, notes updated. Add a new row for `happy-dom` and `@testing-library/react` under the unit+integration layer or as a separate DOM layer.

#### 4. Test-plan §5 — e2e gate enforcement

**File**: `context/foundation/test-plan.md`

**Intent**: Update the "e2e on critical flows" row from "planned" to "enforced".

**Contract**: §5 table row: `Required?` changes from `planned` to `enforced (CI gate — Phase 5)`. `Where` changes from `CI on PR` to `local + CI`.

#### 5. Test-plan §6.3 — E2e cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the TBD content with the e2e patterns established by Phase 5.

**Contract**: §6.3 documents:
- Location: `e2e/` at repo root, `*.spec.ts` naming
- Auth: per-test user via signup+signin helper at `e2e/helpers/auth.ts`; timestamp-based email for independence
- Locators: `getByRole` / `getByText` first, never CSS selectors
- Waits: `toBeVisible()`, `waitForResponse()`, never `waitForTimeout()`
- Test independence: each test creates its own user, data, and cleanup
- Reference tests: `e2e/dashboard-hydration.spec.ts`, `e2e/empty-snapshot.spec.ts`
- Run locally: `npm run test:e2e` (requires `supabase start`)

#### 6. Test-plan §6.6 — Phase 5 per-rollout note

**File**: `context/foundation/test-plan.md`

**Intent**: Add a Phase 5 per-rollout note following the pattern from Phases 2 and 3.

**Contract**: New paragraph documenting: what Phase 5 shipped (1 DOM test + 2 e2e specs), tooling installed (happy-dom, @testing-library/react, @playwright/test), the auth helper pattern, the test-independence approach (timestamp-based users), the zero-snapshot behavior pin, and lessons closed (§6 partially via chart coverage, §7 fully).

#### 7. Test-plan §6.7 — DOM/hydration cookbook (new)

**File**: `context/foundation/test-plan.md`

**Intent**: Add a new cookbook section documenting how to write DOM/hydration tests for React islands using happy-dom + RTL.

**Contract**: §6.7 "Adding a DOM/hydration test for a React island" documents:
- Location: co-located with the component, `*.dom.test.tsx` naming
- Environment: happy-dom via `environmentMatchGlobs` (automatic for `*.dom.test.tsx`)
- Render: `@testing-library/react` `render()` + `screen` queries
- Oracle rule: expected values must be independently derived, not copied from the implementation
- Reference test: `src/components/assets/NetWorthDisplay.dom.test.tsx`
- Run locally: `npm run test:run` (same runner as unit tests, different environment)

#### 8. Lessons §4 — vite-tsconfig-paths rule body

**File**: `context/foundation/lessons.md`

**Intent**: Fill in the empty Rule and Applies to fields for the vite-tsconfig-paths lesson entry (§4).

**Contract**:
- **Rule**: Always include `vite-tsconfig-paths` in `vitest.config.ts` when the project uses TypeScript path aliases (`@/*`). Vitest does not auto-resolve tsconfig paths — the plugin is required for any test that imports across directories using the `@/` prefix.
- **Applies to**: `vitest.config.ts` and any future Vitest configuration in this project. The plugin is already installed (`vite-tsconfig-paths@^5.1.4`) and configured; this rule prevents accidental removal.

#### 9. Test-plan §8 — Freshness ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Update freshness dates to reflect the Phase 5 refresh.

**Contract**: Set "Strategy (§1–§5) last reviewed", "Stack versions last verified", and "AI-native tool references last verified" to `2026-06-08`.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npm run typecheck`
- Lint passes: `npm run lint`
- Unit/integration tests pass: `npm run test:ci`
- E2e tests pass: `npm run test:e2e`

#### Manual Verification:

- Test-plan.md diff reviewed: §3 has Phase 5 row, §4 stack updated, §5 shows e2e enforced, §6.3 and §6.7 filled, §6.6 has Phase 5 note, §8 dates updated
- Lessons.md diff reviewed: §4 has Rule and Applies to filled
- Push branch and verify CI runs the full gate including test:e2e

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### DOM Tests (Vitest + happy-dom):

- NetWorthDisplay renders correct total for mixed-currency assets + liability
- NetWorthDisplay renders zero total for empty assets array

### E2E Tests (Playwright):

- Dashboard hydration: total matches expected value from known single-currency test assets
- Empty-assets snapshot: save snapshot on empty account creates zero-value data point

### Manual Testing Steps:

1. `npm run test:ci` — all existing + new DOM tests pass
2. `npm run test:e2e --headed` — visually confirm browser navigates to dashboard, total renders, snapshot saves
3. Push to feature branch — CI runs full gate including e2e
4. Review test-plan.md and lessons.md diffs for completeness

## Performance Considerations

- Playwright `webServer` uses `npm run build && npm run preview` — the build step adds ~10-15s to e2e startup. Acceptable for 2-3 tests; revisit if the e2e suite grows past ~10 specs.
- happy-dom is 2-3x faster than jsdom for DOM tests — chosen to maintain fast CI feedback per §1 principle #1 ("cheapest test that gives a real signal").
- CI runs e2e in the same job, sequentially after unit/integration. Estimated CI time increase: ~30-60s (Playwright browser install + 2-3 specs). Splitting into a parallel job is not warranted at this scale.

## References

- Refresh brief: `context/changes/test-plan-refresh-2026-06-08/change.md`
- Test plan: `context/foundation/test-plan.md`
- Lessons: `context/foundation/lessons.md`
- Dashboard island: `src/pages/dashboard.astro:44-53`
- NetWorthDisplay total: `src/components/assets/NetWorthDisplay.tsx:137-149` (computation), `:192-199` (display)
- Snapshot POST empty-assets: `src/pages/api/snapshots/index.ts:107`
- Auth signin: `src/pages/api/auth/signin.ts`
- CI workflow: `.github/workflows/ci.yml`
- Prior Phase 2 plan: `context/changes/testing-critical-path-api-integration/plan.md`
- Prior Phase 4 plan: `context/changes/testing-quality-gates-wiring/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tooling & Configuration

#### Automated

- [x] 1.1 TypeScript compiles (`npm run typecheck`) — 25a9ae3
- [x] 1.2 Existing tests unaffected (`npm run test:ci`) — 25a9ae3
- [x] 1.3 Playwright installed (`npx playwright --version`) — 25a9ae3

#### Manual

- [x] 1.4 Playwright browser installs without errors — 25a9ae3
- [x] 1.5 `npm run test:e2e` reports no test files found — 25a9ae3

### Phase 2: DOM Hydration Test

#### Automated

- [x] 2.1 DOM test passes in test:ci (`npm run test:ci`)
- [x] 2.2 TypeScript compiles (`npm run typecheck`)

#### Manual

- [x] 2.3 Verify happy-dom environment active in verbose output

### Phase 3: Playwright E2E Tests

#### Automated

- [ ] 3.1 E2e specs pass (`npm run test:e2e`)
- [ ] 3.2 TypeScript compiles (`npm run typecheck`)

#### Manual

- [ ] 3.3 Headed run confirms correct browser behavior
- [ ] 3.4 No stale test data in local Supabase after run

### Phase 4: CI Gate + Document Sync

#### Automated

- [ ] 4.1 TypeScript compiles (`npm run typecheck`)
- [ ] 4.2 Lint passes (`npm run lint`)
- [ ] 4.3 Unit/integration tests pass (`npm run test:ci`)
- [ ] 4.4 E2e tests pass (`npm run test:e2e`)

#### Manual

- [ ] 4.5 Test-plan.md §3/§4/§5/§6.3/§6.6/§6.7/§8 diffs reviewed
- [ ] 4.6 Lessons.md §4 diff reviewed
- [ ] 4.7 CI runs full gate including test:e2e on push
