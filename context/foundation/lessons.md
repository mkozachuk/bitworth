# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## DB multi-table writes must be atomic

**Context**: src/pages/api/snapshots/index.ts — POST handler inserts a parent `snapshots` row, then inserts `snapshot_items` rows in a separate operation. No transaction wraps both.

**Problem**: If the second insert fails, the parent row is already committed — orphan row, no rollback, no compensating delete. Same-table operations succeeded; cross-table operation silently left dangling data.

**Rule**: Always wrap multi-table write sequences in a single atomic transaction or batch insert.

**Applies to**: API handlers doing sequential dependent inserts across related tables.

## Public API endpoints need explicit auth decisions

**Context**: src/pages/api/rates.ts — `GET /api/rates` does not call `supabase.auth.getUser()` to verify the session, unlike every other API route in the project.

**Problem**: Inconsistent auth pattern across the API surface. An unauthenticated request with valid env vars bypasses the check by default. Practical risk is low for rates (public financial data), but the inconsistency means any future public endpoint that skips auth will look intentional when it may be an oversight.

**Rule**: Every API route must either enforce auth or explicitly document why it's public.

**Applies to**: All new API routes added to src/pages/api/.

## Currency cast boundary

**Context**: src/lib/net-worth.ts — `convertAmount(fromCurrency: Currency, ...)`. The `Currency` literal union is canonical in src/lib/exchange-rates.ts.

**Problem**: Supabase types `Tables<'assets'>['currency']` as `string` (the SQL column is `text`). The helper needs a `Currency` for the rate lookup, so every call site reads a row and writes `asset.currency as Currency` — 7 casts across 4 files at last count. Broadening the parameter to accept `string` would push the unsafe narrowing into the helper; rejecting the call-site cast and switching to a Zod parse would push the runtime cost onto every call. The current shape is type-honest at the boundary and unsafe at the call site.

**Rule**: Keep `convertAmount` typed as `Currency`. The call-site `as Currency` casts are the agreed compromise — do not silently widen the helper. If a future column changes its Supabase type (e.g. to a Postgres enum), revisit and remove the casts.

**Applies to**: Any helper that needs a `Currency` parameter and is called with `Tables<'assets'>['currency']` rows.

## Vitest needs `vite-tsconfig-paths` for the `@/*` alias to resolve

**Context**: vitest.config.ts:1-8; src/lib/net-worth.test.ts:2-3

**Problem**: The vitest bootstrap plan claimed Vite 7 auto-resolves tsconfig paths. It does not — the community uses `vite-tsconfig-paths` for it. The single existing test file uses a relative import (`./net-worth`), not the `@/*` alias, so alias resolution is unverified end-to-end. The next test that imports across directories will surface this.

**Rule**: Always include `vite-tsconfig-paths` in `vitest.config.ts` when the project uses TypeScript path aliases (`@/*`). Vitest does not auto-resolve tsconfig paths — the plugin is required for any test that imports across directories using the `@/` prefix.

**Applies to**: `vitest.config.ts` and any future Vitest configuration in this project. The plugin is already installed (`vite-tsconfig-paths@^5.1.4`) and configured; this rule prevents accidental removal.

## RLS USING-only is not enough for write-scope isolation

**Context**: supabase/migrations/20260529190856_initial_schema.sql:85-104 — every user-owned table (`user_preferences`, `assets`, `snapshots`, `snapshot_items`) has a `FOR ALL USING (auth.uid() = user_id)` policy. There is no `WITH CHECK` clause. The handler-level `.eq("user_id", user.id)` filter is therefore the only defense against a write-scope takeover on the update path.

**Problem**: In Postgres RLS, `USING` gates row visibility for SELECT/UPDATE/DELETE. It does NOT constrain the new/updated row on INSERT/UPDATE. Without `WITH CHECK`, an `UPDATE` like `from("assets").update({ user_id: "<someone-else>" }).eq("id", id)` is permitted by the policy — Postgres checks that the existing row is visible (USING matches) but does not check the resulting row. The handler filter prevents this by ensuring the matched row is the caller's; the `updates` payload at `src/pages/api/assets/[id]/index.ts:55-77` never includes `user_id` in the keys. A future feature that adds "transfer asset" and writes `user_id` to the update payload would silently bypass the policy — RLS USING alone is insufficient.

**Rule**: For tables with a `user_id` column, always pair `USING (auth.uid() = user_id)` with `WITH CHECK (auth.uid() = user_id)`. The pair is the canonical defense-in-depth shape; USING alone is not belt-and-suspenders, it is half a belt.

**Applies to**: Any new RLS policy on a user-owned table. Audited in the Phase 5 migration `supabase/migrations/<timestamp>_rls_with_check.sql` for the four existing user-owned policies.

**Closed**: Phase 5 of `testing-critical-path-api-integration` — `WITH CHECK` clauses added to the four user-owned policies in the migration.

## `(snapshot_id, asset_id)` has no unique constraint

**Context**: supabase/migrations/20260529190856_initial_schema.sql:54-66 — `snapshot_items` table has no unique constraint on `(snapshot_id, asset_id)`. The `snapshot_items` PK is `id` (auto-generated UUID), not the natural composite key.

**Problem**: Two concurrent POSTs from the same user can both fetch the same assets set in parallel, both insert a parent snapshot, and both insert items with the same `(snapshot_id, asset_id)` pairs. With no unique constraint, both inserts succeed and the chart renders duplicated items for the duplicate snapshots. The lesson §1 worst case (orphan parent) is one failure mode; the concurrent duplicate is another.

**Rule**: When a child table represents a child of a parent with a natural composite identity (`snapshot_id`, `asset_id`), the natural key SHOULD be a unique constraint, not just inferred. The composite uniqueness is what makes the operation idempotent under concurrent writes.

