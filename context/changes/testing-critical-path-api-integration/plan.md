# Critical-path API Integration Tests — Implementation Plan

## Overview

This change ships Phase 2 of `context/foundation/test-plan.md`. It adds integration tests for the cross-tenant and snapshot-integrity risks (Risks #2 and #3), the auth-decision contract test for Risk #5, and a Supabase RLS `WITH CHECK` migration that closes the USING-only defense-in-depth gap. The plan also updates the test-plan cookbook and lessons register with the patterns this phase establishes.

## Current State Analysis

- **Vitest is bootstrapped** ([`vitest.config.ts`](vitest.config.ts)) with the `vite-tsconfig-paths` plugin; the `@/*` alias resolves. One reference test ([`src/lib/net-worth.test.ts`](src/lib/net-worth.test.ts)) exists from Phase 1.
- **9 API route files** live under `src/pages/api/`: 5 authenticated (assets, assets/[id], categories, crypto-price, snapshots), 1 public-with-comment (rates), 3 auth-endpoints. The `debug/` directory is empty. All 5 authenticated handlers duplicate the same 22-line `createClient + getUser + 401` block.
- **RLS is enabled** on every user-owned table but the policies are `USING`-only — there is no `WITH CHECK`. The handler-side `.eq("user_id", user.id)` is the only defense against write-scope takeover on `UPDATE`.
- **The snapshot POST has an undocumented orphan worst case** ([`src/pages/api/snapshots/index.ts:156`](src/pages/api/snapshots/index.ts#L156)): if both the items insert AND the compensating delete fail, a parent row remains. The current code returns 500 either way.
- **`astro:env/server` is a Vitest blocker** ([`src/lib/supabase.ts:3`](src/lib/supabase.ts#L3)). Every per-handler integration test must `vi.mock("@/lib/supabase", ...)` because the virtual module does not resolve under Vitest.
- **The chart's defensive re-sort is load-bearing** ([`src/components/assets/NetWorthDisplay.tsx:155`](src/components/assets/NetWorthDisplay.tsx#L155)). UUIDs are not time-ordered, so the API's `.order("created_at", { ascending: true })` is a real contract.
- **`(snapshot_id, asset_id)` has no unique constraint** ([`supabase/migrations/20260529190856_initial_schema.sql:54-66`](supabase/migrations/20260529190856_initial_schema.sql#L54-L66)). Two concurrent POSTs from the same user can duplicate items.

## Desired End State

When this change ships, the following hold:

- A new contributor adding an unauthenticated API route fails CI at the `api-auth-contract.test.ts` step unless they add either `supabase.auth.getUser()` or a public-route comment matching the documented regex.
- A future maintainer who removes `.eq("user_id", user.id)` from any of the 5 authenticated handlers fails CI on the per-handler integration test for that handler.
- A future maintainer who adds `user_id` to the update payload for `/api/assets/[id]` PUT fails CI on the payload-shape assertion.
- A future maintainer who breaks the snapshot POST's atomicity, sort order, or `created_at`-default contract fails CI on one of the 7 named scenarios in `snapshots/index.test.ts`.
- `UPDATE` on the four user-owned tables is now blocked by both the handler filter AND the `WITH CHECK` policy at the database layer.

### Key Discoveries:

- The `astro:env` blocker is the only integration-test infrastructure obstacle. The contract test does not need it (only reads files). Per-handler tests need `vi.mock("@/lib/supabase", ...)`.
- The `categories` and `crypto-price` handlers authenticate but read global tables — they have no `user_id` filter. Their Risk #2 surface is "is the handler authenticated" not "is the data scoped to the user."
- `getRates` is an internal module, not a network call. The plan §6.2 "never mock internal modules" policy bends here for one helper; this exception is documented in §6.2.
- The contract test must exempt `auth/` from the "must call `auth.getUser()`" rule but positively assert that `auth/` files call `createClient` — otherwise an auth-endpoint that forgot the client entirely would be silently accepted.

## What We're NOT Doing

- Setting up MSW (mock service worker) in this phase. `getRates` is the only call that would benefit and the `vi.mock` is two lines. MSW setup is deferred to a future phase that needs multiple in-process mocks.
- Adding the `(snapshot_id, asset_id)` unique constraint. Documented in lessons.md as a known gap; pinning in a test is deferred.
- Refactoring the 22-line auth-check block into a `requireUser()` helper. Out of scope for a test-only phase; the contract test would still pass against a refactor that preserves the `getUser()` call internally.
- Wiring the new test surface into CI. Phase 4 of the test plan handles that. The tests run under the existing `npm run test:run` script.
- Adding a DOM integration test for the dashboard render of the net worth total. Deferred from Phase 1 (per test-plan §3 note) — needs `@testing-library/react` + `jsdom` or `happy-dom`, which is a separate rollout.
- Testing the `crypto_price_cache` failure paths (Risk #4, #6) — those are Phase 3.

## Implementation Approach

The plan executes as 5 phases in this order:

1. **Auth contract test (Risk #5)** — the cheapest, no `astro:env` workaround, no mock factories. Ships first because it gives immediate regression coverage on new routes.
2. **Cross-tenant integration tests (Risk #2)** — the 5 authenticated handlers, all using a shared `supabase-mock` test helper that records the chainable builder's method calls.
3. **Snapshot integrity tests (Risk #3)** — 7 named scenarios for POST plus the sort-order assertion for GET. Same test helper, plus a `vi.mock("@/lib/exchange-rates", ...)` for the rates helper.
4. **Cookbook + lessons sync** — fills in the empty §6.2, §6.4, and §6.6 sub-sections of `test-plan.md`; appends the USING-only RLS gap, `(snapshot_id, asset_id)` uniqueness gap, and the empty-assets behavior to `lessons.md`.
5. **RLS `WITH CHECK` migration** — adds `WITH CHECK (auth.uid() = user_id)` to the four user-owned policies. Closes the defense-in-depth gap that Risk #2 tests for at the handler layer.

## Critical Implementation Details

These are constraints the implementer needs to know before writing the test files. They are not derivable from file paths alone.

- **Mock at the request boundary, not the auth boundary.** The test passes a real `Request` into the handler. The handler's own `supabase.auth.getUser()` runs against the request. The mock's `auth.getUser()` returns `{user: null}` when the `Cookie` header is missing and a user when present. Varying only the URL while keeping the auth boundary mocked to "always user A" passes for both the bug (no filter) and the fix (filter present) — it proves nothing. Source: `test-plan.md:43`, restated positively here.

- **The chainable supabase mock must record every method call.** The cross-tenant assertion is `expect(recorded).toContainEqual({method: "eq", args: ["user_id", userA.id]})`. The mock is a `Proxy` whose `get` handler returns a function that pushes `{method, args}` onto a per-builder array and returns the builder. The array is exposed on the builder for assertions.

- **`vi.mock("@/lib/supabase", ...)` is per-file, not global.** Each handler test file has its own factory that returns a client scoped to that test's expectations. There is no `setupFiles` entry that pre-loads a stub — the per-file `vi.mock` is the seam.

- **The contract test walk is `fs.readdirSync`, not a `glob` dependency.** 10-line recursive walk; no `glob` install. The `auth/` directory is the only directory-level exemption. The walk handles empty subdirectories gracefully.

- **The 7th snapshot scenario (no `created_at` in insert payload) is a structural property pin, not a behavior test.** The handler should never set `created_at`; the DB default fires. The test captures the args to `from("snapshots").insert` and asserts the captured object does not have a `created_at` key. Catches a future maintainer adding a client-derived timestamp.

- **The compensating-delete worst case (scenario 3) pins current behavior with a TODO.** The test asserts the current behavior (orphan remains, 500 returned) and adds `// TODO: replace with a Postgres function or supabase.rpc wrapping both inserts`. A future fix is observable; the test fails when the fix is in.

- **`getRates` is mocked at the module boundary, not the network edge.** Plan §6.2 says "never mock internal modules." This phase bends that rule for one helper because the alternative (MSW for one in-process call) is heavier than the problem. The exception is documented in §6.2.

---

## Phase 1: Auth contract test (Risk #5)

### Overview

Ships the contract test that scans `src/pages/api/` and asserts every `.ts` file either calls `supabase.auth.getUser()` or matches the public-route comment regex. The test catches new routes that ship without an explicit auth decision. This phase does not need the `astro:env` workaround because the test only reads file contents.

### Changes Required:

#### 1. New contract test file

**File**: `src/pages/api/api-auth-contract.test.ts`

**Intent**: Walk `src/pages/api/` recursively; for each `.ts` file, assert either `supabase.auth.getUser()` is present OR the public-route comment regex matches. The `auth/` directory is exempt from the auth-or-comment rule but positively must call `createClient`. The error message names both remediation paths so a failing test tells the author exactly what to do.

**Contract**:
- Walk function: recursive `fs.readdirSync` from `join(process.cwd(), "src/pages/api")`. Yields `.ts` files only. Skips nothing.
- Auth-check string: literal `supabase.auth.getUser()` substring.
- Public-comment regex: `/\/\*?\s*(intentionally (unauthenticated|public)|public route|explicit design decision)/i` (research §Risk #5 Option A).
- Per-file `it` block: 1 sanity `it` (walk found at least one file) + 1 `it` per found file. Total expected: 10 `it` blocks (1 + 9).
- Error message template: `"File '<rel>' has neither auth check nor explicit public-route comment. Either add supabase.auth.getUser() + 401 handling, or add a comment explaining why this route is public."`
- `auth/` exemption: positive assertion `expect(src).toContain("createClient")` — an auth-endpoint that forgot the client is flagged, not silently accepted.

#### 2. Cookbook reference update

**File**: `context/foundation/test-plan.md` (in this phase, only the §6.4 stub gets a fill-in; full §6.2/§6.4/§6.6 sync is Phase 4)

**Intent**: Reference the new contract test in §6.4 so future contributors adding API endpoints know the floor that ships after this phase.

**Contract**:
- §6.4 line: "Reference test: `src/pages/api/api-auth-contract.test.ts` (Phase 2)."

### Success Criteria:

#### Automated Verification:

- `npm run test:run -- src/pages/api/api-auth-contract.test.ts` exits 0.
- The test finds 9 route files (5 authenticated + 1 public + 3 auth) and produces 1 sanity + 9 per-file = 10 `it` blocks.
- Manually temporarily deleting `supabase.auth.getUser()` from `src/pages/api/categories/index.ts` causes the relevant `it` block to fail with the documented error message.
- Manually temporarily removing the `// Rates are intentionally unauthenticated` comment from `src/pages/api/rates.ts` causes the relevant `it` block to fail with the documented error message.
- `npm run lint` exits 0 (the new file passes ESLint).

#### Manual Verification:

- The 10 `it` block titles in the Vitest reporter clearly map to file paths and the sanity check.
- The error message reads naturally and tells a new contributor exactly what to do.

**Implementation Note**: After this phase's automated checks pass, pause for manual confirmation that the test surface looks right (titles, error messages) before proceeding to Phase 2.

---

## Phase 2: Cross-tenant integration tests (Risk #2)

### Overview

Ships integration tests for the 5 authenticated handlers. Each test asserts the handler issues a query with `.eq("user_id", user.id)` (or that `user_id` is in the insert payload for POST `/api/assets`) and that an unauthenticated request returns 401. The PUT path on `/api/assets/[id]` also pins the structural property that the update payload does NOT contain `user_id` — the defense against the USING-only RLS gap.

The shared test seam is a `supabase-mock.ts` helper at `src/test-utils/`. Each handler test file's `vi.mock("@/lib/supabase", ...)` calls the factory exported from the helper. The factory returns a chainable builder that records every method call, plus an `auth.getUser()` that reads the `Cookie` header to decide whether to return a user.

### Changes Required:

#### 1. New shared test helper

**File**: `src/test-utils/supabase-mock.ts`

**Intent**: Provide a reusable factory that returns a Supabase-shaped client whose `from(table)` yields a chainable Proxy that records every method call, and whose `auth.getUser()` returns `{data: {user: ...}}` based on the `Cookie` header. The factory is the only seam — every per-handler test file uses it.

**Contract**:
- Exported function: `createSupabaseMock(opts: { userId: string; cookieToken?: string }): { client: SupabaseLike; recorded: RecordedCall[] }`.
- `from(table)` returns a Proxy. The Proxy's `get(target, prop)` returns a function that pushes `{method: prop, args}` to a per-builder `recorded` array and returns the Proxy itself (chainable). Special-cases: `then` returns `undefined` so the chain is never accidentally awaited directly; `__table` and `__recorded` are exposed as data properties.
- `auth.getUser()` returns `{data: {user: opts.userId ? {id: opts.userId} : null}, error: null}`.
- Per-table scoping: the factory exposes a `Map<tableName, builder>` so a test can assert "the chain for `from('assets').update(...).eq('id', id).eq('user_id', user.id)` was invoked" by table.
- The cookie decision happens in the calling test, not the factory. The factory takes `userId` directly; the test reads `request.headers.get("Cookie")` and chooses the userId.

**Why a helper, not per-file boilerplate**: The handler test files would otherwise each repeat ~30 lines of Proxy-magic. A helper keeps each test file focused on its scenario shape.

#### 2. New test file: assets GET/POST

**File**: `src/pages/api/assets/index.test.ts`

**Intent**: Cover the read and write paths on `/api/assets`. The read test asserts the GET handler filters by `user_id` and the write test asserts POST bakes `user_id` into the insert payload. Both assert 401 on missing cookie.

**Contract**:
- `it("GET /api/assets filters by user_id and 200s on authenticated request")`: mock factory returns user A; call the GET handler; assert recorded contains `{method: "eq", args: ["user_id", "user-A"]}`; assert response is 200.
- `it("GET /api/assets returns 401 when no Cookie")`: mock returns null user; call the GET handler; assert response is 401.
- `it("POST /api/assets bakes user_id into the insert payload")`: mock returns user A; build a multipart form; call the POST handler; assert the captured `insert(...)` arg has `user_id: "user-A"`.
- `it("POST /api/assets returns 401 when no Cookie")`: mock returns null user; call POST; assert 401.

#### 3. New test file: assets/[id] PUT/DELETE

**File**: `src/pages/api/assets/[id]/index.test.ts`

**Intent**: The compound filter (`.eq("id", id).eq("user_id", user.id)`) and the payload-shape assertion (`updates` does NOT contain `user_id`) live here. The payload assertion is the test for the USING-only RLS gap — a future maintainer who adds `user_id` to the update payload for a "transfer asset" feature fails this test.

**Contract**:
- `it("PUT /api/assets/[id] uses a compound id+user_id filter")`: mock returns user A; build form; call PUT with `params: {id: "asset-b"}`; assert recorded chain contains both `{method: "eq", args: ["id", "asset-b"]}` and `{method: "eq", args: ["user_id", "user-A"]}` in that order.
- `it("PUT /api/assets/[id] update payload does NOT contain user_id")`: same setup; capture the `update(...)` arg; assert the captured object does NOT have a `user_id` key. **This is the structural-property pin for the USING-only RLS gap.**
- `it("PUT /api/assets/[id] returns 404 when the row doesn't match (not 403)")`: mock returns a single() that resolves to `{data: null, error: null}`; assert response is 404. Matches the current handler's `!data` branch.
- `it("PUT /api/assets/[id] returns 401 when no Cookie")`: mock returns null user; assert 401.
- `it("DELETE /api/assets/[id] uses a compound id+user_id filter")`: same as PUT but for DELETE.
- `it("DELETE /api/assets/[id] returns 404 when no match")`: same as PUT.
- `it("DELETE /api/assets/[id] returns 401 when no Cookie")`: same as PUT.

#### 4. New test file: categories GET

**File**: `src/pages/api/categories/index.test.ts`

**Intent**: Categories reads the global `asset_categories` table — there is no `user_id` column to filter on. The cross-tenant risk for this handler is "did the handler authenticate at all?" The contract test (Phase 1) catches the static pattern; this test catches the runtime case.

**Contract**:
- `it("GET /api/categories returns 401 when no Cookie")`: mock returns null user; assert 401.
- `it("GET /api/categories returns the categories on authenticated request")`: mock returns user A; mock `from("asset_categories").select(...)` to resolve to a fixed array; assert 200 with the array.
- No `user_id` filter assertion — the table has no `user_id` column.

#### 5. New test file: crypto-price GET

**File**: `src/pages/api/crypto-price.test.ts`

**Intent**: Same shape as categories — global table (`crypto_price_cache`), auth check is the only per-user gate.

**Contract**:
- `it("GET /api/crypto-price returns 401 when no Cookie")`.
- `it("GET /api/crypto-price returns the cached price on authenticated request")`.
- No `user_id` filter assertion.

#### 6. New test file: snapshots GET (filter assertion only)

**File**: `src/pages/api/snapshots/index.test.ts` (extended in Phase 3)

**Intent**: The snapshots GET handler is the only read path with both a `user_id` filter (Risk #2) and a sort order (Risk #3). Phase 2 ships the filter assertion; Phase 3 extends the same file with the sort-order assertion and the 7 POST scenarios.

**Contract**:
- `it("GET /api/snapshots filters by user_id")`: mock returns user A; assert recorded contains `{method: "eq", args: ["user_id", "user-A"]}`.
- `it("GET /api/snapshots returns 401 when no Cookie")`.

### Success Criteria:

#### Automated Verification:

- `npm run test:run` exits 0 with all 5 new test files discovered under `src/pages/api/`.
- Each test file has at least 2 `it` blocks; the assets/[id] file has 7.
- Manually temporarily deleting `.eq("user_id", user.id)` from `src/pages/api/assets/[id]/index.ts:153` causes the relevant DELETE test to fail.
- Manually adding `user_id: "user-B"` to the `updates` object in `src/pages/api/assets/[id]/index.ts:55-77` causes the PUT payload-shape test to fail.
- `npm run lint` exits 0.

#### Manual Verification:

- The test output is readable: each test title names the handler and the scenario.
- The `supabase-mock` helper lives in one place (`src/test-utils/supabase-mock.ts`). Contract amended: 146 lines shipped, larger than the original <80 budget because the helper carries Phase 3 features (per-table result queues, setTableResultQueue) that turned out to be needed by the snapshot POST scenarios. Inlining them into the consumer would have duplicated logic across the 7 scenarios.

**Implementation Note**: After this phase's automated checks pass, pause for manual confirmation that the helper shape and the per-handler test titles are right before Phase 3.

---

## Phase 3: Snapshot integrity tests (Risk #3)

### Overview

Extends `src/pages/api/snapshots/index.test.ts` (started in Phase 2) with the 7 named scenarios for the snapshot POST handler and the sort-order assertion for the GET handler. The 7 scenarios cover the happy path, the compensating-delete success path, the lesson §1 worst case (orphan pin), the silent-no-op trap, the sort-order contract, the empty-assets behavior, and the structural property that the insert payload does NOT contain `created_at`.

The phase bends the "never mock internal modules" policy for `getRates`. The exception is documented in test-plan §6.2 in Phase 4.

### Changes Required:

#### 1. Add POST scenarios to snapshots test file

**File**: `src/pages/api/snapshots/index.test.ts` (Phase 3 addition; Phase 2 wrote the GET-filter tests)

**Intent**: The 7 named scenarios from the research §3 test scenarios table. Each is a `describe`-block or top-level `it` named exactly as in the table for traceability.

**Contract**: For each scenario, the test sets up the supabase mock with the per-scenario state (e.g., `from("snapshot_items").insert` returns `{error: ...}` for scenario 2), calls the POST handler, and asserts the response + the captured chain.

- `it("POST /api/snapshots happy path: 2 assets, both inserts succeed")`: 2 assets fetched; both insert branches resolve with no error; assert 201; assert the captured `from("snapshot_items").insert(...)` arg is a 2-element array.
- `it("POST /api/snapshots items insert fails, compensating delete succeeds")`: items insert returns error; snapshots delete returns no error; assert 500; assert the captured `from("snapshots").delete().eq("id", snapshot.id)` chain was invoked.
- `it("POST /api/snapshots items insert fails AND compensating delete fails (lesson §1 worst case)")`: both return errors; assert 500; **pin the orphan**: the test asserts the current behavior (handler returns 500, no compensation happens). Add a `// TODO: replace with a Postgres function or supabase.rpc wrapping both inserts` comment in the test.
- `it("POST /api/snapshots items insert silently no-ops (error: null but no rows)")`: stub returns `{error: null, data: []}`; assert 201; assert the compensating-delete branch was NOT entered (no `delete().eq("id", ...)` captured).
- `it("POST /api/snapshots empty assets: parent row created with total_net_worth: 0")`: `from("assets").select(...)` returns `[]`; assert 201; assert parent row in response has `total_net_worth: 0`; assert NO `from("snapshot_items").insert(...)` was called.
- `it("POST /api/snapshots insert payload does NOT include created_at")`: capture the arg to `from("snapshots").insert(...)`; assert the captured object does NOT have a `created_at` key. **Structural-property pin for the DB-default contract.**

#### 2. Add `vi.mock` for `getRates` at the top of the snapshots test file

**File**: `src/pages/api/snapshots/index.test.ts`

**Intent**: The snapshot POST handler calls `getRates(supabase)` at line 95. The mock for `supabase` doesn't include this helper (it's a module-level import). The test must stub the helper directly.

**Contract**:
- At the top of the file: `vi.mock("@/lib/exchange-rates", () => ({ getRates: async () => ({ USD: 1, EUR: 1, PLN: 1 }) }))`.
- Comment block above the `vi.mock` calls out: "This bends the test-plan §6.2 'never mock internal modules' policy for one helper. The alternative (MSW against `crypto_price_cache`) is heavier than the problem. The exception is documented in test-plan §6.2."

#### 3. Add sort-order assertion to GET handler

**File**: `src/pages/api/snapshots/index.test.ts` (Phase 3 addition to Phase 2's GET-filter tests)

**Intent**: The chart's "newest" assumption depends on the API returning rows in `created_at` ascending order. UUIDs are not time-ordered, so the API's `.order("created_at", { ascending: true })` is a real contract.

**Contract**:
- `it("GET /api/snapshots returns rows ordered by created_at ascending")`: mock `from("snapshots").select(...).order(...)` to resolve with rows whose `created_at` values are `2024-01-01`, `2024-02-01`, `2023-12-01` in that insertion order; assert the response data is `[2023-12-01, 2024-01-01, 2024-02-01]` (chronological, not insertion order).
- `it("GET /api/snapshots chain includes .order('created_at', { ascending: true })")`: assert the recorded chain contains `{method: "order", args: ["created_at", { ascending: true }]}`. Pins the structural property that the API is doing the sort, not relying on the client.

### Success Criteria:

#### Automated Verification:

- `npm run test:run -- src/pages/api/snapshots/index.test.ts` exits 0 with 6 GET-related `it` blocks (2 from Phase 2 + 2 sort-order from Phase 3) and 6 POST `it` blocks (the 7 scenarios minus the sort-order which is on GET, or organized as 7 POST + 1 sort = 8).
- Manually temporarily removing `.order("created_at", { ascending: true })` from `src/pages/api/snapshots/index.ts:35` causes the sort-order structural test to fail.
- Manually temporarily removing the compensating delete at `src/pages/api/snapshots/index.ts:156` causes the "items insert fails, compensating delete succeeds" scenario to fail.
- Manually temporarily adding `created_at: new Date().toISOString()` to the snapshots insert payload at line 113-119 causes the "insert payload does NOT include created_at" test to fail.
- `npm run lint` exits 0.

#### Manual Verification:

- The 7 POST scenarios read as a coherent table when listed in the Vitest reporter output.
- The `// TODO: replace with a Postgres function` comment is visible in scenario 3 so a future maintainer sees the intent.

**Implementation Note**: After this phase's automated checks pass, pause for manual confirmation before Phase 4 (the cookbook sync is mostly mechanical but worth a review).

---

## Phase 4: Cookbook + lessons sync

### Overview

Updates `context/foundation/test-plan.md` and `context/foundation/lessons.md` with the patterns and known gaps this phase established. Phase 4 is the durable artifact that lets future contributors write similar tests without re-deriving the shape from research.

### Changes Required:

#### 1. Update test-plan.md §6.2 (Adding an integration test)

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in the TBDs that Phase 1 left for §6.2 — location, mocking policy, reference test, run command.

**Contract**:
- **Location**: co-located with the handler under test. Test file is `<handler-path>/index.test.ts` (e.g., `src/pages/api/assets/index.test.ts`). The contract test is the exception: `src/pages/api/api-auth-contract.test.ts` because the surface under audit is the directory itself.
- **Mocking policy**: Mock at the request boundary. The test passes a real `Request` to the handler. The handler's own `supabase.auth.getUser()` runs against the request; the mock for `createClient` returns a client whose `auth.getUser()` returns `{user: null}` when the `Cookie` header is missing. **Documented exception**: `getRates` is mocked via `vi.mock("@/lib/exchange-rates", ...)` because it is an in-process helper. The "never mock internal modules" rule bends here for one helper; MSW setup is overkill.
- **`vi.mock("@/lib/supabase", ...)` is per-file boilerplate** because `src/lib/supabase.ts` imports from `astro:env/server`, which is a virtual module that does not resolve under Vitest. The shared factory lives at `src/test-utils/supabase-mock.ts`.
- **Reference test**: `src/pages/api/snapshots/index.test.ts` — the 7-scenario snapshot POST pattern.
- **Run locally**: `npm run test:run` (one-shot) or `npm run test` (watch). No env vars required.

#### 2. Update test-plan.md §6.4 (Adding a test for a new API endpoint)

**File**: `context/foundation/test-plan.md`

**Intent**: Update the TBD pattern with the contract test as the floor and the per-handler integration test as the ceiling.

**Contract**:
- **Floor**: `src/pages/api/api-auth-contract.test.ts` (Phase 2) — every new route gets caught by the directory walk.
- **Ceiling**: per-handler integration test in `<handler-path>/index.test.ts`, using `src/test-utils/supabase-mock.ts`.

#### 3. Update test-plan.md §6.6 (Per-rollout-phase notes)

**File**: `context/foundation/test-plan.md`

**Intent**: Append a Phase 2 entry under §6.6 with the test files and patterns that shipped.

**Contract**:
- Phase 2 entry: "Critical-path API integration — 5 per-handler integration tests (Risks #2, #3) + 1 directory-walking contract test (Risk #5). Shared test seam at `src/test-utils/supabase-mock.ts`. Documented `vi.mock` exception for `@/lib/exchange-rates` in §6.2. RLS `WITH CHECK` migration shipped under `supabase/migrations/<timestamp>_rls_with_check.sql`."

#### 4. Append new lessons to lessons.md

**File**: `context/foundation/lessons.md`

**Intent**: Three new lessons that the test surface pins: USING-only RLS gap, `(snapshot_id, asset_id)` uniqueness gap, and the empty-assets behavior. The first is closed by Phase 5's migration; the second and third are flagged as open.

**Contract**:
- New lesson "RLS USING-only is not enough for write-scope isolation" — cites the `USING`-only policies in the initial schema; explains the gap; cross-references the Phase 5 migration that closes it. Mark the lesson with a `Closed: Phase 5` note.
- New lesson "`(snapshot_id, asset_id)` has no unique constraint" — cites the initial schema; explains the concurrent-POST duplicate scenario; mark `Open` and note that no test pins it.
- New lesson "Empty-assets on snapshot POST still creates a parent row" — cites `src/pages/api/snapshots/index.ts:140`; mark `Open — product question`.

### Success Criteria:

#### Automated Verification:

- `npm run test:run` exits 0 (no test files were added in this phase; this catches accidental drift).
- `npm run lint` exits 0.
- `grep -n "TBD — see §3 Phase 2" context/foundation/test-plan.md` returns no matches (all Phase 2 TBDs are filled in).

#### Manual Verification:

- A new contributor reading §6.2, §6.4, and §6.6 has enough to write a similar integration test without reading the research doc.
- The three new lessons each cite the file:line they reference and mark their state (closed / open).

---

## Phase 5: RLS `WITH CHECK` migration

### Overview

Closes the USING-only RLS gap identified by the research. Adds `WITH CHECK (auth.uid() = user_id)` to the four user-owned policies (`user_preferences`, `assets`, `snapshots`, `snapshot_items`). The Phase 2 handler tests already pin the handler-side defense; this migration adds the database-side defense so a future maintainer who removes the handler filter still hits a policy violation instead of silently bypassing auth.

### Changes Required:

#### 1. New Supabase migration

**File**: `supabase/migrations/<timestamp>_rls_with_check.sql`

**Intent**: A new migration that drops and recreates the four user-owned policies with both `USING` and `WITH CHECK` clauses. The pattern is `CREATE POLICY "<name>" ON <table> FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`.

**Contract**:
- Migration filename: `supabase/migrations/<YYYYMMDDHHMMSS>_rls_with_check.sql` (timestamp must be after the last existing migration; check the directory first).
- Body: 4 `DROP POLICY` + 4 `CREATE POLICY` statements for `user_preferences`, `assets`, `snapshots`, `snapshot_items`.
- `snapshot_items` policy: `USING (snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid()))` and `WITH CHECK (snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid()))`. The `WITH CHECK` on `snapshot_items` requires the new snapshot's parent to be owned by the caller — a future maintainer who inserts items with a foreign `snapshot_id` belonging to another user fails the policy.
- No `WITH CHECK` on the global tables (`asset_categories`, `exchange_rate_cache`, `crypto_price_cache`) — they are read-public or unowned.

#### 2. Verify migration applies cleanly

**File**: (no file — local Supabase is run via `supabase start` per CLAUDE.md)

**Intent**: Confirm the migration applies against the local Supabase instance without error.

**Contract**:
- `npx supabase db reset` (or equivalent local migration apply) exits 0.
- After reset, a manual `psql` query on `pg_policies` shows the four updated policies with `with_check` populated.

### Success Criteria:

#### Automated Verification:

- `npm run build` exits 0 (Astro build does not bundle migrations, but the build is a smoke test that nothing else broke).
- `npm run lint` exits 0.

#### Manual Verification:

- Manually in `psql`: `INSERT INTO assets (id, user_id, name, amount, currency, category_id) VALUES (gen_random_uuid(), '<other-user-id>', 'evil', 1, 'USD', '<valid-cat-id>')` returns a policy violation error.
- Manually: `INSERT INTO snapshot_items (snapshot_id, category_id, name, original_amount, original_currency, converted_amount, display_currency, exchange_rate_usd, display_order) VALUES ('<other-user-snapshot-id>', ...)` returns a policy violation error.
- The local dashboard at `http://localhost:54323` shows the same assets as before for the current user (no regressions on the happy path).

**Implementation Note**: After this phase's automated checks pass, pause for the manual psql verification — the policy violation tests are the proof that the migration closes the gap.

---

## Testing Strategy

### Unit Tests:

- This phase ships integration + contract tests, not unit tests. Unit tests on pure modules (like the net worth calculation) remain in `src/lib/<module>.test.ts` per §6.1.

### Integration Tests:

- Per-handler tests under `src/pages/api/**/index.test.ts`. Shared mock factory at `src/test-utils/supabase-mock.ts`. Each test passes a real `Request`; the handler's own `auth.getUser()` runs against the request.
- Total scenarios this phase ships: ~25 (10 contract + ~9 cross-tenant + ~6 snapshot POST + sort-order + payload-shape).

### Manual Testing Steps:

1. After Phase 1: Run `npm run test:run` and verify the 10 contract `it` blocks are visible with the right titles.
2. After Phase 2: Manually remove `.eq("user_id", user.id)` from one handler; verify the relevant test fails; restore; verify it passes.
3. After Phase 3: Manually break the compensating delete (remove the `await supabase.from("snapshots").delete()...` line); verify scenario 2 fails; restore; verify it passes.
4. After Phase 4: Skim test-plan.md §6.2/§6.4/§6.6 and lessons.md to confirm a future contributor could write a similar test from those sections alone.
5. After Phase 5: Run the psql INSERT attempts against the local Supabase instance; verify policy violations; verify the dashboard still loads for the current user.

## Performance Considerations

- The contract test walks the API directory once per test run. With 9 files, the walk is <1ms. No optimization needed.
- The per-handler tests use Proxy-based mock factories. The chainable builder's `get` trap fires once per method call. With 5-7 recorded calls per scenario and ~20 scenarios, the overhead is <10ms total. No optimization needed.
- The migration in Phase 5 is a DDL change, not a runtime cost. No performance consideration.

## Migration Notes

- **Phase 5 only.** The migration adds `WITH CHECK` clauses; existing rows are unaffected because the policies are row-visibility, not row-validation, for SELECT. INSERT/UPDATE on existing data validates against the new `WITH CHECK` — for the codebase as it exists, the handler bakes `user_id` into the insert payload, so no existing insert path would violate the new policy.
- **Rollback**: a follow-up migration can `DROP POLICY` and recreate without `WITH CHECK`. Plan does not pre-write the rollback; the migration is small and re-creatable.

## References

- Related research: [`context/changes/testing-critical-path-api-integration/research.md`](research.md)
- Related plan: [`context/changes/testing-runner-bootstrap/plan.md`](../testing-runner-bootstrap/plan.md) (Phase 1, sets the Vitest + co-location convention)
- Source of truth for risk coverage: [`context/foundation/test-plan.md` §2](../../foundation/test-plan.md)
- Lessons this plan extends: [`context/foundation/lessons.md`](../../foundation/lessons.md) §1, §2

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auth contract test (Risk #5)

#### Automated

- [x] 1.1 `npm run test:run -- src/pages/api/api-auth-contract.test.ts` exits 0 — e38526a
- [x] 1.2 The test finds 9 route files and produces 10 `it` blocks — e38526a
- [x] 1.3 Manually deleting `supabase.auth.getUser()` from `categories/index.ts` causes the relevant `it` to fail — e38526a
- [x] 1.4 Manually removing the public-route comment from `rates.ts` causes the relevant `it` to fail — e38526a
- [x] 1.5 `npm run lint` exits 0 — e38526a

#### Manual

- [x] 1.6 The 10 `it` block titles in the Vitest reporter clearly map to file paths — 13e054a
- [x] 1.7 The error message reads naturally and tells a new contributor exactly what to do — 13e054a

### Phase 2: Cross-tenant integration tests (Risk #2)

#### Automated

- [x] 2.1 `npm run test:run` exits 0 with all 5 new test files discovered — d982c79
- [x] 2.2 Each test file has the right number of `it` blocks (assets/[id] has 7) — d982c79
- [x] 2.5 `npm run lint` exits 0 — d982c79

#### Manual

- [x] 2.3 Manually deleting `.eq("user_id", user.id)` from `assets/[id]/index.ts:153` causes the DELETE test to fail — d982c79
- [x] 2.4 Manually adding `user_id: "user-B"` to the `updates` object causes the PUT payload-shape test to fail — d982c79
- [x] 2.6 The test output is readable; each test title names the handler and the scenario — d982c79
- [x] 2.7 The `supabase-mock` helper lives in one place (`src/test-utils/supabase-mock.ts`). Contract amended: 146 lines shipped, larger than the original <80 budget because the helper carries Phase 3 features (per-table result queues, setTableResultQueue) that turned out to be needed by the snapshot POST scenarios. Inlining them into the consumer would have duplicated logic across the 7 scenarios. — d982c79

### Phase 3: Snapshot integrity tests (Risk #3)

#### Automated

- [x] 3.1 `npm run test:run -- src/pages/api/snapshots/index.test.ts` exits 0
- [x] 3.2 The file has the right number of `it` blocks (GET: 2 from Phase 2 + 2 sort-order; POST: 6)
- [x] 3.6 `npm run lint` exits 0

#### Manual

- [x] 3.3 Manually removing `.order("created_at", ...)` causes the sort-order structural test to fail
- [x] 3.4 Manually removing the compensating delete at `snapshots/index.ts:156` causes scenario 2 to fail
- [x] 3.5 Manually adding `created_at` to the insert payload causes the structural-property test to fail
- [x] 3.7 The 7 POST scenarios read as a coherent table in the Vitest reporter
- [x] 3.8 The `// TODO: replace with a Postgres function` comment is visible in scenario 3

### Phase 4: Cookbook + lessons sync

#### Automated

- [x] 4.1 `npm run test:run` exits 0
- [x] 4.2 `npm run lint` exits 0
- [x] 4.3 `grep -n "TBD — see §3 Phase 2" context/foundation/test-plan.md` returns no matches

#### Manual

- [ ] 4.4 A new contributor can write a similar integration test from §6.2 / §6.4 / §6.6 alone
- [ ] 4.5 The three new lessons each cite file:line and mark their state (closed / open)

### Phase 5: RLS WITH CHECK migration

#### Automated

- [x] 5.1 `npm run build` exits 0
- [x] 5.2 `npm run lint` exits 0

#### Manual

- [ ] 5.3 `psql` INSERT with a foreign `user_id` returns a policy violation error
- [ ] 5.4 `psql` INSERT with a foreign `snapshot_id` on `snapshot_items` returns a policy violation error
- [ ] 5.5 The local dashboard at `http://localhost:54323` still loads the current user's assets
