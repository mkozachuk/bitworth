# Critical-path API Integration Tests — Plan Brief

> Full plan: [`context/changes/testing-critical-path-api-integration/plan.md`](plan.md)
> Research: [`context/changes/testing-critical-path-api-integration/research.md`](research.md)

## What & Why

Phase 2 of the test rollout. We protect three risks identified in `context/foundation/test-plan.md` §2 — cross-tenant authorization leaks, snapshot-history integrity, and a public API route shipping without an explicit auth decision — by adding integration tests on the existing handlers, a directory-walking contract test on every API file, and a Supabase `WITH CHECK` migration that closes the USING-only defense-in-depth gap the research surfaced. The motivation per `lessons.md` §1 and §2 is that prior incidents (orphan parent rows, inconsistent auth) went unnoticed until prod; this phase makes them build-breakers.

## Starting Point

Vitest is bootstrapped with one reference test ([`src/lib/net-worth.test.ts`](../../../src/lib/net-worth.test.ts)) from Phase 1. There are 9 API route files in `src/pages/api/`: 5 authenticated handlers duplicating the same 22-line `createClient + getUser + 401` block, 1 public-with-comment route (`rates.ts`), 3 auth endpoints, and an empty `debug/` directory. RLS is enabled on every user-owned table but the policies are `USING`-only — there is no `WITH CHECK`, so a future maintainer who adds `user_id` to an update payload would silently bypass the handler's `.eq("user_id", user.id)` filter. No tests exist on any of the API surface.

## Desired End State

A new contributor adding an unauthenticated API route fails CI on `api-auth-contract.test.ts` unless they add `supabase.auth.getUser()` or a public-route comment matching the documented regex. A future maintainer who removes `.eq("user_id", user.id)` from any of the 5 authenticated handlers, who adds `user_id` to an update payload, who breaks the snapshot POST's atomicity / sort order / `created_at`-default contract, or who runs the `(snapshot_id, asset_id)` insert path against a non-owner all fail CI on the relevant per-handler integration test. `UPDATE` on the four user-owned tables is now blocked by both the handler filter and the database `WITH CHECK` policy.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Phase structure | 3 risk-aligned phases + cookbook sync + RLS migration | Each phase ships an independently verifiable test surface; the contract test gives early signal on new routes | Plan |
| `getRates` mock | `vi.mock("@/lib/exchange-rates", ...)` | The "never mock internal modules" policy bends for one in-process helper because MSW is heavier than the problem | Research + Plan |
| Risk #2 scope | All 5 authenticated handlers (GET/POST/PUT/DELETE) | The contract test enforces auth on every route; per-handler tests should match the full surface, not just the named `/api/assets` and `/api/snapshots` | Plan |
| Empty-assets behavior | Pin current behavior, flag as a follow-up | The plan doesn't make a product call the team didn't make; the test pins so a future refactor is observable | Research + Plan |
| Test file location | Co-locate next to each handler | Matches the §6.1 convention from Phase 1; discoverable for code review | Plan |
| RLS `WITH CHECK` migration | Include as Phase 5 in this plan | Closes the USING-only gap at the database layer; handler tests pin both sides of the defense-in-depth | Plan |
| `(snapshot_id, asset_id)` uniqueness | Document in lessons.md, no test coverage | Out of risk map scope; not a test-only change without a product call | Plan |

## Scope

**In scope:**
- 1 contract test file (`api-auth-contract.test.ts`) covering 9 route files
- 5 per-handler integration test files (assets, assets/[id], categories, crypto-price, snapshots)
- 1 shared test helper (`src/test-utils/supabase-mock.ts`) for the chainable supabase mock
- ~25 named test scenarios across the three risks
- 1 Supabase migration adding `WITH CHECK` to 4 user-owned policies
- Updates to `test-plan.md` §6.2, §6.4, §6.6 and 3 new lessons in `lessons.md`

**Out of scope:**
- MSW setup (deferred; `vi.mock` is sufficient for this phase)
- The `(snapshot_id, asset_id)` unique constraint (documented, not fixed)
- Refactoring the 22-line auth block into a `requireUser()` helper (test-only phase)
- CI wiring (Phase 4 of the test plan)
- DOM integration test on the dashboard render of the net worth total (deferred from Phase 1)
- Risk #4 and #6 (external API / cache) — those are Phase 3

