# Asset List Reordering (Drag-and-Drop) Implementation Plan

## Overview

Give the assets page a user-controlled row order. Today the list is locked to reverse-chronological (`created_at DESC`) — the order assets happened to be entered in. This adds a persisted `assets.sort_order`, an atomic reorder write path, and an explicit "Edit list" mode that reveals a drag handle on every row so the user can arrange the list the way they think about their portfolio.

Roadmap slice `S-25` (Stream M, Assets-page UX). Prerequisites `F-01`, `S-01`, `S-07` are all shipped.

## Current State Analysis

**The two list renderings.** `src/components/assets/AssetList.tsx` is a `client:load` React island that renders the same `filtered` array twice: a desktop `<table>` of `AssetRow` (`AssetList.tsx:101-124`) and a mobile `<ul>` of `AssetCard` (`AssetList.tsx:125-136`). Both must grow a drag handle. The component holds **no local copy** of `assets` — `filtered` is derived straight from props on every render (`AssetList.tsx:32-36`), so optimistic reordering needs new local state.

**The two ordered read paths.** `src/pages/dashboard/assets/index.astro:25` and `src/pages/api/assets/index.ts:38` both end in `.order("created_at", { ascending: false })`. These are the only two reads that impose an order; the four aggregate reads (`dashboard.astro:38`, `forecast.astro:21`, `fire.astro:21`, `balancer.astro:20`) are unordered and stay that way — row order is meaningless for sum math.

**The `assets` table.** `supabase/migrations/20260529190856_initial_schema.sql:28-40`. RLS already pairs `USING` with `WITH CHECK` (`20260602235644_rls_with_check.sql`), so a new column inherits correct write-scope isolation with no policy change. Critically, `assets_updated_at` is a `BEFORE UPDATE ... FOR EACH ROW` trigger (`initial_schema.sql:115-116`) that unconditionally stamps `NEW.updated_at = NOW()`.

**Two safety nets already exist.** `src/lib/backup-rpc-parity.test.ts` parses the newest migration declaring `restore_backup` and asserts its `INSERT INTO assets (...)` column list equals `ASSETS_COLUMNS` from `backup.ts` (modulo `id`). `src/pages/api/api-auth-contract.test.ts:49-70` walks every `.ts` under `src/pages/api/` and fails any route lacking `supabase.auth.getUser()` or a public-route justification comment. The two risks S-25 flags hardest — the backup blind spot and a missing auth check — are already instrumented in CI.

**Conventions to follow.** `PATCH` + `await request.json()` is well-precedented (`goals/[id].ts`, `snapshots/[id].ts`, `allocation-cards/[id].ts`); the asset routes themselves still use `formData`. RPC calls go through `supabase.rpc(...)` (`backup/import.ts:68`). API tests use `createSupabaseMock` from `@/test-utils/supabase-mock`, whose client already exposes and records `.rpc()` (`supabase-mock.ts:36,118-119`).

**Dependency check (verified, not assumed).** `@dnd-kit/core@6.3.1` and `@dnd-kit/sortable@10.0.0` declare `peerDependencies.react: ">=16.8.0"` — React 19.2.6 satisfies it. The next-gen `@dnd-kit/react@0.5.0` declares `^18 || ^19` explicitly but is pre-1.0; we take the stable legacy pair.

## Desired End State

On `/dashboard/assets`, an **Edit list** button toggles a mode that reveals a grip handle on every row (desktop table and mobile cards alike). Dragging a handle reorders the list immediately; the new order is written through in the background and survives a reload, a different device, and a backup export/import round-trip. Leaving edit mode returns the list to its normal read/act state with Edit and Delete untouched. The handles are keyboard-operable and announce moves to screen readers.

Verify by: reordering three assets, reloading the page, and seeing the order hold; exporting a backup, wiping, re-importing, and seeing the order hold; tabbing to a handle and moving a row with Space + arrows.

### Key Discoveries

