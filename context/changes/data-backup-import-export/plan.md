# Full Data Backup — Export/Import Implementation Plan

## Overview

Give the user a one-file, self-describing backup of **all** their data and the ability to restore it. Export writes a versioned JSON envelope of the four user-owned tables (`user_preferences`, `assets`, `snapshots`, `snapshot_items`); import reads such a file and restores it in either **replace-all** (destructive, explicit confirm) or **merge** (append-only) mode.

The unsafe write is isolated two ways: all (de)serialization, validation, and UUID remapping live in a pure, unit-tested `src/lib/backup.ts`; the multi-table write itself runs inside a single atomic `restore_backup` SECURITY DEFINER RPC so a partial restore can never corrupt the account.

## Current State Analysis

What exists today (all confirmed in `context/changes/data-backup-import-export/research.md`):

- **Four user-owned tables, fully mapped.** `user_preferences` (1:1 PK-on-user; `display_currency`, `theme`, timestamps, **9 `fire_*` columns**), `assets` (`user_id`, `category_id` RESTRICT→`asset_categories`, `name`, `amount`, `currency`, nullable `crypto_symbol`/`notes`/`quantity`, `show_on_chart` default false, timestamps), `snapshots` (`user_id`, `total_net_worth`, `display_currency`, `source`, `base_currency` default `'USD'`, `created_at`), `snapshot_items` (**no `user_id`** — owned transitively via `snapshot_id`→`snapshots` ON DELETE CASCADE; `category_id` RESTRICT; `name`, `original_amount`, `original_currency`, `converted_amount`, `display_currency`, `display_order` default 0, `created_at`).
- **`assets.quantity` is backed by a migration** (`supabase/migrations/20260531223101_crypto_price_cache.sql:43`) and types are in sync — the stale "no matching migration" note in the original `change.md` is **false** and has been struck. There is no types-vs-migration discrepancy anywhere.
- **One global table to validate-not-write:** `asset_categories`, 13 seeded ids (`supabase/seed.sql:6-19`). Both `assets.category_id` and `snapshot_items.category_id` FK to it as RESTRICT — an unknown id aborts the insert.
- **RLS `WITH CHECK` on all four user-owned tables** (`supabase/migrations/20260602235644_rls_with_check.sql`). `snapshot_items` is gated transitively via `snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid())`.
- **RPC precedent:** exactly one — `upsert_crypto_price_cache` (`supabase/migrations/20260531223101_crypto_price_cache.sql:22-40`, called at `src/lib/crypto-prices.ts:116`), SECURITY DEFINER + `SET search_path`. A canonical post-bugfix template lives at `20260603130000_fix_on_auth_user_created_search_path.sql:10-20`. No multi-table or jsonb-parsing RPC exists yet.
- **Compensating-delete precedent (not chosen here)** at `src/pages/api/snapshots/index.ts:153-161` with an unchecked delete-error gap.
- **JSON-body endpoint template:** `src/pages/api/user-preferences/index.ts` (`:59-64` `jsonError`, `:134-193` PUT, `:183` `user_id`-injecting upsert). **Error shape** `interface ErrorShape { error: { code; message; context? } }` declared per-file; `context?` is unused so far — the unknown-`category_id` error is its first use.
- **Auth:** middleware covers only `/dashboard` (`src/middleware.ts:4`); `/api/*` self-enforces `createClient` → `supabase.auth.getUser()` → 401. A contract test (`src/pages/api/api-auth-contract.test.ts:21,67`) asserts every API route calls `getUser()` — the two new routes will be held to it.
- **Settings host:** `src/pages/dashboard/settings.astro:43-47` renders one card mounting `<SettingsForm client:load />` (`src/components/settings/SettingsForm.tsx`). The island fetch/error/pending contract (`:44-55`, `:129-145`) and `<ServerError>` (`src/components/auth/ServerError.tsx`) are the templates to copy.
- **No Zod, no `Content-Disposition` precedent, no toast, no Radix Dialog.** Native `<dialog>` modal pattern at `src/components/InstallInstructionsModal.tsx` (`useRef<HTMLDialogElement>` + `showModal()`, `backdrop:bg-black/60`) is the clone target for the destructive confirm.

