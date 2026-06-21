# Full Data Backup — Plan Brief

> Full plan: `context/changes/data-backup-import-export/plan.md`
> Research: `context/changes/data-backup-import-export/research.md`

## What & Why

Let a user export **all** their data — preferences, assets, snapshots, snapshot items — as one self-describing versioned JSON file, and import it back to restore, choosing **replace-all** or **merge**. The feature exists to prevent exactly the corruption a partial multi-table write would cause, so the restore must be atomic.

## Starting Point

Four user-owned tables (`user_preferences`, `assets`, `snapshots`, `snapshot_items`) with RLS `WITH CHECK`, one RPC precedent (`upsert_crypto_price_cache`), and a settings page hosting a single island. There is no backup, no JSON envelope, no `Content-Disposition` response, and no multi-table/jsonb RPC yet. Everything else (auth gate, error shape, `user_id` injection, island mount) has a concrete template to mirror.

## Desired End State

A **Backup & Restore** card on the settings page: Export downloads `bitworth-backup.json`; Import (Replace — guarded by a confirm dialog — or Merge — with a duplicate caveat) restores the account into a consistent state, never partially written, with snapshot history and dates intact.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Atomicity strategy | Atomic `restore_backup` SECURITY DEFINER RPC | Only a single transaction guarantees a partial restore can't corrupt the account (lessons.md §1). | Plan |
| Schema-version policy | Refuse newer, accept older same-major (whitelist) | Safe against unknown future fields; old backups keep working without a forward-migration map. | Plan |
| Timestamps | Preserve original `created_at`/`updated_at` | A restored net-worth chart must look identical — re-dating destroys snapshot history. | Plan |
| Merge dedup | Dumb append + amber UI caveat | No unique key exists to dedupe on (lessons.md §"no unique constraint"); avoids false-merging distinct rows. | Plan |
| Import failure granularity | All-or-nothing, pre-validate before any write | Composes with the atomic RPC; a backup must never restore partially. | Plan |
| Testing depth | Heavy unit on pure `backup.ts` + API contract tests | Concentrates coverage where the risk is; satisfies the existing api-auth contract test. | Plan |
| Backup completeness | Whole-row, column-explicit whitelist | FIRE/theme + `quantity`/`show_on_chart` are easy to silently drop. | Research |
| `assets.quantity` premise | Struck (false) | Migration exists and types are in sync — no investigation needed. | Research |

## Scope

**In scope:** versioned JSON export with download header; replace/merge import; pure `backup.ts` (serialize/validate/prepare); atomic RPC; two self-authenticating API routes; settings island with confirm dialog + merge caveat.

**Out of scope:** PDF/CSV reporting; cross-file stable identity / true de-dup; forward-migration map; writing `asset_categories`; skip-bad-rows partial import; E2E/Playwright; backing up global/cache tables.

## Architecture / Approach

Inside-out, each layer verifiable before the next: **pure `src/lib/backup.ts`** (envelope, whitelists, validation, UUID remap — exhaustively unit-tested) → **`GET /api/backup/export`** (fetch 4 tables → serialize → attachment) → **`restore_backup` RPC** (one transaction; sole ownership boundary; FK-ordered replace/merge) → **`POST /api/backup/import`** (validate → prepare → RPC) → **`BackupRestore` island** on the settings page. UUID remapping happens in TS so the plpgsql stays a straight whitelisted insert; the RPC self-enforces `user_id = auth.uid()` + `SET search_path` because SECURITY DEFINER bypasses RLS.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure backup module | `backup.ts` + exhaustive unit tests | Missing a whitelist column silently drops data |
| 2. Export endpoint | Downloadable `bitworth-backup.json` | First `Content-Disposition` response |
| 3. `restore_backup` RPC | Atomic multi-table restore | First jsonb plpgsql; SECURITY DEFINER must self-enforce ownership + search_path |
| 4. Import endpoint | Validate→prepare→RPC orchestration | All-or-nothing semantics; correct error mapping |
| 5. Settings UI island | Export/import UX + confirm dialog | Destructive replace must require explicit confirm |

**Prerequisites:** F-01, S-02, S-05 (all done). Prod `asset_categories` must hold the 13 seeded rows (open risk — seed runs on `db reset`, not `migration up`).
**Estimated effort:** ~2–3 sessions across 5 phases.

## Open Risks & Assumptions

- **Prod `asset_categories` seeding** — if prod was built from migrations only, every category-FK insert RESTRICT-fails; verify before relying on category validation.
- **jsonb plpgsql is greenfield** — no in-repo precedent; author against current Postgres docs (Context7) in Phase 3.
- **SECURITY DEFINER bypasses RLS** — the RPC is the *only* ownership guard; a missing `WHERE user_id = auth.uid()` or `SET search_path` is a security/correctness hole.

## Success Criteria (Summary)

- Export→delete→import (replace) restores the account exactly, including snapshot dates and the net-worth chart shape.
- A bad `category_id` or newer `schemaVersion` is rejected with a clear message and **zero** rows written.
- Merge appends with a visible duplicate caveat; replace requires explicit confirmation.