- Both ordered read paths are exactly two lines: `src/pages/dashboard/assets/index.astro:25`, `src/pages/api/assets/index.ts:38`.
- `src/pages/api/backup/export.ts:27` builds its PostgREST projection as `ASSETS_COLUMNS.join(", ")` — adding `"sort_order"` to the whitelist automatically pulls it into the export select. **No change to `export.ts` is needed.**
- `backup-rpc-parity.test.ts` turns the "column added to export but missed in the RPC" failure into a red run. That bug has shipped three times (`show_fire_dashboard`/`show_drift_alerts`, `metal_symbol`, `show_trajectory`); the guard is the reason Phase 1 can safely bundle both halves.
- `assets_updated_at` fires on every row of a blanket renumber. Since `updated_at` is in `ASSETS_COLUMNS`, a full-table renumber would churn every backup export too.
- `restore_backup` is `SECURITY DEFINER` with `SET search_path = public, pg_temp` and `REVOKE ... FROM PUBLIC, anon` / `GRANT ... TO authenticated` (`20260621000000_restore_backup_grants.sql`). The new RPC copies that posture exactly — `lessons.md` §"SECURITY DEFINER functions need an explicit `SET search_path`".
- `lessons.md` §"DB multi-table writes must be atomic" generalizes here: a loop of per-row `UPDATE`s would leave an order that is neither the old one nor the new one. One statement, or nothing.

## What We're NOT Doing

- **Not ordering the aggregate reads.** `dashboard.astro`, `balancer.astro`, `fire.astro`, `forecast.astro` fetch assets for sum math; they stay unordered.
- **Not ordering anything but the assets list** — snapshot items, top movers, trend charts, and allocation cards keep their existing ordering rules.
- **Not adding a new toast/notification system.** Reorder failures reuse the inline `deleteError` banner already in `AssetList` (`AssetList.tsx:66-71`).
- **Not adding cross-list or cross-category drag.** One flat list, vertical only.
- **Not adding new E2E specs.** Coverage is unit + API integration; the drag interaction is verified manually (see Phase 4).
- **Not bumping `CURRENT_SCHEMA_VERSION`.** Adding a column to an existing table is the `metal_symbol`/`show_on_chart` case, not the `goals` case — a bump would make new files unreadable by older deploys for no benefit. An older file simply carries no `sort_order`, which `COALESCE`s to `0` and falls back to the `created_at` tiebreak.
- **Not converting the asset POST/PUT routes from `formData` to JSON.** Out of scope.

## Implementation Approach

Bottom-up, in the order the roadmap's dependency chain implies: make the data model able to hold an order and round-trip it (Phase 1), make the server read and write that order (Phase 2), then put a direct-manipulation surface on top (Phases 3-4). Each phase leaves the app in a working, shippable state — after Phase 2 the ordering is real and API-addressable, it just has no UI yet.

The pure index math lives in `src/lib/asset-order.ts` so the reorder logic is exercised by unit tests, not only through the DOM.

## Critical Implementation Details

**Ordering totality.** `sort_order` alone is not a total order — two rows can share a value (after restoring a pre-`sort_order` backup, *every* row shares `0`). Every ordered read must therefore be `.order("sort_order", { ascending: true }).order("created_at", { ascending: false })`. The `created_at` tiebreak is what makes the order deterministic and makes a `sort_order`-less backup degrade gracefully to today's behavior instead of to an arbitrary shuffle.

**Trigger suppression is migration-only.** The Phase 1 backfill disables `assets_updated_at` around its `UPDATE`, because otherwise the deploy stamps `updated_at = NOW()` on every asset in the database. That is acceptable inside a migration transaction that already holds a lock from `ALTER TABLE ADD COLUMN`. It is **not** acceptable at runtime — the reorder RPC must never disable a trigger; it avoids the bump by only writing rows whose value actually changes.

**Optimistic-save ordering.** On drop: update local state first, then fire the request. On failure, restore the array captured *before* the local update — not a recomputed inverse move, which desynchronizes if a second drop lands while the first is in flight. Guard concurrent drops by ignoring drags while a save is in flight, or by keying the revert to the most recent known-good array.

## Phase 1: Data Layer — column, backfill, reorder RPC, backup round-trip

### Overview

Add `assets.sort_order`, seed it from today's visible order so nothing shuffles on deploy, add the atomic `reorder_assets` RPC, and thread the column through both halves of the backup round-trip in the same phase. Bundling backup here is deliberate: `lessons.md` and the existence of `20260712130000_restore_backup_metal_symbol.sql` both say a new `assets` column and its `restore_backup` entry must land together, or a restore silently discards it.

### Changes Required:

#### 1. Column and backfill migration

**File**: `supabase/migrations/20260727120000_assets_sort_order.sql`

