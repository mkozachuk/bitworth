---
date: 2026-06-20T18:22:09+0200
researcher: maksymkozachuk
git_commit: 9ff7d585f5602189875a7fa7d499450aae0028e3
branch: feature/backup
repository: bitworth
topic: "Full data backup — export all data to one file and import it back (replace or merge)"
tags: [research, codebase, backup, import, export, rls, atomicity, rpc, schema-evolution]
status: complete
last_updated: 2026-06-20
last_updated_by: maksymkozachuk
---

# Research: Full data backup — export/import all user data

**Date**: 2026-06-20T18:22:09+0200
**Researcher**: maksymkozachuk
**Git Commit**: 9ff7d585f5602189875a7fa7d499450aae0028e3
**Branch**: feature/backup
**Repository**: bitworth

## Research Question

Ground the **data-backup-import-export** change (roadmap S-13, Stream I) in the live codebase: confirm the export/import envelope shape, the full set of user-owned tables and fields, the atomicity strategy (atomic `restore_backup` RPC vs compensating-delete fallback), the API/UI patterns to mirror, the security boundaries (RLS WITH CHECK, `user_id` neutralization, SECURITY DEFINER), and — added during scoping — what happens when an **old backup is imported into a newer schema** (schema evolution).

## Summary

The feature is buildable entirely on existing patterns; nothing here is unprecedented except three greenfield pieces: the JSON envelope/versioning, a downloadable `Content-Disposition` response, and (if chosen) a jsonb-parsing plpgsql RPC.

Headline findings, including corrections to `change.md`:

1. **`change.md`'s `assets.quantity` premise is WRONG.** `quantity` *does* have a backing migration (`20260531223101_crypto_price_cache.sql:43`) and the generated types are fully in sync with the migrations — there is **no** types-vs-migration discrepancy anywhere. The note in `change.md:26` should be struck.
2. **The backup is bigger than `change.md` implies.** `user_preferences` is not just `display_currency` — it carries `theme` plus **9 `fire_*` columns**, and `assets` has newer `quantity` + `show_on_chart` columns. A naive "preferences" backup would silently drop the entire FIRE calculator scenario and theme. **Back up the whole row, column-explicit.**
3. **RPC precedent exists** — `supabase.rpc("upsert_crypto_price_cache", …)` (`src/lib/crypto-prices.ts:116`) backed by a `SECURITY DEFINER … SET search_path` plpgsql function. `restore_backup` can follow this convention exactly, but it would be the **first** multi-table / jsonb-parsing RPC in the repo.
4. **Atomicity is a real fork.** Only an RPC gives a true transaction. The compensating-delete fallback (`snapshots/index.ts:153-161`) is best-effort and its own delete error is **unchecked** — the documented "both fail" gap. RPC = atomic but bypasses RLS (function must self-enforce ownership); compensating-delete = non-atomic but keeps RLS WITH CHECK as a live second layer.
5. **All four user-owned tables already have RLS `WITH CHECK`** (`20260602235644_rls_with_check.sql`). Import inserts must stamp `user_id = auth.uid()` server-side and remap snapshot child FKs, or WITH CHECK rejects them.
6. **No Zod, no Content-Disposition, no toast, no reusable Dialog** in the repo. All validation is hand-rolled; a native `<dialog>` modal pattern exists to clone for the destructive replace-all confirm.
7. **Schema evolution is unguarded today** — zero versioning infrastructure. The importer must (a) carry a `schemaVersion` envelope and gate on it, and (b) **whitelist known columns** on every insert (PostgREST rejects unknown keys), because a backup from a newer schema fails verbatim, and a future NOT-NULL-without-default column makes old backups fail.

## Detailed Findings

### Schema & field completeness

Migration inventory (`supabase/migrations/`, 7 files):

