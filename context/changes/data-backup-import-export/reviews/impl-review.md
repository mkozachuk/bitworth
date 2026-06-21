<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Full Data Backup — Export/Import

- **Plan**: context/changes/data-backup-import-export/plan.md
- **Scope**: Phases 1–5 of 5
- **Date**: 2026-06-21
- **Verdict**: APPROVED (with minor hardening notes)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Plan-drift agent reported zero DRIFT/MISSING/EXTRA across all 5 phases; all guardrails hold. Success criteria: 40 tests pass (backup unit + export/import route + api-auth-contract), tsc/lint/build green.

## Findings

### F1 — restore_backup RPC is PUBLIC-executable (no GRANT/REVOKE)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260620120000_restore_backup_rpc.sql
- **Detail**: A new function defaults to EXECUTE granted to PUBLIC. The function is SECURITY DEFINER (bypasses RLS); the only gate for an unauthenticated caller is the `auth.uid() IS NULL` raise (line 39). Residual risk is low — anon is blocked by that raise, and every insert is stamped user_id = auth.uid(), so an authed caller can only touch their own rows (same power the import endpoint grants). The repo's only other callable RPC (upsert_crypto_price_cache) also omits GRANT/REVOKE, so this matches existing convention rather than being a regression.
- **Fix**: New migration adding `REVOKE EXECUTE ON FUNCTION restore_backup(text, jsonb) FROM PUBLIC, anon;` + `GRANT EXECUTE ON FUNCTION restore_backup(text, jsonb) TO authenticated;`
- **Decision**: FIXED — `supabase/migrations/20260621000000_restore_backup_grants.sql`. Note: REVOKE FROM PUBLIC alone was insufficient (Supabase default privileges grant EXECUTE directly to anon), so also revoked from anon. Verified on fresh `db reset`: anon → "permission denied", authenticated → reaches the auth.uid() raise.

### F2 — runImport() doesn't check res.ok before reading the body

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Reliability
- **Location**: src/components/settings/BackupRestore.tsx:62–74
- **Detail**: handleExport() guards on `res.ok`; runImport() does not — it reads json.error directly. Harmless for our own endpoints (failures carry `{ error }`, 200 carries `{ data }`), but a non-JSON failure body (e.g. a Cloudflare 5xx HTML page) makes res.json() throw → caught as "Network error", and a 200 with an unexpected shape would fall through to a reload. Minor inconsistency with the export path.
- **Fix**: Mirror handleExport — branch on `!res.ok` and surface `json?.error?.message ?? generic` before the reload.
- **Decision**: FIXED — `src/components/settings/BackupRestore.tsx` runImport now does `res.json().catch(() => null)` then guards `!res.ok || json?.error`.

### F3 — Raw Postgres error text returned to client in `context`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/backup/import.ts:70
- **Detail**: RESTORE_FAILED puts the raw PG `error.message` into the response `context`, which can expose constraint/column names. Authenticated-only and low-risk. The plan explicitly prescribed this ("include the PG message in context"), so it is plan-conformant, not drift. Flagged only as a hardening option.
- **Fix**: (optional) Log the PG message server-side; omit `context` from the client body, or gate behind a dev flag.
- **Decision**: SKIPPED — plan-conformant and low-risk (authed-only); kept as-is to preserve debugging context.