**Intent**: Add the ordering column and seed it from each user's current `created_at DESC` view, so the list looks identical the moment the migration lands. Suppress the `updated_at` trigger across the backfill so a deploy does not rewrite every asset's timestamp.

**Contract**: `ALTER TABLE assets ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;` followed by a per-user backfill and an index supporting the new read order. No RLS change (the existing `USING`/`WITH CHECK` pair covers the column). Header comment follows the `20260619120000_assets_show_on_chart.sql` style, including a rollback note (`DROP COLUMN`). The trigger dance is the non-obvious part:

```sql
ALTER TABLE assets DISABLE TRIGGER assets_updated_at;

UPDATE assets a
SET sort_order = t.rn
FROM (
  SELECT id,
         (row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) - 1)::int AS rn
  FROM assets
) t
WHERE a.id = t.id;

ALTER TABLE assets ENABLE TRIGGER assets_updated_at;

CREATE INDEX idx_assets_user_sort ON assets(user_id, sort_order, created_at DESC);
```

#### 2. Reorder RPC and grants migration

**File**: `supabase/migrations/20260727120100_reorder_assets_rpc.sql`

**Intent**: Renumber the caller's assets from an ordered id array in a single statement, so a partial write is impossible. Scoped to `auth.uid()` so a foreign id can never touch another user's row, and validating that the array is a complete, duplicate-free cover of the caller's assets so a stale client fails loudly instead of scrambling the list.

**Contract**: `reorder_assets(p_ids uuid[]) RETURNS void`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, raising when `auth.uid()` is null. Grants mirror `20260621000000_restore_backup_grants.sql` exactly: `REVOKE EXECUTE ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`.

The validation and the single-statement update are both load-bearing enough to pin here:

```sql
-- One check covers three failure modes at once: duplicate ids, ids belonging to
-- another user, and an array that does not cover every asset the caller owns.
-- Any of those would otherwise leave duplicate or stale sort_order values.
IF (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> array_length(p_ids, 1)
   OR (SELECT count(*) FROM assets WHERE user_id = v_user AND id = ANY(p_ids))
      <> array_length(p_ids, 1)
   OR (SELECT count(*) FROM assets WHERE user_id = v_user) <> array_length(p_ids, 1)
THEN
  RAISE EXCEPTION 'reorder_assets: id array is not a complete, unique cover of the caller''s assets';
END IF;

-- `IS DISTINCT FROM` is what keeps `assets_updated_at` off the untouched rows.
UPDATE assets a
SET sort_order = n.rn
FROM (
  SELECT id, (ordinality - 1)::int AS rn
  FROM unnest(p_ids) WITH ORDINALITY AS t(id, ordinality)
) n
WHERE a.id = n.id
  AND a.user_id = v_user
  AND a.sort_order IS DISTINCT FROM n.rn;
```

#### 3. `restore_backup` threading migration

**File**: `supabase/migrations/20260727130000_restore_backup_sort_order.sql`

**Intent**: Carry `sort_order` across the import half of the backup round-trip. Without this the column exports fine and is silently dropped on restore — the exact bug the `metal_symbol` migration exists to fix.

**Contract**: `CREATE OR REPLACE FUNCTION restore_backup(p_mode text, p_data jsonb)` copied verbatim from `20260724150000_restore_backup_goals.sql`, with `sort_order` added to the `INSERT INTO assets (...)` column list and `COALESCE(r.sort_order, 0)` added to the matching `SELECT` (the column is `NOT NULL`, so the `COALESCE` is required for older files, mirroring how `show_on_chart` is handled at line 147 of that migration). Everything else — `search_path`, `SECURITY DEFINER`, delete ordering, the other four inserts — is unchanged. Header comment explains that a pre-`sort_order` backup restores every asset to `0` and therefore falls back to the `created_at` tiebreak, which reproduces today's order.

#### 4. Backup export whitelist

**File**: `src/lib/backup.ts`

**Intent**: Add `sort_order` to the assets export whitelist so the column reaches the file at all.

**Contract**: One entry appended to `ASSETS_COLUMNS` (`backup.ts:55-69`). The `as const satisfies readonly (keyof AssetRow)[]` assertion means this fails `tsc` until `database.types.ts` carries the column. `REQUIRED_FIELDS.assets` and `TIMESTAMP_FIELDS.assets` are **not** touched — `sort_order` has a DB default, so an older file omitting it must stay valid.

