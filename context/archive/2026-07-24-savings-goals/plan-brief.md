# Custom Savings Goals (S-21) — Plan Brief

> Full plan: `context/changes/savings-goals/plan.md`
> Research: `context/changes/savings-goals/research.md`

## What & Why

Users can track net worth but have nothing to aim at. This adds named savings goals — against **total net worth** ("reach €1M") or a **single category** ("Savings Account → €50k emergency fund") — each with a target amount, currency, and optional date. A settings-gated dashboard card shows progress bars plus an estimated completion date derived from the user's real trend, reusing S-20's `etaToTarget`.

## Starting Point

`etaToTarget` is shipped, pure, and tested, and `NetWorthChart.tsx:128-182` is a copy-ready recipe for turning snapshot rows into an ETA. `convertAmount` handles the mixed-currency target with no new math. The settings-gated card and new-table migration patterns each have working precedents. What does *not* exist: any per-category subtotal (every helper is per-asset or per-card), and any per-category historical series — the latter is the core of a different roadmap slice, S-23.

## Desired End State

A "Goals" nav item leads to `/dashboard/goals`, where the user creates, edits, and deletes goals with an inline form. On the dashboard, a "Savings goals" card (on by default, toggleable in Settings) shows their top 3 goals by progress, each with a bar, an estimated completion date for net-worth goals, and an on-track/behind badge when a target date is set. With no goals it shows a placeholder linking to the goals page. A backup export/import round-trip preserves both the goals and the toggle.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Category-goal ETA | Progress bar only, no ETA in v1 | The per-category historical series is S-23's core work; pulling it forward roughly doubles the slice, and it's additive later. | Plan |
| `target_date` behaviour | On-track/behind badge vs the trend ETA | Cheapest thing that makes the column earn its place — a pure comparison of two dates already computed. | Plan |
| FK + integrity | Strict `kind`/`category_id` CHECK, no `ON DELETE` clause | `ON DELETE SET NULL` would violate the CHECK and behave as RESTRICT anyway; no-clause matches the `assets.category_id` precedent. | Plan |
| Goals in backup | Included, with schema version bumped to 2 | Otherwise a restore silently wipes goals — the same data-loss class the RPC gap caused three times. | Plan |
| Dashboard card density | Top 3 by progress + "+N more" | Matches the `DriftAlerts` truncation precedent and bounds card height. | Plan |
| Validation bounds | `> 0`, name ≤ 60, below-current allowed | Kills the `Infinity`/`NaN` class at three layers while keeping the legitimate already-achieved case. | Plan |
| CRUD shape | `allocation-cards` pattern, inline form | The newer of two generations; no dialog primitive exists in the repo, so an inline form is the least invention. | Research |
| No-ETA states | Four distinct states, discriminated union | `etaToTarget` returns `null` for four different reasons; collapsing them tells a user who just switched currency their trend will never reach the goal. | Plan |
| Test depth | Lib unit + API handler tests, no E2E | Closes the gap `allocation-cards` left; the S-20 hydration traps make new form specs expensive for little added signal. | Plan |

## Scope

**In scope:** `goals` table with RLS; `src/lib/goals.ts` (first per-category subtotal in the repo) with oracle tests; `/api/goals` CRUD with handler tests; `/dashboard/goals` page and both nav files; `show_goals` preference through all 9 touchpoints; `GoalsProgress` dashboard card; backup export/import round-trip.

**Out of scope:** ETAs for category goals; any `snapshot_items` per-category aggregation; required-rate math; goal reordering; a dialog primitive; active-route nav highlighting; shared `Card`/`ProgressBar` extraction; E2E specs; a `test-plan.md` refresh.

## Architecture / Approach

Server computes, islands present — the established dashboard pattern. `dashboard.astro` frontmatter fetches goals, converts each target through `convertAmount`, fits the trajectory **once** across all goals, and passes flat props to a stateless `GoalsProgress` island. The `/dashboard/goals` management surface is the opposite: a JSON API with local `useState` refresh, no page reloads. All money and ETA logic lives in a pure `src/lib/goals.ts` whose ETA return is a five-variant discriminated union, so no caller can fabricate a date.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & types | `goals` table + RLS + CHECKs, `show_goals` column, hand-edited types | Hand-edited `database.types.ts` drifting and failing CI |
| 2. Pure goals math | `goals.ts` + oracle tests, incl. the first per-category subtotal | Divide-by-zero / FP scaling on the progress ratio |
| 3. CRUD API | `/api/goals/*` + the handler tests `allocation-cards` never got | Cross-tenant leak; DB CHECK surfacing as a 500 instead of a 400 |
| 4. Page & nav | `/dashboard/goals` inline-form island, both nav files | Touching only one nav file — the exact asset-balancer bug |
| 5. Settings & card | `show_goals` chain + `GoalsProgress` on the dashboard | Conflating the four no-ETA states into misleading copy |
| 6. Backup round-trip | RPC migration + `backup.ts` + parity-test entry | Old backup files becoming un-importable; the thrice-shipped `ON CONFLICT` omission |

**Prerequisites:** F-01, S-01, S-02, S-05, S-20 — all shipped. Local Supabase running (`npx supabase start`) for migrations. Note `supabase/config.toml` is dirty with a `project_id` rename, so the next `supabase start` after it lands spins up a fresh empty stack.

**Estimated effort:** ~4-6 sessions across 6 phases. Phases 2 and 6 carry most of the weight; 1 and 4 are close to mechanical.

## Open Risks & Assumptions

- **Backup is bigger than it looks.** `backup.ts` hard-codes exactly four tables across six places, and `validateEnvelope` *rejects* an envelope missing any table array — so adding `goals` naively makes every previously-exported file un-importable. The plan bumps `CURRENT_SCHEMA_VERSION` to 2 and treats an absent `goals` array as `[]`, with a test pinning that.
- **Ordering constraint:** `backup-rpc-parity.test.ts` asserts strict equality (not a subset) between the RPC's column lists and `backup.ts`'s whitelists. The migration and the module edit must land in the same commit, which is why backup is Phase 6 rather than part of Phase 1.
- **Assumption:** the category-ETA deferral is genuinely additive. If S-23's aggregation lands in a shape `goals.ts` can't consume, unlocking category ETAs costs more than the one-argument change assumed here.
- **Inherited from S-20:** users who recently switched display currency may have fewer than 2 comparable snapshots and see no ETA at all. S-20 accepted this; here it gets its own honest empty state rather than being silently folded into "you won't reach this".
- **`asset_categories` is seeded by `seed.sql`, which does not run on `supabase migration up`** — a production DB populated only by migrations could have an empty category table. Pre-existing condition, not introduced here.

## Success Criteria (Summary)

- A user can create a net-worth goal and see a plausible projected completion date from their own snapshot history — and never a fabricated one when the trend can't support it.
- The dashboard card is indistinguishable in look and behaviour from the FIRE card beside it, and respects its Settings toggle.
- Exporting and re-importing a backup preserves every goal and the toggle state, in both `replace` and `merge` modes — and old backup files still import.