| File | Effect |
|---|---|
| `20260529190856_initial_schema.sql` | 6 base tables, indexes, RLS (USING-only), triggers |
| `20260531223101_crypto_price_cache.sql` | `crypto_price_cache` + **`assets.quantity`** (`:43`) + `upsert_crypto_price_cache` RPC (`:22-40`) |
| `20260602235644_rls_with_check.sql` | recreates 4 user-owned RLS policies **with `WITH CHECK`** |
| `20260603120000_user_preferences_theme.sql` | `user_preferences.theme` |
| `20260603130000_fix_on_auth_user_created_search_path.sql` | trigger search_path fix (no schema change) |
| `20260611120000_user_preferences_fire.sql` | **9 `fire_*` columns** on `user_preferences` |
| `20260619120000_assets_show_on_chart.sql` | `assets.show_on_chart` |

Seed (NOT a migration): `supabase/seed.sql` — 13 `asset_categories` rows.

**`assets.quantity` verdict — change.md claim is FALSE.** Migration `20260531223101_crypto_price_cache.sql:43` (`ALTER TABLE assets ADD COLUMN quantity NUMERIC;`), types at `src/lib/database.types.ts:60/74/88`. Nullable, no default, fully in sync. Full types-vs-migration cross-check found **no other discrepancies** (theme, all 9 `fire_*`, `show_on_chart` all present in both).

**The four user-owned tables a complete backup MUST include** (everything else is global/cache and excluded):

- **`user_preferences`** (1:1 with `auth.users`, PK `user_id`, FK→auth.users ON DELETE CASCADE). Columns: `display_currency` (NOT NULL default `'USD'`, CHECK PLN/USD/EUR), `theme` (NOT NULL default `'system'`), `created_at`/`updated_at`, and 9 FIRE fields — of which only `fire_safe_withdrawal_rate` (default `0.04`) and `fire_traditional_retirement_age` (default `65`) are NOT NULL; the other 7 are nullable.
- **`assets`** (PK `id` `gen_random_uuid()`, FK `user_id`→auth.users CASCADE, FK `category_id`→`asset_categories` **RESTRICT**). NOT-NULL-no-default: `user_id, category_id, name, amount, currency`. Nullable: `crypto_symbol, notes, quantity`. NOT-NULL-with-default: `show_on_chart` (`FALSE`), timestamps.
- **`snapshots`** (PK `id`, FK `user_id`→auth.users CASCADE). NOT-NULL-no-default: `user_id, total_net_worth, display_currency, source`. Default: `base_currency` (`'USD'`), `created_at`.
- **`snapshot_items`** (PK `id`, FK `snapshot_id`→`snapshots` **ON DELETE CASCADE**, FK `category_id`→`asset_categories` **RESTRICT**, **no `user_id` column** — ownership is transitive via parent). NOT-NULL-no-default: `snapshot_id, category_id, name, original_amount, original_currency, converted_amount, display_currency`. Default: `display_order` (`0`), `created_at`.

**No UNIQUE constraints** on any user-owned table beyond PKs (relevant to the merge-mode duplicate caveat — there is no natural key to dedupe on; cf. lessons.md "`(snapshot_id, asset_id)` has no unique constraint").

**`asset_categories` (global, no `user_id`, validate-don't-write).** 13 ids from `seed.sql:6-19`: `checking_account, savings_account, business_fop, cash_on_hand, stocks, investment_funds, bonds, crypto, precious_metals, real_estate, vehicles_valuables, loans_credit` (only liability), `p2p_loans`. Both `assets.category_id` and `snapshot_items.category_id` FK→ this table as **RESTRICT** → an unknown `category_id` aborts the insert; validate against the live table before write and reject/skip with a `context` error (per change.md).

> **Prod caveat:** `asset_categories` is seeded via `seed.sql`, which runs on `supabase db reset`/`start`, **not** via `supabase migration up`. A prod DB populated only through migrations could have an empty `asset_categories`, making every category-FK insert RESTRICT-fail. Confirm prod has the 13 rows before relying on category validation.

### Atomicity & rollback

**Compensating-delete pattern (the fallback)** — `src/pages/api/snapshots/index.ts:153-161`:
```ts
const { error: itemsError } = await supabase.from("snapshot_items").insert(items);
if (itemsError) {
  // Compensating delete: roll back the snapshot row so neither insert is partially committed
  await supabase.from("snapshots").delete().eq("id", snapshot.id);   // line 156 — return value discarded
  return new Response(/* 500 INSERT_FAILED */);
}
```
Gap: the compensating delete's own `{ error }` is never checked. If it fails, the orphan parent stays committed and the handler still returns 500 — the "both fail" worst case noted in `context/foundation/test-plan.md:154` and `lessons.md:5-13`. (lessons.md:9's text "no compensating delete" is stale — the delete exists at `:156` but is best-effort.)