#### 5. Generated types

**File**: `src/lib/database.types.ts`

**Intent**: Reflect the new column and the new RPC so the Supabase client is typed correctly.

**Contract**: `sort_order: number` on the `assets` `Row`, optional on `Insert` and `Update`; a `reorder_assets` entry under `Functions` with `Args: { p_ids: string[] }` and `Returns: undefined`. Regenerate rather than hand-edit where possible; the `restore_backup` precedent is recorded at `context/archive/2026-06-20-data-backup-import-export/plan.md:197`.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly from scratch: `supabase db reset`
- Backup round-trip parity holds: `npx vitest run src/lib/backup-rpc-parity.test.ts`
- Backup serialization tests pass: `npx vitest run src/lib/backup.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full unit suite passes: `npm run test:run`

#### Manual Verification:

- After `supabase db reset` on a database seeded with several assets, the assets page order is unchanged from before the migration
- `SELECT id, sort_order, updated_at FROM assets ORDER BY sort_order` shows contiguous `0..N-1` per user, and `updated_at` values are unchanged by the backfill
- Calling `reorder_assets` with a partial or foreign-id array raises rather than partially renumbering

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Order-aware reads, top-slot inserts, and the reorder endpoint

### Overview

Make the server read and write the custom order. After this phase the feature is functionally complete and API-addressable; only the drag surface is missing.

### Changes Required:

#### 1. Pure ordering helper

**File**: `src/lib/asset-order.ts` (new)

**Intent**: Isolate the index math so it is unit-tested directly rather than only through the DOM, per the S-25 risk note. No Supabase imports, no side effects — mirrors the `net-worth.ts` / `backup.ts` pure-module convention.

**Contract**: Two exports.
`moveId(ids: readonly string[], activeId: string, overId: string): string[]` — returns a new array with `activeId` relocated to `overId`'s index; returns a copy unchanged when either id is absent or the two are equal.
`topSortOrder(existing: readonly number[]): number` — returns `Math.min(...existing) - 1`, or `0` for an empty list.

#### 2. Ordered read paths

**Files**: `src/pages/dashboard/assets/index.astro`, `src/pages/api/assets/index.ts`

**Intent**: Switch both reads from creation order to the user's custom order.

**Contract**: At `index.astro:25` and `api/assets/index.ts:38`, replace the single `.order("created_at", { ascending: false })` with `.order("sort_order", { ascending: true }).order("created_at", { ascending: false })`. Both lines change identically; the `created_at` tiebreak is required, not decorative (see Critical Implementation Details).

#### 3. Top-slot placement for new assets

**File**: `src/pages/api/assets/index.ts`

**Intent**: A newly created asset takes the top slot, preserving today's newest-first feel so the migration is invisible to users who never reorder.

**Contract**: In the `POST` handler, before the insert at line 119, read the caller's current minimum via `.select("sort_order").eq("user_id", user.id).order("sort_order", { ascending: true }).limit(1)`, feed it through `topSortOrder`, and include the result in the insert payload. A concurrent double-add can produce two rows sharing the value; the `created_at DESC` tiebreak keeps the order total, so no locking is needed.

#### 4. Reorder endpoint

**File**: `src/pages/api/assets/order.ts` (new)

**Intent**: Expose the atomic RPC to the browser behind the project's standard auth check and error shape.

**Contract**: `PATCH /api/assets/order`. Auth block copied from `assets/index.ts:9-32` (`createClient` → `supabase.auth.getUser()` → 401 on either failure) — required, since `api-auth-contract.test.ts` walks this file. Body is JSON `{ ids: string[] }` (the `request.json()` idiom from `goals/[id].ts`); a non-array, empty, or non-string-element `ids` returns `400 VALIDATION_ERROR`. On success calls `supabase.rpc("reorder_assets", { p_ids: ids })` and returns `200 { data: { count: ids.length } }`. Any RPC error returns `500 REORDER_FAILED` carrying the Postgres message, matching the `RESTORE_FAILED` handling at `backup/import.ts:68-80`. Every error body uses the project `ErrorShape` (`{ error: { code, message, context? } }`).

#### 5. Tests

**Files**: `src/lib/asset-order.test.ts` (new), `src/pages/api/assets/order.test.ts` (new)

**Intent**: Pin the pure math exhaustively and the endpoint's contract at its boundaries.

**Contract**: `asset-order.test.ts` covers `moveId` (move down, move up, move to first, move to last, unknown `activeId`, unknown `overId`, `activeId === overId`, single-element list, input array not mutated) and `topSortOrder` (empty → `0`, all-zeros → `-1`, negative values already present, single element). `order.test.ts` follows the `backup/import.test.ts` harness — `vi.hoisted` factory + `vi.mock("@/lib/supabase")` + `createSupabaseMock`/`createCookiesStub` — asserting: 401 unauthenticated; 400 on a missing, non-array, empty, or non-string-element `ids`; 200 on success **with `rpc` recorded as `("reorder_assets", { p_ids: [...] })`** via `findCall`; 500 `REORDER_FAILED` when the mocked rpc returns an error; and that a rejected validation makes **no** rpc call at all.

### Success Criteria:

#### Automated Verification:

- New unit tests pass: `npx vitest run src/lib/asset-order.test.ts`
- New endpoint tests pass: `npx vitest run src/pages/api/assets/order.test.ts`
- The API auth contract still holds for the new route: `npx vitest run src/pages/api/api-auth-contract.test.ts`
- Existing asset endpoint tests still pass: `npx vitest run src/pages/api/assets`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full unit suite passes: `npm run test:run`

#### Manual Verification:

- `curl -X PATCH /api/assets/order` with a reordered id array returns 200, and reloading `/dashboard/assets` shows the new order
- Adding a new asset places it at the top of the list
- A reorder request leaves `updated_at` untouched on assets whose position did not change

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Edit mode and drag-and-drop

### Overview

Add the direct-manipulation surface: an Edit list toggle, grip handles on both renderings, and optimistic save on each drop.

### Changes Required:

#### 1. Drag dependency

**File**: `package.json`

**Intent**: Add the drag toolkit.

**Contract**: `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2` as dependencies. Peer range `react: ">=16.8.0"` is satisfied by React 19.2.6 (verified against the registry during planning).

**Note**: stop the dev server before installing. A lockfile change mid-session corrupts the Vite SSR cache in a way `rm -rf node_modules/.vite` does not recover from.

#### 2. Edit mode and drag orchestration

**File**: `src/components/assets/AssetList.tsx`

**Intent**: Own the edit-mode toggle, the locally-ordered copy of the list, the dnd-kit context, and the optimistic save.

**Contract**:
- New state: `editing: boolean`, `ordered: AssetWithCategory[]` seeded from the `assets` prop, and `savingOrder: boolean`. `filtered` derives from `ordered` instead of the prop (`AssetList.tsx:32-36`).
- An **Edit list** / **Done** toggle button rendered beside the filter tabs. `disabled` whenever `filter !== "all"`, with a short hint explaining that reordering happens on the All tab. Switching away from All while editing exits edit mode.
- `<DndContext>` + `<SortableContext items={ids} strategy={verticalListSortingStrategy}>` wraps both the `<tbody>` and the `<ul>` — rendered only when `editing` is true, so the non-editing render path is byte-for-byte today's.
- Sensors: `PointerSensor` with an activation distance constraint (a few px) so a tap on the handle is not a drag. `KeyboardSensor` is added in Phase 4.
- `onDragEnd`: capture the pre-move array, compute the next order with `moveId` from `@/lib/asset-order`, `setOrdered` immediately, then `PATCH /api/assets/order` with the new id array. On a non-ok response or a thrown fetch, restore the captured array and set the error message. Ignore drag starts while `savingOrder` is true.
- Failures reuse the existing inline error banner (`AssetList.tsx:66-71`) — rename `deleteError` to a shared `listError` (or add a sibling state rendered by the same banner). No new notification system.
- `react-compiler` is an error-level lint rule here: keep the drop handler free of mutation on the existing arrays — `moveId` already returns a new array.

#### 3. Desktop row handle

**File**: `src/components/assets/AssetRow.tsx`

**Intent**: Make each `<tr>` sortable and give it a grip handle in edit mode.

**Contract**: New props `editing: boolean`. Uses `useSortable({ id: asset.id })`; `setNodeRef` and the `CSS.Transform.toString(transform)` + `transition` style go on the `<tr>` (table rows need the transform applied to the row element itself, not a wrapper). A leading `<td>` renders a `GripVertical` handle only when `editing` — wired with `setActivatorNodeRef` **and** `listeners`/`attributes`, which is what keeps keyboard focus restoration correct in Phase 4. The handle carries `touch-action: none` and generous padding for a thumb target. The header row in `AssetList` gains a matching empty `<th>` when editing so the columns stay aligned.

#### 4. Mobile card handle

**File**: `src/components/assets/AssetCard.tsx`

**Intent**: The same handle on the `<li>` card.

**Contract**: Same `editing` prop and `useSortable` wiring, applied to the `<li>`. Handle sits at the leading edge of the card's top row, visible only when `editing`, with `touch-action: none`. **The card body itself is never a drag surface** — vertical swipes anywhere else on the card must still scroll the page. This is the specific mitigation for the iOS Safari pointer-event class of bug already recorded in memory for the Radix dropdown.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes, including `react-compiler`: `npm run lint`
- Production build succeeds: `npm run build`
- Full unit suite passes with no regressions: `npm run test:run`

#### Manual Verification:

- Edit list reveals handles on the desktop table; dragging a row reorders it and the order survives a reload
- Edit list reveals handles on the mobile card list at a narrow viewport; same reorder and persistence
- The Edit list toggle is disabled on the Assets and Liabilities tabs with a visible hint
- Done hides the handles and leaves Edit / Delete working exactly as before
- Simulating a failed `PATCH` (offline, or a forced 500) snaps the list back to its previous order and shows the inline error
- On a real iOS device or the installed PWA, a vertical swipe on a card body scrolls the page rather than starting a drag, while a swipe from the handle drags

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Keyboard, screen-reader, and cross-device verification

### Overview

Close the accessibility path so the feature is not pointer-only, and run the device checks that automated verification cannot cover. Small in code, deliberately separate so the manual checks get their own checkpoint rather than being buried under Phase 3.

### Changes Required:

#### 1. Keyboard sensor and announcements

**File**: `src/components/assets/AssetList.tsx`

**Intent**: Make reordering reachable without a pointer and audible to screen readers.

**Contract**: Add `KeyboardSensor` with `sortableKeyboardCoordinates` to the sensor list (Space/Enter grabs, arrows move, Esc cancels, Space/Enter drops). Configure `DndContext`'s `accessibility.announcements` for `onDragStart`, `onDragOver`, `onDragEnd`, and `onDragCancel`, phrased against asset names and 1-based positions — e.g. "Moved Checking Account to position 2 of 7" — not raw UUIDs. Also supply `screenReaderInstructions` describing the grab-and-arrow interaction, since it is not self-evident.

#### 2. Accessible handle names

**Files**: `src/components/assets/AssetRow.tsx`, `src/components/assets/AssetCard.tsx`

**Intent**: Give each handle a name that identifies its row, so it is distinguishable by screen reader and addressable by role.

**Contract**: Each handle is a `<button type="button">` with an accessible name including the asset name (e.g. `aria-label="Reorder Checking Account"`). This satisfies the project's E2E locator rule (`getByRole`, never CSS selectors) should a browser test be added later, even though this plan adds none.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes, including `jsx-a11y` and `react-compiler`: `npm run lint`
- Production build succeeds: `npm run build`
- Full unit suite passes: `npm run test:run`

#### Manual Verification:

- Tab reaches each handle in edit mode; Space grabs, arrow keys move the row, Space drops, Esc cancels back to the original position
- A keyboard-driven reorder persists across a reload
- VoiceOver (or the platform screen reader) announces the asset name and its new position on each move
- Each handle announces a name that identifies its row, not a UUID
- A final pass on the installed PWA (S-08) confirms drag, scroll, and keyboard all behave as on desktop

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `src/lib/asset-order.test.ts` — `moveId` across every index permutation (down, up, to-first, to-last), unknown ids, self-move, single-element list, and non-mutation of the input; `topSortOrder` for empty, all-zeros, already-negative, and single-element inputs.
- `src/lib/backup.test.ts` — existing suite; confirms `sort_order` now round-trips through `serialize`, and that an envelope lacking `sort_order` still validates (it is not a required field).
- `src/lib/backup-rpc-parity.test.ts` — existing guard, no changes needed; it goes red if Phase 1 adds the column to `ASSETS_COLUMNS` without the matching `restore_backup` migration.

### Integration Tests:

- `src/pages/api/assets/order.test.ts` — 401 unauthenticated; 400 for missing/non-array/empty/non-string-element `ids` with no rpc call made; 200 with `rpc("reorder_assets", { p_ids })` recorded; 500 `REORDER_FAILED` on rpc error.
- `src/pages/api/api-auth-contract.test.ts` — existing walker; automatically covers the new route.

### Manual Testing Steps:

1. With several assets, click **Edit list**, drag the bottom asset to the top, reload — the order holds.
2. Repeat at a narrow viewport on the mobile card list.
3. Switch to the Liabilities tab — the Edit list toggle is disabled with a hint.
4. Add a new asset — it appears at the top.
5. Export a backup, wipe the account, import it in replace mode — the custom order is restored.
6. Import a backup exported *before* this change — it restores cleanly, with the list in `created_at DESC` order.
7. Go offline, drag a row — the list snaps back and shows an inline error.
8. On a real iOS device / the installed PWA: swipe the card body (page scrolls), swipe from the handle (row drags).
9. Keyboard-only: tab to a handle, Space, arrows, Space; then Esc mid-drag to confirm cancel.

## Performance Considerations

Manual-entry portfolios are tens of rows, so a whole-list renumber is cheap regardless. The `IS DISTINCT FROM` filter in the RPC is there for `updated_at` hygiene, not speed. `idx_assets_user_sort` covers the new read order so neither ordered read regresses to a sort. The `SELECT min(sort_order)` added to the asset POST is one extra indexed round trip on a low-frequency write path.

## Migration Notes

Three migrations, applied in filename order: column + backfill, then the RPC + grants, then `restore_backup`. The backfill makes the deploy invisible — existing users see the exact same order they saw before.

Rollback is `DROP COLUMN sort_order` plus `DROP FUNCTION reorder_assets(uuid[])`, and re-applying `20260724150000_restore_backup_goals.sql` to restore the previous `restore_backup` body. Because both read paths tolerate a missing custom order only through the `created_at` tiebreak, a rollback must revert the application code too — dropping the column while `.order("sort_order")` is still deployed breaks both reads.

Backup files exported *before* this change import cleanly: `sort_order` is absent, `COALESCE(r.sort_order, 0)` sets every asset to `0`, and the `created_at DESC` tiebreak reproduces today's order. `CURRENT_SCHEMA_VERSION` stays at `2`, so files exported *after* this change also remain importable by an older deploy, which simply ignores the extra key.

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-25 (lines 497-515)
- Lessons applied: `context/foundation/lessons.md` §"DB multi-table writes must be atomic", §"SECURITY DEFINER functions need an explicit `SET search_path`", §"RLS USING-only is not enough for write-scope isolation"
- Column-add precedent: `supabase/migrations/20260619120000_assets_show_on_chart.sql`
- Backup-threading precedent: `supabase/migrations/20260712130000_restore_backup_metal_symbol.sql`, `supabase/migrations/20260724150000_restore_backup_goals.sql`
- RPC + grants precedent: `supabase/migrations/20260620120000_restore_backup_rpc.sql`, `supabase/migrations/20260621000000_restore_backup_grants.sql`
- Endpoint-test harness precedent: `src/pages/api/backup/import.test.ts`
- Parity guard: `src/lib/backup-rpc-parity.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data Layer — column, backfill, reorder RPC, backup round-trip