## Desired End State

From `src/pages/dashboard/settings.astro`, a logged-in user sees a **Backup & Restore** card. Clicking **Export** downloads `bitworth-backup.json` containing every row of their four tables in a versioned envelope. Choosing a file and **Import** lets them pick **Replace all** (guarded by a confirm dialog naming the destruction) or **Merge** (append, with a visible "may create duplicates" caveat). A successful import leaves the account in a consistent state — never partially written — with snapshot history (original timestamps) intact.

Verify by: export a backup, mutate/delete data, re-import in replace mode → account matches the backup (including snapshot dates and the net-worth chart shape); re-import in merge mode → data is appended; importing a file with a bad `category_id` or a newer `schemaVersion` is rejected with a clear message and **zero** rows written.

### Key Discoveries:

- Backup must be **whole-row, column-explicit (whitelist)** — `user_preferences`' FIRE/theme columns and `assets.quantity`/`show_on_chart` are the easy-to-drop fields (`research.md` §"Schema & field completeness").
- The only intra-backup FK edge is `snapshot_items.snapshot_id → snapshots.id` — this dictates delete order (`snapshot_items` first, scoped via parent) and insert order (`snapshots` before `snapshot_items`, remapping the child FK).
- SECURITY DEFINER **bypasses RLS** → the RPC is the *sole* ownership boundary: stamp `user_id = auth.uid()` on every insert, scope every delete `WHERE user_id = auth.uid()`, validate every `category_id`, and carry `SET search_path = public, pg_temp` (the omission that broke signup — `lessons.md:81-89`).
- PostgREST/the RPC reject unknown columns → never insert a parsed row verbatim; **whitelist** per table (`research.md` §"Schema-Evolution Compatibility").

## What We're NOT Doing

- **No formatted reporting** (PDF/CSV exports) — this is data portability, not the parked "Data export" non-goal.
- **No cross-file stable identity / true de-dup** — merge is dumb append with fresh UUIDs; the UI surfaces the duplicate caveat. No `(name, amount, currency, category_id)` heuristic.
- **No forward-migration map** for older backup versions beyond column-whitelist + re-default — older same-major backups import as-is; a future breaking (NOT-NULL-without-default) migration will need an explicit upgrade step added *then*.
- **No new `asset_categories` rows** ever written during restore — global seed, validate-only.
- **No skip-bad-rows partial import** — validation is all-or-nothing, pre-write.
- **No E2E/Playwright** in this plan — deferred to a later `/10x-e2e` pass.
- **No backup of global/cache tables** (`asset_categories`, `crypto_price_cache`).
- **No compensating-delete fallback path** — superseded by the atomic RPC.

## Implementation Approach

Build inside-out so each layer is verifiable before the next depends on it: pure module (Phase 1) → export route that consumes it (Phase 2) → atomic write primitive (Phase 3) → import route that orchestrates validate→prepare→RPC (Phase 4) → UI that drives both routes (Phase 5). The pure module concentrates all the risky logic (versioning, whitelisting, remapping) where it is cheap to unit-test exhaustively; the RPC concentrates atomicity + ownership where Postgres can enforce it; the routes and UI stay thin and mirror existing templates.

## Critical Implementation Details