**RPC precedent** — exactly one in the repo:
- Call site: `src/lib/crypto-prices.ts:116` — `supabase.rpc("upsert_crypto_price_cache", { p_coin_id, p_coin_symbol, p_price_usd })`.
- Definition: `20260531223101_crypto_price_cache.sql:22-40` — `RETURNS VOID … SECURITY DEFINER SET search_path = public LANGUAGE plpgsql`. Single-row upsert only; **no existing multi-table or jsonb-looping RPC** — `restore_backup` would be the first.

**SECURITY DEFINER template** (canonical, post-bugfix) — `20260603130000_fix_on_auth_user_created_search_path.sql:10-20`:
```sql
CREATE OR REPLACE FUNCTION on_auth_user_created()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp          -- load-bearing; omission broke signup in prod
AS $$ BEGIN INSERT INTO user_preferences (user_id) VALUES (NEW.id); RETURN NEW; END; $$;
```

**FK-forced ordering for a restore.** The only FK edge among the four user-owned tables is `snapshot_items.snapshot_id → snapshots.id` (`initial_schema.sql:56`). So:
- **DELETE (replace mode):** `snapshot_items` first — and since it has no `user_id`, scope via parent: `DELETE FROM snapshot_items WHERE snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid())` — then `snapshots` / `assets` / `user_preferences` (siblings, any order; `user_preferences` is better treated as upsert since it's 1:1 PK-on-user).
- **INSERT (both modes):** `user_preferences` / `assets` / `snapshots` first, `snapshot_items` **last**, remapping each item's `snapshot_id` to the freshly inserted snapshot id.
- `asset_categories` is shared seed — never delete/insert during restore.

**jsonb parsing in plpgsql: no in-repo precedent** (zero hits for `jsonb_array_elements`/`jsonb_populate_recordset`/`FOREACH`/`LOOP`). If the RPC route is chosen, that parsing is greenfield — fetch current Postgres jsonb-function syntax via Context7 when authoring it.

### API & UI patterns to mirror

**JSON-body endpoint template** — `src/pages/api/user-preferences/index.ts` (PUT, `:134-193`). Use `request.json()` in try/catch (NOT `formData`), cast to `Record<string, unknown>`, hand-validate per field, return via the local `jsonError` helper (`:59-64`):
```ts
function jsonError(code, message, status) {
  return new Response(JSON.stringify({ error: { code, message } } satisfies ErrorShape),
    { status, headers: { "Content-Type": "application/json" } });
}
```

**Error shape** — inline `interface ErrorShape { error: { code: string; message: string; context?: unknown } }` declared per-file (`user-preferences/index.ts:4-6`, `snapshots/index.ts:8-10`). The `context?` field is defined but never used yet — the unknown-`category_id` error would be its first use. Status conventions: 401 `UNAUTHORIZED`, 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`, 500 `FETCH_FAILED`/`UPDATE_FAILED`/`INSERT_FAILED`, 201 on create.

**Export delivery** — **no `Content-Disposition` precedent anywhere.** Mirror the standard `new Response(JSON.stringify(...), { status, headers })` (e.g. `snapshots/index.ts:44`) and add `"Content-Disposition": "attachment; filename=\"bitworth-backup.json\""`. `GET: APIRoute = async ({ request, cookies }) => …` is the signature.

**Settings host surface** — the page is `src/pages/dashboard/settings.astro` (not `src/pages/settings.astro`). It SSR-fetches prefs via `createClient(Astro.request.headers, Astro.cookies)` (`:18-24`), renders one card (`:43-47`) mounting `<SettingsForm … client:load />` (`:46`). Add a sibling card after `:47` mounting a new `<BackupRestore client:load />` island in `src/components/settings/`. Island contract to copy from `SettingsForm.tsx`: `fetch` with JSON body (`:44-48`), read `(await res.json()) as { error?: { message } }` and surface via `<ServerError message={…} />` (`auth/ServerError.tsx`), `pending` spinner button (`:129-145`).

**Confirmation dialog** — **no Radix Dialog installed** (only `react-dropdown-menu` + `react-slot`). Precedents: cheap `window.confirm("Delete this asset? …")` (`assets/AssetList.tsx:30`); richer styled native `<dialog>` modal (`InstallInstructionsModal.tsx`, `useRef<HTMLDialogElement>` + `showModal()`, `backdrop:bg-black/60`). Clone the `<dialog>` pattern for the destructive replace-all confirm. **No toast system** — surface the "merge may create duplicates" caveat as an inline amber banner styled like `ServerError.tsx` (different color), inside the dialog body.

### Security (RLS / auth / validation)

**RLS WITH CHECK is in place on all four user-owned tables** — `20260602235644_rls_with_check.sql`: `user_preferences` (`:12-15`), `assets` (`:18-21`), `snapshots` (`:24-27`) each `USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id)`; `snapshot_items` (`:34-37`) gated transitively by `snapshot_id IN (SELECT id FROM snapshots WHERE user_id=auth.uid())`. Import inserts must therefore insert parent snapshots first and remap child `snapshot_id`, or WITH CHECK rejects the items.

**`user_id` neutralization pattern** — existing handlers never trust the body for `user_id`; they inject `user.id` from `auth.getUser()`: `assets/index.ts:129`, `snapshots/index.ts:114`, `user-preferences/index.ts:183` (upsert with `onConflict: "user_id"`). Import must discard any envelope `user_id`/row `id` ownership and stamp `auth.uid()`.

**Auth enforcement** — middleware does NOT cover API routes: `src/middleware.ts:4` has `PROTECTED_ROUTES = ["/dashboard"]` only, redirecting `/dashboard*` to `/auth/signin`. `/api/backup/*` must self-enforce the two-step check in-handler (`createClient` → `supabase.auth.getUser()` → 401 `UNAUTHORIZED`), exactly as `assets/index.ts:9-32`. A contract test pins this: `src/pages/api/api-auth-contract.test.ts:21,67` asserts every API route calls `supabase.auth.getUser()` (or carries a public-route comment) — the new routes will be held to it.

**Validation** — no Zod/valibot/yup/ajv in `package.json`. Replicate the hand-rolled approach (`user-preferences/index.ts:147-179`) inside the pure `src/lib/backup.ts` the change calls for: validate envelope (`schemaVersion`, `exportedAt`) + per-row shape before any write; validate `category_id` against the live `asset_categories` table.

**SECURITY DEFINER ⇒ RLS bypass.** If `restore_backup` is `SECURITY DEFINER` (needed for atomicity), it runs as the owner and **bypasses RLS WITH CHECK** — so the function becomes the *sole* ownership boundary: it must set `user_id = auth.uid()` on every inserted row, scope every delete with `WHERE user_id = auth.uid()`, reject non-owned `category_id`, and carry `SET search_path = public, pg_temp` (the omission that broke signup; lessons.md:81-89). The SECURITY INVOKER alternative keeps WITH CHECK as a live second layer but cannot wrap the writes in one transaction → non-atomic.

## Code References

- `supabase/migrations/20260529190856_initial_schema.sql` — base tables, FKs, original USING-only RLS (`:91-104`), original SECURITY DEFINER trigger w/o search_path (`:121-127`)
- `supabase/migrations/20260531223101_crypto_price_cache.sql:43` — `assets.quantity`; `:22-40` — `upsert_crypto_price_cache` SECURITY DEFINER RPC template
- `supabase/migrations/20260602235644_rls_with_check.sql:12-37` — WITH CHECK on all 4 user-owned tables
- `supabase/migrations/20260603130000_fix_on_auth_user_created_search_path.sql:10-20` — canonical SECURITY DEFINER + `SET search_path = public, pg_temp`
- `supabase/migrations/20260611120000_user_preferences_fire.sql` — 9 `fire_*` columns
- `supabase/migrations/20260619120000_assets_show_on_chart.sql` — `assets.show_on_chart`
- `supabase/seed.sql:6-19` — 13 `asset_categories` (NOT a migration)
- `src/lib/database.types.ts:60,74,88` — `assets.quantity` in Row/Insert/Update
- `src/lib/crypto-prices.ts:116` — the only `supabase.rpc(...)` call site
- `src/pages/api/snapshots/index.ts:110-161` — multi-table write + compensating delete (`:156`)
- `src/pages/api/user-preferences/index.ts:4-6,59-64,134-193` — ErrorShape, `jsonError`, JSON-body PUT template; `:183` user_id-injecting upsert
- `src/pages/api/assets/index.ts:9-32,129` — auth-check template, server-side `user_id` injection
- `src/pages/api/api-auth-contract.test.ts:21,67` — enforces in-handler auth on all API routes
- `src/middleware.ts:4,35-39` — `PROTECTED_ROUTES = ["/dashboard"]`; `/api/backup/*` not covered
- `src/pages/dashboard/settings.astro:18-47` — settings host + island mount
- `src/components/settings/SettingsForm.tsx:44-55,129-145` — island fetch/error/pending contract
- `src/components/auth/ServerError.tsx` — red alert banner (clone amber for the merge caveat)
- `src/components/InstallInstructionsModal.tsx` — native `<dialog>` modal to clone for confirm
- `src/components/assets/AssetList.tsx:30` — `window.confirm` destructive precedent

## Architecture Insights

- **Mirror, don't invent.** Endpoint shape, auth gate, error shape, `user_id` injection, multi-table rollback, settings island mount — all have a concrete template. The only genuinely new surface area is the JSON envelope, the download header, and (optionally) a jsonb-parsing RPC.
- **The atomicity decision is the architectural crux**, and it is a security/atomicity trade-off, not a style choice. RPC (SECURITY DEFINER) buys true transactionality at the cost of being the sole ownership enforcer; compensating-delete keeps RLS WITH CHECK live but is non-atomic and has an unchecked-delete gap. Given the change's own framing ("restore touches every user-owned table … partial failure can corrupt the account — the exact scenario backups prevent"), the RPC is the principled choice; the fallback must at minimum check its compensating-delete error (the current handler does not).
- **Whole-row backups, column-explicit.** The `user_preferences` FIRE/theme columns and `assets.quantity`/`show_on_chart` are the easy-to-forget fields; the serializer should be column-explicit (whitelist) so it both captures everything today and rejects unknown keys on import tomorrow.
- **Validation lives in a pure module.** `src/lib/backup.ts` (pure, unit-tested) is the right home for envelope+shape validation and id/FK remapping — it keeps the unsafe write path thin and testable, echoing the existing `src/lib/net-worth.ts` pure-helper convention.

## Schema-Evolution Compatibility (old backup → newer DB)

There is **no versioning infrastructure today** (zero hits for `schemaVersion`/`version`/`envelope` in `src/`). The envelope must be built from scratch. What a forward/backward-compatible import has to defend against, given the actual constraints found:

1. **Old backup, new NOT-NULL column.** Safe only when the new column has a DB default. Every current NOT-NULL column either has a default or is always user-supplied, so today an old file still inserts. The future hazard: a later migration adds a **NOT-NULL-without-default** column → old backups fail the insert with a raw Postgres violation. The importer cannot fix this generically — gate on the envelope `schemaVersion` (warn/refuse on mismatch) rather than letting a NOT-NULL error leak.
2. **Newer backup, older DB (or any unknown key).** PostgREST/Supabase `.insert()` **rejects unknown columns** (PGRST error). So never spread a parsed row straight into `.insert()` — **whitelist known columns** per table and strip the rest. This also protects against a backup made on a newer schema being imported on an older deploy.
3. **`user_id` / id remapping** (applies in both modes): discard envelope `user_id`, stamp `auth.uid()`; regenerate `snapshots.id` / `assets.id`; remap each `snapshot_items.snapshot_id` to the new parent.
4. **Server-managed columns:** `created_at`/`updated_at` default to `NOW()`. Decide explicitly whether to preserve original timestamps from the backup (they are insertable) or let them re-default — a backup that re-dates everything to import-time loses history.

**Recommended posture:** `{ schemaVersion: <int>, exportedAt, app: "bitworth", data: { user_preferences, assets, snapshots, snapshot_items } }`. On import: (a) reject if `schemaVersion` is newer than the running app understands; (b) for older versions, run a forward-migration map (or accept-with-warning) rather than blind insert; (c) always column-whitelist before write.

## Historical Context (from prior changes)

- `context/foundation/lessons.md:5-13` — "DB multi-table writes must be atomic"; names `snapshots/index.ts` directly. Directly governs the restore atomicity decision.
- `context/foundation/lessons.md:45-55` — "RLS USING-only is not enough"; the WITH CHECK pair (added in `20260602235644_rls_with_check.sql`, Phase 5 of `testing-critical-path-api-integration`) is what import inserts must satisfy.
- `context/foundation/lessons.md:81-89` — "SECURITY DEFINER functions need an explicit `SET search_path`"; closed via `20260603130000_…`; mandatory for any `restore_backup` RPC.
- `context/foundation/lessons.md:57-67` — "`(snapshot_id, asset_id)` has no unique constraint"; explains why merge mode cannot dedupe and must accept duplicates (matches change.md's merge caveat).
- `context/foundation/test-plan.md:154` — documents the untested "both items insert and compensating delete fail" worst case the RPC would eliminate.
- `context/foundation/roadmap.md:278,283` — S-13 risk register: atomicity + `user_id` remap to `auth.uid()`.

## Related Research

No prior `research.md` exists under `context/changes/**` or `context/archive/**` for backup/import. This is the first research artifact for `data-backup-import-export`.

## Open Questions

1. **Atomic RPC vs compensating-delete — decide in planning.** RPC is the principled choice (true transaction; the feature exists to prevent the corruption a partial restore would cause), but introduces the first jsonb-parsing plpgsql and must self-enforce ownership (SECURITY DEFINER bypasses RLS). If the fallback is chosen instead, it **must** check the compensating-delete error (the snapshots handler currently does not) and define behavior when rollback itself fails.
2. **Correct `change.md:26`.** `assets.quantity` has a migration (`20260531223101_crypto_price_cache.sql:43`) and types are in sync — the "no matching migration found" note is stale and should be removed so it doesn't drive a phantom investigation.
3. **Confirm prod `asset_categories` is seeded.** If prod was built from migrations only (no `seed.sql`), category-FK validation/inserts will RESTRICT-fail. Verify the 13 rows exist before relying on category validation.
4. **Timestamp preservation.** Preserve original `created_at`/`updated_at` from the backup, or let them re-default to import time? Affects snapshot history fidelity.
5. **Schema-version policy on import.** Hard-refuse newer-than-supported backups; for older versions, forward-migrate vs accept-with-warning? (See Schema-Evolution section.)
6. **Merge-mode duplicate surfacing.** With no unique key on any user table, merge always risks duplicates — confirm the UI copy and whether to offer any best-effort de-dup heuristic (e.g. by `(name, amount, currency, category_id)`) or accept dumb append.
7. **Replace-mode `user_preferences`.** It's a 1:1 PK-on-user row — treat replace as upsert (don't delete the row), since the signup trigger created it and `auth.users` still references it.