#### Automated

- [ ] 1.1 Migrations apply cleanly from scratch (`supabase db reset`)
- [x] 1.2 Backup round-trip parity holds (`npx vitest run src/lib/backup-rpc-parity.test.ts`) — f5b6ec2
- [x] 1.3 Backup serialization tests pass (`npx vitest run src/lib/backup.test.ts`) — f5b6ec2
- [x] 1.4 Type checking passes (`npm run typecheck`) — f5b6ec2
- [x] 1.5 Linting passes (`npm run lint`) — f5b6ec2
- [x] 1.6 Full unit suite passes (`npm run test:run`) — f5b6ec2

#### Manual

- [x] 1.7 Assets page order unchanged after migration on a seeded database — f5b6ec2
- [x] 1.8 `sort_order` is contiguous `0..N-1` per user and `updated_at` untouched by the backfill — f5b6ec2
- [x] 1.9 `reorder_assets` raises on a partial or foreign-id array — f5b6ec2

### Phase 2: Order-aware reads, top-slot inserts, and the reorder endpoint

#### Automated

- [x] 2.1 New unit tests pass (`npx vitest run src/lib/asset-order.test.ts`) — cc9de92
- [x] 2.2 New endpoint tests pass (`npx vitest run src/pages/api/assets/order.test.ts`) — cc9de92
- [x] 2.3 API auth contract holds for the new route (`npx vitest run src/pages/api/api-auth-contract.test.ts`) — cc9de92
- [x] 2.4 Existing asset endpoint tests pass (`npx vitest run src/pages/api/assets`) — cc9de92
- [x] 2.5 Type checking passes (`npm run typecheck`) — cc9de92
- [x] 2.6 Linting passes (`npm run lint`) — cc9de92
- [x] 2.7 Full unit suite passes (`npm run test:run`) — cc9de92

