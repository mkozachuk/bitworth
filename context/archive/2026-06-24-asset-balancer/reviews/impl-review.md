<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Asset Balancer (S-15)

- **Plan**: context/changes/asset-balancer/plan.md
- **Scope**: All 5 phases
- **Date**: 2026-06-24
- **Verdict**: NEEDS ATTENTION (F1 fixed during triage)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — asset_id raw-interpolated into PostgREST `in` filter

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/allocation-targets/index.ts:149
- **Detail**: The delete-missing filter `.not("asset_id", "in", `(${submittedIds.join(",")})`)` interpolates `asset_id`, which was validated only as a non-empty string. Both sub-agents flagged CRITICAL; verified NOT live-exploitable because the upsert (line 134) runs first and inserts each asset_id into a `uuid` column with an FK to assets — any non-UUID/non-owned id aborts the upsert (500) before the delete runs. Risk is latent: safety rested on statement ordering, not validation.
- **Fix**: Added a UUID regex check in parseTargets so non-UUID asset_id → 400 before any DB write; the delete filter is now self-defending regardless of statement order.
- **Decision**: FIXED

### F2 — Desktop nav (Topbar.astro) changed but not named in plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/Topbar.astro
- **Detail**: Plan Phase 4 named only TopbarMenu.tsx (mobile dropdown). Topbar.astro (desktop nav) also gained the Balance link — a necessary completeness fix, not scope creep; the plan under-specified that nav lives in two files.
- **Fix**: No code change (desktop link already correct). Recorded as a lesson in context/foundation/lessons.md ("Nav items live in two files — desktop and mobile").
- **Decision**: ACCEPTED-AS-RULE: Nav items live in two files — desktop and mobile

### F3 — upsert + delete-missing not jointly atomic

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/allocation-targets/index.ts:134-153
- **Detail**: Two RLS-filtered statements, no transaction. Delete-after-upsert failure leaves stale de-selected rows until the next save; no data loss/orphan. Plan explicitly accepted this (plan:58). An RPC taking uuid[] would make it atomic and subsume F1.
- **Fix**: None required; accepted tradeoff.
- **Decision**: SKIPPED

### F4 — target_pct stored at NUMERIC(5,2), input allows finer

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260624120000_allocation_targets.sql:26
- **Detail**: Column is NUMERIC(5,2); validator accepts any finite [0,100] and UI step is 0.1. A typed 33.339 silently rounds to 33.34 in Postgres. Harmless (targets advisory).
- **Fix**: None required; awareness only.
- **Decision**: SKIPPED