- **Ownership + search_path in the RPC.** Because `restore_backup` is SECURITY DEFINER it runs as the owner and RLS does not apply. It must therefore: ignore any `user_id`/`id` in the payload and set `user_id = auth.uid()` itself; scope replace-mode deletes with `WHERE user_id = auth.uid()` (and `snapshot_items` via its parent subquery); reject any `category_id` not present in `asset_categories`; and declare `SET search_path = public, pg_temp`. Omitting search_path is the exact failure that broke signup in prod (`lessons.md:81-89`).
- **FK-forced ordering inside the transaction.** Replace: delete `snapshot_items` (scoped through `snapshots WHERE user_id = auth.uid()`) → `snapshots` → `assets`; `user_preferences` is a 1:1 PK-on-user row, so **upsert** it rather than delete (the signup trigger created it and `auth.users` references it). Insert (both modes): `user_preferences`/`assets`/`snapshots` → `snapshot_items` last, with each item's `snapshot_id` already remapped to the new parent id.
- **Where UUID remapping happens.** Generate new `snapshots.id`/`assets.id` and remap `snapshot_items.snapshot_id` in the pure `prepareForImport` (TS), so the payload handed to the RPC is already internally consistent and the plpgsql stays a straight column-whitelisted insert. This keeps the remap logic unit-tested and the SQL minimal.
- **Timestamp preservation.** `created_at`/`updated_at` are insertable and are carried through from the backup (whitelisted). Validate they are ISO-8601 strings in the pure module; do not let raw values reach the insert unchecked.
- **Version gate semantics.** `validateEnvelope` refuses a `schemaVersion` greater than the app's current constant (clear 400), accepts equal/lower of the same major via whitelist (lower-version backups simply omit newer columns, which re-default). Major-version bump is the future breaking-change lever.

---

## Phase 1: Pure backup module + unit tests

### Overview

Create `src/lib/backup.ts` — the single home for envelope shape, column whitelists, serialization, validation, and import preparation (remap + timestamp + whitelist). No Supabase imports; everything is pure and synchronous so it is exhaustively unit-testable. Mirrors the `src/lib/net-worth.ts` pure-helper convention.

### Changes Required:

#### 1. Backup envelope + column whitelists

**File**: `src/lib/backup.ts`

**Intent**: Define the on-disk format and the authoritative per-table column lists so both export and import agree on exactly which fields cross the boundary.

**Contract**: Export `CURRENT_SCHEMA_VERSION` (integer constant) and a `BackupEnvelope` type `{ schemaVersion: number; exportedAt: string; app: "bitworth"; data: { user_preferences: Row[]; assets: Row[]; snapshots: Row[]; snapshot_items: Row[] } }`. Export a frozen whitelist of column names per table (column-explicit, including `created_at`/`updated_at`, all 9 `fire_*`, `quantity`, `show_on_chart`). Row types derive from `Tables<'…'>` in `src/lib/database.types.ts`.

#### 2. `serialize`

**File**: `src/lib/backup.ts`

**Intent**: Turn the four fetched table arrays into a `BackupEnvelope`, projecting each row down to whitelisted columns only.

**Contract**: `serialize(data, exportedAt: string): BackupEnvelope`. `exportedAt` is passed in (no `Date.now()` inside the pure module). Stamps `schemaVersion: CURRENT_SCHEMA_VERSION`, `app: "bitworth"`.

#### 3. `validateEnvelope`

**File**: `src/lib/backup.ts`

**Intent**: Hand-validate an untrusted parsed object before any write — envelope shape, version policy, per-row required-field shape, timestamp format — returning either typed data or a structured error. No Zod (none in repo).

**Contract**: `validateEnvelope(parsed: unknown, validCategoryIds: ReadonlySet<string>): { ok: true; data } | { ok: false; code: string; message: string; context?: unknown }`. Rejects: missing/`app !== "bitworth"`; `schemaVersion` not an int or **greater than** `CURRENT_SCHEMA_VERSION`; malformed rows (missing NOT-NULL-no-default fields per table); non-ISO timestamp strings; any `category_id` (in `assets` or `snapshot_items`) absent from `validCategoryIds`. The `context` field lists offending ids/rows (first use of `ErrorShape.context`). All-or-nothing — one violation fails the whole envelope.

#### 4. `prepareForImport`

**File**: `src/lib/backup.ts`

**Intent**: Transform validated data into RPC-ready, internally-consistent payload: drop ownership fields, regenerate parent UUIDs, remap child FKs, keep only whitelisted columns (incl. preserved timestamps).

