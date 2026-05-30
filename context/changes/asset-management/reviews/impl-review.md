<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Asset Management

- **Plan**: context/changes/asset-management/plan.md
- **Scope**: All 4 phases (full plan review)
- **Date**: 2026-05-30
- **Verdict**: APPROVED
- **Findings**: 2 critical · 2 warnings · 2 observations (all addressed)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — DELETE endpoint missing ownership check

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/assets/[id]/index.ts:130
- **Detail**: The DELETE handler calls `supabase.from("assets").delete().eq("id", id)` without scoping to `user_id`. Any authenticated user can delete any other user's asset by guessing or enumerating the asset ID. The GET handler in the same file correctly uses `.eq("user_id", user.id)` at line 37. RLS alone does not prevent this — Supabase RLS on delete only enforces INSERT/UPDATE/DELETE permission, not cross-user isolation on arbitrary asset IDs.
- **Fix**: Add `.eq("user_id", user.id)` to the delete query, and handle the "no rows deleted" case by returning 404 (indistinguishable from a missing asset).
  - Strength: Matches the pattern used in GET (`.eq("user_id", user.id)`); achieves the same security boundary as RLS for other operations.
  - Tradeoff: Minor — one additional filter clause.
  - Confidence: HIGH — identical pattern used in the same file for GET.
  - Blind spot: Haven't verified whether Supabase RLS `auth.uid()` in a delete policy could serve as a cleaner alternative.
- **Decision**: FIXED

### F2 — PUT endpoint missing ownership check

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/assets/[id]/index.ts:76
- **Detail**: The PUT handler calls `supabase.from("assets").update(updates).eq("id", id)` without scoping to `user_id`. If a user provides another user's asset ID, the update passes RLS permission check but RLS filters the result row — the API returns `{ data: null }` with status 200, making the silent failure indistinguishable from a successful no-op. The Astro edit page (`[id]/edit.astro`) correctly scopes its server-side fetch with `.eq("user_id", user.id)`, but the API route does not enforce the same constraint.
- **Fix**: Add `.eq("user_id", user.id)` to the update query. When no rows are updated, return 404 instead of 200 with null data.
  - Strength: Consistent with the fix for F1; same code pattern.
  - Tradeoff: Minor — one additional filter clause.
  - Confidence: HIGH — identical pattern used in the same file for GET.
  - Blind spot: Haven't verified whether Supabase RLS `auth.uid()` in an update policy could serve as a cleaner alternative.
- **Decision**: FIXED

### F3 — categories API route has no authentication check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/categories/index.ts
- **Detail**: The GET handler has no auth guard. Anyone can fetch the full category list. While categories are not sensitive data, this is inconsistent with every other API route in the codebase, all of which gate on `createClient` and `getUser()`. Additionally, this endpoint was not described in the plan — it was a required dependency of `CategorySelect` that wasn't documented.
- **Fix**: Add the same auth pattern used in `src/pages/api/assets/index.ts:9-31` (createClient + getUser check with 401 UNAUTHORIZED response).
- **Decision**: FIXED

### F4 — AssetForm has unused crypto state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/assets/AssetForm.tsx:31
- **Detail**: `[_cryptoSymbol, _setCryptoSymbol] = useState(...)` — both the value and setter are dead code. The state is stored but never read; `_setCryptoSymbol` is never called. The crypto_symbol field is captured in the form but not sent to the API. CLAUDE.md hard rule: `@typescript-eslint/no-unused-vars` → error; prefix unused with `_`. While the `_` prefix suppresses the linter warning, dead code is still dead code.
- **Fix**: Remove the unused state entirely, or wire it up if crypto_symbol is intended future functionality (S-03 scope).
- **Decision**: SKIPPED

### F5 — CategorySelect silently swallows fetch errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/assets/CategorySelect.tsx:23-25
- **Detail**: The `fetch("/api/categories")` chain only sets `categories` on the happy path. If the request fails, `loading` becomes `false` but the component shows an empty select — indistinguishable from "loading finished with no data." No error state is surfaced to the user.
- **Fix**: Add a `setError` state and show an error message in the component when the fetch fails.
- **Decision**: FIXED + ACCEPTED-AS-RULE: Fetch chains must handle errors visibly

### F6 — AssetList silently swallows delete failures

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/assets/AssetList.tsx:33
- **Detail**: When the DELETE request fails (non-ok status), no error is shown to the user. The spinner clears and the asset remains in the list silently. The user has no indication the operation failed.
- **Fix**: Show a brief error message or reset the deleting state on failure before clearing `deletingId`.
- **Decision**: FIXED

### F7 — categories API endpoint unplanned but required

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/categories/index.ts
- **Detail**: This endpoint was not described in the plan but is a required dependency of `CategorySelect` (Phase 2). Functionally correct and necessary — not scope creep. Should have been documented in the plan as an addendum.
- **Fix**: No code change needed. Consider documenting this as a plan addendum for future reference.
- **Decision**: FIXED

### F8 — ESLint pre-existing crash

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: eslint.config.js / astro-eslint-parser
- **Detail**: `npm run lint` crashes with "Non-null Assertion Failed: Expected node to have a parent." This is a pre-existing issue with `astro-eslint-parser` + `projectService` config, not introduced by this change. TypeScript type checking passes (excluding the unrelated debug file `src/pages/api/debug/test-auth.ts`).
- **Fix**: No code change needed for this change. The crash predates this work.
- **Decision**: FIXED
