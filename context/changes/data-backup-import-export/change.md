---
change_id: data-backup-import-export
title: Full data backup — export all data to one file and import it back (replace or merge)
status: implementing
created: 2026-06-20
updated: 2026-06-20
archived_at: null
---

## Notes

Seeded from `context/foundation/roadmap.md` → **S-13: data-backup-import-export** (Stream I, Data portability).

**Outcome:** user opens settings and can (a) export a single self-describing JSON backup of all their data — preferences, assets, snapshots, snapshot items — and (b) import such a file to restore it, choosing **replace** all existing data or **merge** alongside what's there.

**Prerequisites:** F-01 (schema / all user-owned tables), S-02 (snapshots + `snapshot_items`), S-05 (settings page is the host surface). All done.

**Key decisions / unknowns to resolve in planning:**

- **File format & versioning:** JSON with an explicit `schemaVersion` / `exportedAt` envelope from day one.
- **Import mode UX (confirmed):** offer both replace-all and merge, user picks. Replace-all is destructive → explicit confirmation dialog. Merge = append-only (UUIDs regenerate, no stable cross-file identity → accept possible duplicates; surface the caveat in UI).
- **Atomicity:** no Supabase JS transactions. Prefer a single Postgres RPC (`restore_backup`) for true atomicity; fall back to the compensating-delete pattern from `src/pages/api/snapshots/index.ts`.
- **Category validation:** imported `category_id` values must exist in the global `asset_categories` table — validate, don't recreate; reject/skip unknown ids (with a `context` error).
- **Snapshot child remapping:** regenerate `snapshots.id` and remap each `snapshot_items.snapshot_id` on import (both modes).
- **Delivery:** `GET /api/backup/export` returning `application/json` with `Content-Disposition` attachment; `POST /api/backup/import` reading parsed JSON (follow the `user-preferences` JSON-body pattern, not `formData`).
- **Field completeness:** ~~confirm `assets.quantity` (in `database.types.ts`, no matching migration found) is included in the backup.~~ **Struck — research found this premise FALSE:** `assets.quantity` IS backed by `20260531223101_crypto_price_cache.sql:43` and types are fully in sync. The real completeness risk is the whole-row whitelist (9 `fire_*` + `theme` on `user_preferences`, `quantity` + `show_on_chart` on `assets`).

**Risk:** restore touches every user-owned table with no native transaction → partial failure can corrupt the account (the exact scenario backups prevent). Mitigant: isolate (de)serialization into a pure, unit-tested `src/lib/backup.ts` that validates envelope + shape before any write; prefer the atomic RPC, else compensating-delete rollback. Also: neutralize foreign `user_id` by remapping to `auth.uid()` + RLS `WITH CHECK`.

**Distinct from** the parked "Data export (PDF, CSV)" non-goal — this is data portability (full-account backup), not formatted reporting.