**Contract**: `prepareForImport(data, newId: () => string): PreparedBackup`. `newId` is injected (no `crypto.randomUUID()` call inside the pure module, for deterministic tests). Discards incoming `user_id` and row `id` for `assets`/`snapshots`; assigns fresh `snapshots.id`; builds an old→new snapshot-id map and rewrites each `snapshot_items.snapshot_id`; leaves `user_preferences` keyed on user (RPC upserts it). Output contains only whitelisted columns.

#### 5. Unit tests

**File**: `src/lib/backup.test.ts`

**Intent**: Pin every branch of the pure module — the risk concentrates here.

**Contract**: Round-trip (`serialize` → `validateEnvelope` accepts); version gating (newer rejected, equal/older accepted); unknown-key strip; missing-required-field rejection; bad timestamp rejection; unknown `category_id` rejection with `context`; `prepareForImport` regenerates parent ids and remaps every child `snapshot_id` deterministically with a stubbed `newId`. Uses relative import or the `@/` alias (vitest already wired via `vite-tsconfig-paths` — `lessons.md:35-43`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass: `npx vitest run src/lib/backup.test.ts`

#### Manual Verification:

- Reading `backup.ts` confirms every whitelist includes the easy-to-drop fields (9 `fire_*`, `quantity`, `show_on_chart`, both timestamps).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Export endpoint

### Overview

Add `GET /api/backup/export` — self-authenticating, fetches all four user-owned tables scoped to the caller, serializes via `backup.ts`, and returns a downloadable JSON attachment. First `Content-Disposition` response in the repo.

### Changes Required:

#### 1. Export route

**File**: `src/pages/api/backup/export.ts`

**Intent**: Stream the user's full backup as a file download.

**Contract**: `export const GET: APIRoute = async ({ request, cookies }) => …`. Two-step auth (`createClient` → `supabase.auth.getUser()` → 401 `UNAUTHORIZED` via local `jsonError`/`ErrorShape`, mirroring `assets/index.ts:9-32`). Selects whitelisted columns from each of the four tables filtered to the user (`snapshot_items` via `snapshot_id IN (user's snapshots)`); on any fetch error returns 500 `FETCH_FAILED`. Calls `serialize(data, new Date().toISOString())` and returns `new Response(JSON.stringify(envelope), { status: 200, headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=\"bitworth-backup.json\"" } })`.

#### 2. Auth/error contract test

**File**: `src/pages/api/backup/export.test.ts`

**Intent**: Satisfy the project's API-auth contract and pin the error shape.

**Contract**: Asserts the handler calls `supabase.auth.getUser()` and returns 401 with `{ error: { code, message } }` when unauthenticated; 200 + `Content-Disposition` when authed. Follow the existing `api-auth-contract.test.ts` style and the `MockSupabaseClient` `asClient` cast helper noted in project memory.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Route tests pass: `npx vitest run src/pages/api/backup/export.test.ts`
- API-auth contract test still passes: `npx vitest run src/pages/api/api-auth-contract.test.ts`

#### Manual Verification:

- `GET /api/backup/export` while logged in downloads `bitworth-backup.json`; the file opens as valid JSON with all four tables populated and the envelope header fields.
- Logged-out request returns 401.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: `restore_backup` RPC migration

### Overview

Add the atomic write primitive: a SECURITY DEFINER plpgsql function that, in one transaction, either replaces or merges a prepared backup payload for the calling user. This is the first multi-table / jsonb-parsing RPC in the repo — author the jsonb syntax against current Postgres docs (fetch via Context7; research found zero in-repo precedent).

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_restore_backup_rpc.sql`

**Intent**: Provide true atomicity and act as the sole ownership boundary for restore.

**Contract**: `CREATE OR REPLACE FUNCTION restore_backup(p_mode text, p_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`. Behavior:
- Resolve `v_user := auth.uid()`; raise if null.
- Validate `p_mode IN ('replace','merge')`.
- **replace:** `DELETE FROM snapshot_items WHERE snapshot_id IN (SELECT id FROM snapshots WHERE user_id = v_user)`; `DELETE FROM snapshots WHERE user_id = v_user`; `DELETE FROM assets WHERE user_id = v_user`. (Do not delete `user_preferences`.)
- **both modes:** upsert `user_preferences` (onConflict `user_id`) from `p_data->'user_preferences'` with `user_id = v_user`; insert `assets` and `snapshots` with `user_id = v_user`; insert `snapshot_items` last (FKs already remapped by `prepareForImport`). Every insert is **column-explicit** (whitelist) and stamps/overrides `user_id = v_user`. Preserve `created_at`/`updated_at` from the payload.
- Category validation is already done in TS, but the RESTRICT FK is the backstop — a bad id raises inside the transaction and rolls the whole thing back.
- The entire function body is one implicit transaction → any failure leaves the account untouched.

Follow the SECURITY DEFINER template at `20260603130000_…:10-20`. Use `jsonb_populate_recordset` / `jsonb_array_elements` per current Postgres docs.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh DB: `supabase db reset` (or `supabase migration up`)
- Types regenerate without error: `npx astro sync` (the new RPC appears in `database.types.ts`)
- Linting passes: `npm run lint`

#### Manual Verification:

- Calling `select restore_backup('replace', '<prepared json>')` as an authed role replaces only the caller's rows; a second user's data is untouched.
- A payload with an unknown `category_id` rolls back entirely (no partial rows) and raises.
- `SET search_path` is present (grep the migration).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Import endpoint

### Overview

Add `POST /api/backup/import` — self-authenticating; reads the parsed JSON body, validates + prepares it via `backup.ts`, then calls `restore_backup`. All-or-nothing: nothing is written unless the whole envelope validates.

### Changes Required:

#### 1. Import route

**File**: `src/pages/api/backup/import.ts`

**Intent**: Orchestrate validate → prepare → atomic restore, translating every failure into the canonical error shape.

**Contract**: `export const POST: APIRoute = async ({ request, cookies }) => …`. Two-step auth → 401. Body via `request.json()` in try/catch (NOT `formData`); 400 `VALIDATION_ERROR` on parse failure. Read `mode` (`'replace' | 'merge'`, default reject if absent/invalid). Fetch valid category ids (`select id from asset_categories`) → build the set → `validateEnvelope(parsed, ids)`; on `{ ok: false }` return 400 with its `code`/`message`/`context`. `prepareForImport(validated.data, () => crypto.randomUUID())` → `supabase.rpc("restore_backup", { p_mode: mode, p_data })`; on RPC error return 500 `RESTORE_FAILED` (include the PG message in `context`). 200 on success. Never trust body `user_id`/`id`.

#### 2. Auth/error contract test

**File**: `src/pages/api/backup/import.test.ts`

**Intent**: Pin auth, mode validation, version-reject, bad-category-reject, and the success path.

**Contract**: 401 unauthenticated; 400 on missing/invalid `mode`; 400 on newer `schemaVersion`; 400 with `context` listing the offending id on unknown `category_id` **and asserts the RPC was not called**; 200 calling `restore_backup` with the prepared payload on a valid file. Uses the `MockSupabaseClient` `asClient` helper.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Route tests pass: `npx vitest run src/pages/api/backup/import.test.ts`
- API-auth contract test still passes: `npx vitest run src/pages/api/api-auth-contract.test.ts`

#### Manual Verification:

- Export → delete some assets → import replace → account matches the backup (rows, snapshot dates, chart shape).
- Import merge → data is appended (duplicates expected, not an error).
- Import a file with a hand-edited unknown `category_id` → 400, zero rows written.
- Import a file with `schemaVersion` bumped above current → 400, zero rows written.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 5.

---

## Phase 5: Settings UI island

### Overview

Add a **Backup & Restore** card to the settings page mounting a new React island that drives export download and import (replace/merge), with a native `<dialog>` confirm for the destructive replace and an inline amber caveat for merge.

### Changes Required:

#### 1. Backup/restore island

**File**: `src/components/settings/BackupRestore.tsx`

**Intent**: One self-contained island for both operations, mirroring `SettingsForm.tsx`'s fetch/error/pending contract.

**Contract**: **Export** button → `fetch("/api/backup/export")` → blob → trigger download (anchor + `URL.createObjectURL`), pending spinner. **Import**: a file `<input type="file" accept="application/json">` + a mode control (Replace all / Merge); reads the file as text, `POST`s `{ ...parsedJson, mode }` (or sends mode separately) to `/api/backup/import`, reads `(await res.json()) as { error?: { message } }`, surfaces failure via `<ServerError message={…} />`. **Replace** requires confirmation through a cloned native `<dialog>` (`useRef<HTMLDialogElement>` + `showModal()`, `backdrop:bg-black/60`, per `InstallInstructionsModal.tsx`) that names the destruction. **Merge** shows an inline amber banner (styled like `ServerError.tsx`, amber not red): "Merge appends a copy of the file's data — importing the same file twice creates duplicates." Obeys `react-compiler` rules (no manual memo hacks).

#### 2. Mount on settings page

**File**: `src/pages/dashboard/settings.astro`

**Intent**: Surface the feature as a sibling card after the existing settings card.

**Contract**: Add a card block after `:47` mounting `<BackupRestore client:load />`. No server props needed (the island fetches its own endpoints).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes (incl. `react-compiler` error rule): `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Settings page shows the Backup & Restore card.
- Export downloads the file; import with Replace shows the confirm dialog and only restores on confirm; Cancel aborts with no write.
- Merge shows the amber caveat; importing appends.
- A failed import (bad file) surfaces a readable `ServerError` message; the page does not crash.
- Works on iOS Safari (file input + dialog) — see `feedback_radix_dropdown_ios` if any pointer-event quirk appears (not Radix here, but the same iOS gotcha class).

**Implementation Note**: After automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `src/lib/backup.test.ts` — the heart of coverage: round-trip serialize↔validate, version gating (newer reject / older accept), unknown-key strip, missing-required-field reject, bad-timestamp reject, unknown-`category_id` reject with `context`, deterministic UUID remap of `snapshot_items.snapshot_id` via stubbed `newId`.

### Integration / Contract Tests:

- `export.test.ts`, `import.test.ts` — auth (401), error shape, `Content-Disposition` on export, mode validation + version/category rejection + RPC-not-called assertions + success path on import. Must keep `api-auth-contract.test.ts` green.

### Manual Testing Steps:

1. Export a backup of a populated account; open the JSON and confirm all four tables + envelope fields, including FIRE/theme/`quantity`/`show_on_chart` and original timestamps.
2. Delete/modify data, import in **replace** mode (confirm dialog), verify the account is restored exactly — including the net-worth chart shape and snapshot dates.
3. Import in **merge** mode; verify rows are appended and the amber caveat was shown.
4. Hand-edit a file to an unknown `category_id`; import → 400, **zero** rows changed.
5. Bump `schemaVersion` above current; import → 400, zero rows changed.
6. Cross-account check: a second user's import never touches the first user's rows (RPC `auth.uid()` scoping).
7. iOS Safari: file picker + replace dialog behave.

## Performance Considerations

Backups are per-user and small (a personal finance account is hundreds, not millions, of rows). The RPC does a handful of bulk inserts in one transaction — no pagination or streaming needed. Export selects whitelisted columns only. No hot path; no caching required.

## Migration Notes

- One new migration (`restore_backup` RPC). It is additive — no existing table/column changes, no data migration. Apply via the normal `supabase migration up` / Cloudflare deploy flow.
- **Prod `asset_categories` caveat (open risk):** the 13 categories come from `seed.sql`, which runs on `db reset`/`start`, **not** `migration up`. Before relying on category validation in prod, confirm the 13 rows exist; if a prod DB was built from migrations only, every category-FK insert RESTRICT-fails. Verify during Phase 3/4 rollout. (research.md §"Schema & field completeness" prod caveat; Open Question #3.)

## References

- Related research: `context/changes/data-backup-import-export/research.md`
- Change identity: `context/changes/data-backup-import-export/change.md`
- Lessons (priors): `context/foundation/lessons.md` §§"multi-table writes atomic", "RLS USING-only", "no unique constraint", "SECURITY DEFINER search_path"
- RPC template: `supabase/migrations/20260603130000_fix_on_auth_user_created_search_path.sql:10-20`
- JSON-body + error-shape template: `src/pages/api/user-preferences/index.ts:59-64,134-193`
- Multi-table write precedent (superseded): `src/pages/api/snapshots/index.ts:110-161`
- Settings island mount: `src/pages/dashboard/settings.astro:43-47`; `src/components/settings/SettingsForm.tsx:44-55,129-145`
- Confirm-dialog clone: `src/components/InstallInstructionsModal.tsx`; error banner: `src/components/auth/ServerError.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure backup module + unit tests

#### Automated

- [x] 1.1 Type checking passes (`npx astro sync && npx tsc --noEmit`) — 762588a
- [x] 1.2 Linting passes (`npm run lint`) — 762588a
- [x] 1.3 Unit tests pass (`npx vitest run src/lib/backup.test.ts`) — 762588a

#### Manual

- [x] 1.4 Whitelists include all easy-to-drop fields (9 `fire_*`, `quantity`, `show_on_chart`, both timestamps) — 762588a

### Phase 2: Export endpoint

#### Automated

- [x] 2.1 Type checking passes (`npx tsc --noEmit`) — 2350593
- [x] 2.2 Linting passes (`npm run lint`) — 2350593
- [x] 2.3 Route tests pass (`npx vitest run src/pages/api/backup/export.test.ts`) — 2350593
- [x] 2.4 API-auth contract test still passes (`npx vitest run src/pages/api/api-auth-contract.test.ts`) — 2350593

#### Manual

- [x] 2.5 Authed GET downloads valid `bitworth-backup.json` with all four tables + envelope — 2350593
- [x] 2.6 Logged-out request returns 401 — 2350593

### Phase 3: restore_backup RPC migration

#### Automated

- [x] 3.1 Migration applies cleanly (`supabase db reset` / `migration up`)
- [x] 3.2 Types regenerate (`npx astro sync`, RPC present in `database.types.ts`)
- [x] 3.3 Linting passes (`npm run lint`)

#### Manual

- [x] 3.4 `restore_backup('replace', …)` replaces only the caller's rows; other users untouched
- [x] 3.5 Unknown `category_id` rolls back entirely (no partial rows)
- [x] 3.6 `SET search_path = public, pg_temp` present in the migration

### Phase 4: Import endpoint

#### Automated

- [ ] 4.1 Type checking passes (`npx tsc --noEmit`)
- [ ] 4.2 Linting passes (`npm run lint`)
- [ ] 4.3 Route tests pass (`npx vitest run src/pages/api/backup/import.test.ts`)
- [ ] 4.4 API-auth contract test still passes (`npx vitest run src/pages/api/api-auth-contract.test.ts`)

#### Manual

- [ ] 4.5 Export→delete→import replace restores account exactly (rows, dates, chart)
- [ ] 4.6 Import merge appends data (duplicates expected, not an error)
- [ ] 4.7 Unknown `category_id` → 400, zero rows written
- [ ] 4.8 Newer `schemaVersion` → 400, zero rows written

### Phase 5: Settings UI island

#### Automated

- [ ] 5.1 Type checking passes (`npx tsc --noEmit`)
- [ ] 5.2 Linting passes incl. `react-compiler` (`npm run lint`)
- [ ] 5.3 Build succeeds (`npm run build`)

#### Manual

- [ ] 5.4 Backup & Restore card visible on settings page
- [ ] 5.5 Export downloads; Replace shows confirm dialog and only restores on confirm; Cancel aborts with no write
- [ ] 5.6 Merge shows amber caveat and appends
- [ ] 5.7 Failed import surfaces readable `ServerError`; page does not crash
- [ ] 5.8 File input + dialog work on iOS Safari
