# Asset List Reordering (Drag-and-Drop) — Plan Brief

> Full plan: `context/changes/asset-list-reorder/plan.md`
> Source slice: `context/foundation/roadmap.md` §S-25

## What & Why

The assets list is locked to reverse-chronological order — the order assets happened to be entered in, which is rarely the order the user thinks about their portfolio in. This adds a persisted, user-controlled row order: an explicit "Edit list" mode reveals a drag handle on every row, and the chosen arrangement survives reloads, devices, and backup round-trips.

## Starting Point

`AssetList.tsx` renders the same array twice — a desktop `<table>` of `AssetRow` and a mobile `<ul>` of `AssetCard` — and holds no local copy of the data, deriving everything from props. Exactly two read paths impose an order (`dashboard/assets/index.astro:25` and `api/assets/index.ts:38`), both ending in `created_at DESC`. The `assets` table has no ordering column, RLS already pairs `USING` with `WITH CHECK`, and an `assets_updated_at` trigger stamps `updated_at` on every row update.

## Desired End State

An **Edit list** button on the assets page reveals grip handles on every row, on both desktop and mobile. Dragging a handle reorders the list immediately and writes through in the background. The order holds across reloads, devices, and a backup export/import cycle. Handles are keyboard-operable and announce moves to screen readers. Leaving edit mode returns the list to normal, with Edit and Delete untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Persistence model | `sort_order INTEGER NOT NULL DEFAULT 0`, backfilled from `created_at DESC` | Portfolios are tens of rows, so a renumber is cheap and avoids fractional indexing's precision drift. | Roadmap |
| Atomicity | One `reorder_assets(uuid[])` RPC, `SECURITY DEFINER`, single `UPDATE` | A loop of per-row updates can leave an order that is neither the old one nor the new one. | Roadmap |
| Ordering totality | `.order("sort_order").order("created_at", desc)` everywhere | Two rows can share a `sort_order`; the tiebreak keeps the order deterministic and makes old backups degrade gracefully. | Plan |
| `updated_at` on reorder | Renumber only rows whose value actually changes | A blanket renumber fires the row trigger on every asset, destroying `updated_at`'s meaning and churning every backup export. | Plan |
| Drag library | `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` | Stable 1.0+, peer `react >=16.8.0` verified against React 19.2, with the documented handle + table-row patterns; the rewrite is still pre-1.0. | Plan |
| Filter interaction | Edit mode enabled only on the All tab | Dragging inside a filtered subset gives results that surprise you back on All; disabling is honest and cheap to explain. | Roadmap |
| Save timing | Optimistic on each drop, revert + inline error on failure | A closed tab never loses work, and edit mode governs only handle visibility rather than doubling as a commit point. | Roadmap |
| New asset placement | Top slot (`min(sort_order) - 1`) | Preserves today's newest-first feel so the migration is invisible to users who never reorder. | Roadmap |
| Touch mechanics | Handle-only drag with `touch-action: none` | Keeps the card body scrollable, targeting the iOS Safari pointer-event class of bug already recorded for the Radix dropdown. | Roadmap |
| Accessibility | dnd-kit `KeyboardSensor` + aria-live announcements | One mechanism serves pointer, touch, and keyboard; asset-named handles keep the surface `getByRole`-addressable. | Roadmap |
| Backup schema version | Stays at `2` | Adding a column to an existing table is the `metal_symbol` case, not the `goals` case; a bump would break older deploys for no benefit. | Plan |
| Testing depth | Unit + API integration, no new E2E | Covers the three places this codebase has actually been bitten; a pointer-drag E2E would be flaky and still wouldn't reproduce real iOS touch. | Plan |

## Scope

**In scope:** `assets.sort_order` column + backfill; `reorder_assets` RPC + grants; `restore_backup` threading and the `backup.ts` whitelist; both ordered read paths; top-slot placement on asset create; `PATCH /api/assets/order`; a pure `asset-order.ts` helper; edit mode and drag handles on both list renderings; keyboard and screen-reader support.

**Out of scope:** ordering the four aggregate reads (dashboard, forecast, fire, balancer — sum math, order is meaningless); any other list surface; a new toast system (reuses the existing inline error banner); cross-category drag; new E2E specs; bumping `CURRENT_SCHEMA_VERSION`; converting the asset routes from `formData` to JSON.

## Architecture / Approach

Bottom-up through the stack. A new `sort_order` column is seeded from the current visible order so the deploy is invisible. All ordering writes funnel through a single `SECURITY DEFINER` RPC that renumbers from an ordered id array in one statement — scoped to `auth.uid()`, and validating that the array is a complete, duplicate-free cover of the caller's assets so a stale client fails loudly instead of scrambling the list. A thin `PATCH /api/assets/order` endpoint fronts it. On the client, `AssetList` gains a locally-ordered copy of the list plus a dnd-kit `SortableContext` wrapping both renderings; the index math itself lives in a pure, unit-tested `asset-order.ts` rather than only in the drop handler.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | Column + backfill, `reorder_assets` RPC + grants, `restore_backup` threading, `backup.ts` whitelist | The backfill firing `assets_updated_at` on every asset at deploy — mitigated by suppressing the trigger inside the migration only |
| 2. Reads + write path | Both reads order-aware, top-slot inserts, `PATCH /api/assets/order`, pure helper + tests | A partial id array leaving duplicate `sort_order` values — mitigated by the RPC's cover check |
| 3. Edit mode + drag | dnd-kit dependency, edit toggle, handles on table and cards, optimistic save | Touch drag hijacking page scroll on iOS Safari — mitigated by handle-only drag with `touch-action: none` |
| 4. Keyboard + a11y | `KeyboardSensor`, announcements, named handles, cross-device verification | Nothing automated can catch a real-device regression; this phase is where the manual checks live |

**Prerequisites:** F-01, S-01, S-07 (all shipped); local Supabase running via Docker for `supabase db reset`.
**Estimated effort:** ~2-3 sessions across four phases. Phase 1 is the heaviest (three migrations); Phase 4 is mostly manual verification.

## Open Risks & Assumptions

- The backfill's trigger suppression takes an `ACCESS EXCLUSIVE` lock. Fine at this data volume, inside a transaction that already holds a lock from `ALTER TABLE ADD COLUMN`, but it is a migration-only technique — the runtime RPC must never do it.
- Optimistic save with rapid consecutive drops needs a real guard (ignore drags while in flight, or key the revert to the last known-good array); a naive inverse-move revert desynchronizes.
- `@dnd-kit`'s legacy packages are mature but the maintainer is steering toward the pre-1.0 rewrite. This is a deliberate stability-now trade with a likely migration later.
- Applying `transform` to `<tr>` elements is the one dnd-kit pattern most likely to need visual fiddling; column alignment in edit mode (the extra handle cell) is the thing to watch.
- Rolling back the migration requires rolling back the application code too — dropping the column while `.order("sort_order")` is deployed breaks both reads.

## Success Criteria (Summary)

- A user can drag assets into a chosen order on both desktop and mobile, and that order is still there after a reload, on another device, and after a backup export/import cycle.
- Reordering never leaves the list in a half-written state, and never silently loses the order on restore.
- The feature is fully operable by keyboard, with screen-reader announcements naming the asset and its new position.
