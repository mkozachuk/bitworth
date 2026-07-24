<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Custom Savings Goals (S-21)

- **Plan**: context/changes/savings-goals/plan.md
- **Scope**: All 6 phases
- **Date**: 2026-07-24
- **Verdict**: APPROVED (triaged: F1/F2/F3 all fixed)
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (2 observations) |
| Architecture | PASS |
| Pattern Consistency | PASS (1 observation) |
| Success Criteria | PASS |

Automated success criteria re-run at HEAD: `supabase db reset`, `npm run build`, `tsc --noEmit`, `npm run lint`, and `npm run test:ci` (371 tests / 28 files) all pass, plus every targeted suite named in the plan (goals math 37, both goals handlers 62, auth-contract 20, parity 6, backup module 18, backup routes 16).

A fourth candidate finding — "the restore_backup migration lacks a rollback comment its siblings carry" — was dropped as a false positive: all six `restore_backup` migrations in the repo omit it (including the `show_trajectory` template this one copied), so the new migration matches the established `CREATE OR REPLACE FUNCTION` precedent.

## Findings

### F1 — Backup import validates goals more loosely than POST /api/goals

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Data safety)
- **Location**: src/lib/backup.ts:156 (REQUIRED_FIELDS.goals) + validateEnvelope
- **Detail**: validateEnvelope checks goals' required-field presence, timestamp format, and category_id membership, but not the semantic rules the POST path enforces (kind ∈ {net_worth,category}, target_currency ∈ {PLN,USD,EUR}, target_amount > 0, kind↔category_id coherence). A structurally-valid-but-semantically-bad row trips the DB CHECK inside restore_backup, surfacing as 500 RESTORE_FAILED rather than a clean 400. SAFE — the RPC is a single transaction, so it rolls back with no partial write — and it matches the posture assets/snapshots already have on import. Pre-existing repo pattern, not a regression.
- **Fix**: Leave as-is, or add a one-line comment declaring the DB CHECK the intentional import boundary. Extending validateEnvelope for full parity is optional and larger than the issue warrants.
- **Decision**: FIXED — added the boundary comment declaring the DB CHECK the intentional import limit

### F2 — Row Edit/Delete buttons not disabled during an in-flight request

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/goals/GoalsManager.tsx:427-435 (vs :342 disabled={pending})
- **Detail**: The submit button is disabled={pending}, but the row-level Edit/Delete buttons are not gated on pending, so a Delete can fire while a create/edit is in flight. Requests are independent and setGoals updates are functional, so the worst case is a redundant round-trip — not corruption — and pending is always reset. UX hardening only.
- **Fix**: Add disabled={pending} to the row Edit/Delete buttons to close the redundant-request window. Optional.
- **Decision**: FIXED — disabled={pending} added to all four row Edit/Delete buttons (table + mobile)

### F3 — "Est. completion" date rendered in local TZ; on-track verdict decided in UTC

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (Correctness, cosmetic)
- **Location**: src/components/goals/GoalsProgress.tsx:46-48 (formatDate)
- **Detail**: formatDate renders eta.date via toLocaleDateString (viewer's timezone) while onTrackVerdict decides on/behind on the UTC calendar day. For a viewer several hours off UTC, the shown completion date can read one day different from the day that drove the badge. Mirrors the already-shipped trajectory card; cosmetic.
- **Fix**: Leave as-is (matches the shipped trajectory card), or format the date in UTC to align the two. Cosmetic.
- **Decision**: FIXED — formatDate now renders in UTC to match onTrackVerdict's comparison frame