#### Manual

- [x] 2.8 `PATCH /api/assets/order` reorders and the assets page reflects it after reload (verified: curl PATCH with [Charlie, Alpha, Bravo] against localhost:4321 → 200 `{count:3}`; DB and a fresh GET of `/dashboard/assets` both render Charlie, Alpha, Bravo) — cc9de92
- [x] 2.9 A newly added asset appears at the top of the list (verified: POST /api/assets "Delta" → 201 with `sort_order: -1` against a minimum of 0; page reload lists Delta, Charlie, Bravo, Alpha) — cc9de92
- [x] 2.10 A reorder leaves `updated_at` untouched on unmoved assets (verified: reorder [Charlie, Bravo, Alpha] left Charlie at index 0 with `updated_at` 14:55:50.897193 unchanged while the two moved rows bumped to 14:56:19.617866) — cc9de92

### Phase 3: Edit mode and drag-and-drop

#### Automated

- [x] 3.1 Type checking passes (`npm run typecheck`)
- [x] 3.2 Linting passes including `react-compiler` (`npm run lint`)
- [x] 3.3 Production build succeeds (`npm run build`)
- [x] 3.4 Full unit suite passes with no regressions (`npm run test:run`)

#### Manual

- [x] 3.5 Desktop table drag reorders and persists across reload (verified: driven at 1280×1400 against localhost:4321 — dragged the last row to the top, list became [Main Checking, Emergency Fund, Mortgage, Car, Apartment, Bitcoin, Brokerage — VOO] and reloaded identically)
- [x] 3.6 Mobile card drag reorders and persists across reload (verified: driven at 390×844 with touch emulation — dragged card 2 to the top, order held across reload)
- [x] 3.7 Edit list toggle disabled on Assets/Liabilities tabs with a hint (verified: on the Liabilities tab the toggle reports `disabled=true`, the hint "Switch to the All tab to reorder your list." is visible, and edit mode exited — 0 handles remain)
- [x] 3.8 Done restores the normal list state with Edit/Delete intact (verified: 7 handles in edit mode → 0 after Done, with 7 Edit links and 7 Delete buttons still addressable by role)
- [x] 3.9 A failed PATCH snaps the order back and shows the inline error (verified: PATCH /api/assets/order stubbed to 500 — post-drag order identical to pre-drag and the inline banner shows "Failed to reorder assets")
- [x] 3.10 On a real iOS device / installed PWA, card-body swipe scrolls and handle swipe drags (confirmed by the user on device; the underlying property was also checked automatically — card body computes `touch-action: auto`, only the handle computes `none`)

### Phase 4: Keyboard, screen-reader, and cross-device verification

#### Automated

- [ ] 4.1 Type checking passes (`npm run typecheck`)
- [ ] 4.2 Linting passes including `jsx-a11y` and `react-compiler` (`npm run lint`)
- [ ] 4.3 Production build succeeds (`npm run build`)
- [ ] 4.4 Full unit suite passes (`npm run test:run`)

#### Manual

- [ ] 4.5 Tab/Space/arrows/Esc drive a reorder end to end
- [ ] 4.6 A keyboard-driven reorder persists across a reload
- [ ] 4.7 Screen reader announces asset name and new position on each move
- [ ] 4.8 Each handle has an accessible name identifying its row
- [ ] 4.9 Final pass on the installed PWA confirms drag, scroll, and keyboard
