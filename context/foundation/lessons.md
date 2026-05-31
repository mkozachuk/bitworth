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