## Architecture / Approach

```
src/pages/api/api-auth-contract.test.ts       # Phase 1: walks the API dir
src/test-utils/supabase-mock.ts               # Phase 2: shared chainable mock factory
src/pages/api/assets/index.test.ts            # Phase 2: cross-tenant
src/pages/api/assets/[id]/index.test.ts       # Phase 2: cross-tenant + payload-shape
src/pages/api/categories/index.test.ts        # Phase 2: auth-only (global table)
src/pages/api/crypto-price.test.ts            # Phase 2: auth-only (global table)
src/pages/api/snapshots/index.test.ts         # Phases 2+3: cross-tenant + 7 POST scenarios
supabase/migrations/<ts>_rls_with_check.sql   # Phase 5: closes the USING-only gap
context/foundation/test-plan.md §6.2/§6.4/§6.6 + lessons.md   # Phase 4: cookbook
```

The chainable supabase mock is a `Proxy` whose `get` trap records every method call into a per-builder array; the array is exposed for assertions. `auth.getUser()` is gated on the `Cookie` header so the test passes a real `Request` and the handler's own auth check runs (mock at the request boundary, not the auth boundary — restated positively from `test-plan.md:43`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1 — Auth contract (Risk #5) | 1 test file, 10 `it` blocks scanning the API dir | Comment regex may miss future synonyms; mitigated by cookbook §6.2 documenting the marker vocabulary |
| 2 — Cross-tenant (Risk #2) | 5 test files + shared mock helper, ~9 scenarios | Per-handler boilerplate duplication; mitigated by the shared helper |
| 3 — Snapshot integrity (Risk #3) | 6 POST scenarios + sort-order GET assertions; the `vi.mock` exception for `getRates` | The "silent no-op" trap (scenario 4) requires careful mock state |
| 4 — Cookbook + lessons | Filled-in §6.2/§6.4/§6.6 + 3 new lessons | Drift over time; the cookbook update is the durable artifact |
| 5 — RLS `WITH CHECK` migration | 1 SQL migration, 4 policies updated | A bad policy could lock out legitimate inserts; the manual psql verification in §5.3 is the proof |

**Prerequisites:** Local Supabase running (`supabase start`); the existing Vitest setup from Phase 1; nothing else.
**Estimated effort:** 4–6 sessions across 5 phases. The contract test (Phase 1) and cookbook sync (Phase 4) are each a single session; the per-handler tests (Phases 2 + 3) are 2–3 sessions together; the migration (Phase 5) is a half-session plus manual psql verification.

## Open Risks & Assumptions

- **The `vi.mock` for `getRates` sets a precedent for mocking internal modules.** Documented as an exception in test-plan §6.2; future contributors should not generalize it without discussion.
- **The compensating-delete worst case (Phase 3, scenario 3) pins current behavior with a TODO.** The fix (Postgres function or `supabase.rpc`) is intentionally out of scope; the test makes the fix observable when it lands.
- **The 22-line auth block is duplicated 8 times across the codebase.** The contract test still works against any refactor that preserves the `getUser()` call internally, but a refactor that changes the auth pattern to a `requireUser()` helper would need the contract test to be updated to look for the helper call instead of the raw `getUser()` text. Not in scope for this phase.
- **The contract test's regex may miss future synonyms** like "no auth required." The plan commits to a small marker vocabulary; any drift is caught at the next phase that adds an endpoint.

## Success Criteria (Summary)

- `npm run test:run` exits 0 with the new contract test, the 5 per-handler integration tests, and the Phase 1 reference test all passing.
- A future maintainer who breaks any of the pinned contracts (auth check missing, `user_id` filter dropped, `user_id` in update payload, compensating delete removed, `created_at` in insert payload, sort order changed) fails CI on the relevant test.
- `WITH CHECK` policies in the local Supabase instance reject cross-user INSERTs on `assets` and `snapshot_items` while the happy path still works.
- A new contributor reading test-plan §6.2 / §6.4 / §6.6 alone can write a similar integration test for a future endpoint.