**Applies to**: Any new child table where the natural key is `(parent_id, child_id)`. Currently OPEN — no test pins this. Tracked for a follow-up migration; not in Phase 2 scope because the test plan's risk map did not include it.

**Open**: no test coverage. A future phase that adds a unique constraint migration should also add a test that two concurrent POSTs produce one item per `(snapshot_id, asset_id)` pair.

## Empty-assets on snapshot POST still creates a parent row

**Context**: src/pages/api/snapshots/index.ts:140 — the snapshot POST handler skips the items insert when `assets.length === 0`, but a parent `snapshots` row with `total_net_worth: 0` is still committed. The chart would render a single zero point at the click of "Save snapshot" on a fresh account.

**Problem**: The current behavior may be intentional (preserve the history of when the user took the snapshot) or accidental (no short-circuit guard on parent insert). Either way, the behavior is undocumented and the test now pins it so a future refactor is observable.

**Rule**: When a handler has a partial-failure branch (skip items, keep parent), the product decision behind that branch should be documented inline or in a lesson. Code that "obviously" does the right thing rarely is.

**Applies to**: Any handler with partial-write semantics where the short-circuit is not the obvious default.

**Open — product question**: Should the handler skip the parent insert entirely when `assets.length === 0`, or is a zero-value snapshot a deliberate artifact of "user clicked save"? The test pins the current behavior; the product call is open.

## SECURITY DEFINER functions need an explicit `SET search_path`

**Context**: supabase/migrations/20260529190856_initial_schema.sql:121-127 — the `on_auth_user_created` trigger function is `SECURITY DEFINER` and references the unqualified table name `user_preferences`. There is no `SET search_path` on the function.

**Problem**: Postgres defaults SECURITY DEFINER functions to a "safe" search_path of `pg_catalog, pg_temp`. An unqualified `user_preferences` resolves to nothing inside the function, so every signup fails with `ERROR: relation "user_preferences" does not exist`. The pre-existing `user_preferences` was created with a prior search_path assumption and survived only because the bug had not been triggered in production yet — `supabase db reset` rebuilt the schema from scratch and surfaced it. Closed in `supabase/migrations/20260603130000_fix_on_auth_user_created_search_path.sql` (recreates the function with `SET search_path = public, pg_temp`).

**Rule**: Every `SECURITY DEFINER` function must either (a) include `SET search_path = <schema>, pg_temp` in its definition or (b) fully qualify every table reference (`public.user_preferences`). The default search_path for SECURITY DEFINER is not the caller's — Postgres strips the caller's mutable schemas as a defense against search_path attacks, so the function effectively lives in `pg_catalog, pg_temp` unless told otherwise.

**Applies to**: Any new trigger or helper marked `SECURITY DEFINER` in `supabase/migrations/`. Also any `SECURITY INVOKER` function that relies on the caller's search_path (less common, but if the caller's role has been customized, prefer explicit settings).

## Nav items live in two files — desktop and mobile

**Context**: src/components/Topbar.astro (desktop horizontal nav, `sm:inline-flex`) and src/components/TopbarMenu.tsx (mobile Radix dropdown, `sm:hidden`). The asset-balancer plan's nav contract named only TopbarMenu.tsx.

**Problem**: The two components render parallel copies of the same nav items at different breakpoints. A plan or change that adds/edits a nav item in only TopbarMenu.tsx (the mobile dropdown) ships a feature that is unreachable from the desktop nav — and vice versa. The asset-balancer "Balance" link had to be added to Topbar.astro as an unplanned completeness fix because the plan referenced only the mobile file.

**Rule**: Any nav-item change must touch BOTH Topbar.astro (desktop) and TopbarMenu.tsx (mobile). When planning a nav change, name both files in the plan's Changes Required.

**Applies to**: Any change that adds, removes, renames, or reorders a top-bar navigation entry.

## Seed-injected RNG is the testability seam for stochastic modules

- **Context**: Any new pure module that uses randomness/simulation (Monte Carlo, sampling, jitter, shuffles) — e.g. src/lib/monte-carlo.ts.
- **Problem**: A module that calls Math.random() internally is non-deterministic, so its math can't be pinned with fixed-seed oracles and any UI built on it isn't reproducible across reloads. monte-carlo.ts avoided this by taking an explicit `seed`, threading it through mulberry32, and consuming the RNG in a fixed order (outer paths, inner years, exactly one Gaussian draw per path-year) — which made the stochastic math cheaply unit-testable and the Forecast page reproducible.
- **Rule**: Any stochastic/randomized module must inject the seed (caller-supplied), never call Math.random() internally, and keep the RNG consumption order fixed and documented so a test can replay the same sequence as an independent oracle.
- **Applies to**: plan, implement, impl-review

## Verify iOS gestures in WebKit, not Chrome touch emulation

- **Context**: Any change whose acceptance depends on touch or pointer gesture behaviour on iOS — drag-and-drop, swipe, long-press — in `src/components/**`, including the installed PWA (S-08).
- **Problem**: Chrome's touch emulation never fires `pointercancel` mid-gesture, so a PointerSensor-only dnd-kit setup passes a narrow-viewport check and is dead on a real iPhone. S-25 shipped exactly this way: plan row 3.10 recorded the drag handle as verified on device, yet in the installed PWA the handle rendered and nothing dragged.
- **Rule**: Never accept a touch-gesture check run in Chrome's touch emulation. Verify in Playwright **WebKit** with `devices["iPhone 13"]`, and explicitly model iOS's cancellation: dispatch `pointercancel` partway through the gesture while continuing to dispatch `touchmove`. If the interaction survives that, it survives iOS.
- **Applies to**: plan, implement, impl-review
