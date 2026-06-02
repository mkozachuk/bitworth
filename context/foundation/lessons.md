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

**Rule**:

**Applies to**:
