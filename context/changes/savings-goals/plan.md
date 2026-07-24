# Custom Savings Goals (S-21) Implementation Plan

## Overview

Add named savings goals: a `goals` table, a `/dashboard/goals` CRUD surface, and a settings-gated `GoalsProgress` dashboard card showing each goal's progress bar plus a trend-derived estimated completion date reusing S-20's `etaToTarget`.

Goals come in two kinds — against **total net worth** ("reach €1M") or against a **single asset category** ("Savings Account → €50k emergency fund"). Both get a progress bar; only net-worth goals get an ETA in v1 (see What We're NOT Doing).

## Current State Analysis

- **`etaToTarget` is shipped, pure, and tested** — `src/lib/trajectory.ts:168-181`. It returns a number of **days on the sample `t` axis**, not a `Date`. It returns `null` in five branches, and critically **cannot distinguish "already reached" from "will never reach"** (`:179` covers both).
- **The caller-side recipe already exists** — `src/components/NetWorthChart.tsx:128-182` transforms snapshot rows → `{t, value}` samples → fit → ETA → ISO date. It filters to `s.display_currency === displayCurrency` first (`:131`), so the fit never spans a currency change.
- **`convertAmount` handles the mixed-currency target directly** — `src/lib/net-worth.ts:18-27`. `rates` are units-per-USD; conversion pivots through USD. `getRates` is async and already awaited once in `dashboard.astro:33`.
- **There is no per-category subtotal anywhere in the codebase.** `totalAssetPool` (`src/lib/allocation.ts:288-300`) is the closest but its `ShareAsset` type carries no `category_id`. `AssetsSummary` groups by currency, not category. A `kind: 'category'` goal needs net-new math.
- **There is no per-category historical series either.** A category ETA would require aggregating `snapshot_items` by category per snapshot — the core of the separate S-23 slice (`roadmap.md:74`).
- **The settings-gated card chain is 9 touchpoints**, not the 5 the roadmap lists. `backup.ts` and the `restore_backup` RPC are the two that get forgotten; forgetting the RPC has shipped a silent data-loss bug **three times** (commit `a1604bc`).
- **`FireProgress` is the card template** — `src/components/fire/FireProgress.tsx`, 105 lines, zero `useState`/`useEffect`/`fetch`. All math server-side in `dashboard.astro`; the island is a function of props.
- **`allocation-cards` is the newer CRUD generation** — `src/pages/api/allocation-cards/index.ts:5-19` (`jsonError`/`jsonOk`), `[id].ts:33-36` (`UUID_RE`), JSON bodies, PATCH not PUT, `.maybeSingle()`, 404-not-403 on foreign rows.
- **`asset_categories` is TEXT-keyed and global** — `supabase/migrations/20260529190856_initial_schema.sql:17-25`. So `goals.category_id` must be `TEXT`, not UUID. `assets.category_id` FKs it with **no `ON DELETE` clause**.
- **No Postgres enums exist** (`database.types.ts:416` — `Enums` is `Record<never, never>`). The idiom is `TEXT` + inline `CHECK`, which does **not** surface as a TS union.
- **`database.types.ts` is nominally generated, in practice hand-edited.** No type-gen script in `package.json`; CI runs `astro sync → typecheck`, so a stale file fails the build.
- **UI primitives are nearly absent.** `src/components/ui/` holds only `button.tsx` and `LibBadge.astro`. `@radix-ui/react-dialog` is not installed. There is **no date input anywhere in the repo** — `target_date` introduces the first.
- **Nav lives in two files** — `src/components/Topbar.astro:16-51` (desktop) and `src/components/TopbarMenu.tsx:46-81` (mobile). `lessons.md:91-99` records the asset-balancer change that shipped a desktop-unreachable link by touching only one.
- **`backup.ts` hard-codes exactly four tables** across `BackupData`, `BackupInput`, `REQUIRED_FIELDS` (`:121-134`), `TIMESTAMP_FIELDS` (`:137-142`), `validateEnvelope`'s table loop (`:228`), and `prepareForImport` (`:301-325`). `validateEnvelope` **rejects an envelope missing any table array** (`:230-232`).
- **`backup-rpc-parity.test.ts:75-79` asserts the RPC's INSERT column list is `toEqual` the export whitelist** — not a superset. A column in one but not the other fails, in either direction.

### Key Discoveries:

- `src/lib/trajectory.ts:179` — `t <= fromT` returns `null` for both "already reached" and "crossing in the past". The card must disambiguate on progress %, never on the ETA alone.
- `src/components/fire/FireProgress.tsx:50-53` — the defensive clamp that fixed impl-review F1 (`fireNumber = 0` → `Infinity`/`NaN` leaking into `aria-valuenow`). A goal with `target_amount = 0` reproduces it exactly.
- `src/lib/asset-trends.ts:36-39` and `src/lib/movers.ts:66-68` — both deliberately re-convert `original_amount` at today's rates rather than reading stored `converted_amount`, "so a display-currency switch never fabricates movement."
- `src/lib/allocation.ts:22` — `EPSILON = 1e-2` is the canonical near-zero threshold; reuse it, don't invent one.
- `src/pages/api/api-auth-contract.test.ts:29-70` auto-generates a test for every file under `src/pages/api/` — a new `/api/goals/*` route is covered with no authoring, but **fails CI until `supabase.auth.getUser()` is present**.
- `e2e/trajectory-verify.spec.ts:19-34` — the `hasLocalDb()` skip guard every DB-seeding spec must carry, because CI e2e runs against **remote** Supabase.
- `supabase/seed.sql` runs on `db reset`/`start`, **not** on `supabase migration up` (`context/archive/2026-06-20-data-backup-import-export/research.md:71`).

## Desired End State

A user can visit `/dashboard/goals` from either nav, create a named goal against total net worth or one category with a target amount, target currency, and optional target date, then edit or delete it. On the dashboard, a "Savings goals" card (on by default, toggleable in Settings) shows their top 3 goals by progress with a bar each, an estimated completion date for net-worth goals, and an on-track/behind badge when a target date is set. With no goals it shows a placeholder linking to `/dashboard/goals`. Exporting and re-importing a backup preserves both the goals and the toggle.

**Verification**: `npm run lint`, `npx tsc --noEmit`, `npm run test:ci` all pass; the manual steps in Testing Strategy are re-run against the running app.

## What We're NOT Doing

- **No ETA for category goals in v1.** The card shows the bar and current/target; the ETA row renders an explicit `unsupported` state. Per-category historical aggregation is S-23's core work — pulling it forward would roughly double this slice. This is additive later: `computeGoal` gains a series argument, nothing else changes.
- **No per-category `snapshot_items` aggregation** of any kind. Not in `goals.ts`, not in `dashboard.astro`.
- **No required-rate math** ("you'd need €X/month"). `target_date` drives an on-track/behind comparison only.
- **No goal reordering UI** and no `display_order` column. Dashboard order is derived (progress %), page order is `created_at`.
- **No dialog primitive.** Create/edit is an inline form; delete confirmation is `window.confirm()`, as elsewhere.
- **No active-route highlighting** in the nav — none exists (`grep aria-current` returns nothing); do not invent one.
- **No shared `Card`/`ProgressBar` extraction.** The drift restyle explicitly declined this (`context/archive/2026-07-12-dashbord-drift-restyle/plan.md:43`); copy the idiom.
- **No E2E spec.** Unit + API handler tests only (see Testing Strategy for why).
- **No `--refresh` of `test-plan.md`.** Goals introduces no new risk class; it lands inside existing risks #1, #2, #5.

## Implementation Approach

Bottom-up, matching every prior slice: schema → pure math → API → page → dashboard card → backup. Each phase is independently verifiable and leaves the repo green.

The one deviation from the obvious ordering is **backup last**. `backup-rpc-parity.test.ts` asserts strict equality between the RPC's column lists and `backup.ts`'s whitelists, so a `restore_backup` migration landing before the `backup.ts` edit turns the suite red and keeps it red across every intervening phase. Both halves land in Phase 6, together.

## Critical Implementation Details

**RPC and whitelist must land together.** `backup-rpc-parity.test.ts:75-79` uses `toEqual`, not a subset check. Adding `show_goals` to the `restore_backup` INSERT list without adding it to `USER_PREFERENCES_COLUMNS` fails the suite, and so does the reverse. Phase 6 does both in one commit; no earlier phase touches either.

**Backup schema version must bump, and `goals` must be optional on read.** `validateEnvelope` (`src/lib/backup.ts:228-233`) fails an envelope missing any table array. Adding `goals` to that list unchanged would make every previously-exported file un-importable. Bump `CURRENT_SCHEMA_VERSION` to `2` and treat an absent `goals` array as `[]` rather than an error — the version policy already accepts lower-versioned files (`:215`), so this is the only change that makes that acceptance real.

**The ETA fit runs only over same-display-currency snapshots.** `NetWorthChart.tsx:131` filters before sampling; S-20's plan calls this out explicitly. A user who recently switched display currency can have <2 comparable snapshots and therefore no ETA — that is the `insufficient_history` state, not `not_reaching`. Conflating them tells the user their trend will never reach the goal, which is simply false.

**Two snapshots on the same calendar day yield a zero-variance `t` axis** and `fitLinear` returns `null` (`trajectory.ts:73`). That also surfaces as `insufficient_history`.

**Percentages are 0-100 end to end**, no ×100/÷100 at the DB boundary. `EPSILON = 1e-2` from `allocation.ts:22` is canonical.

---

## Phase 1: Schema & Types

### Overview

Create the `goals` table with RLS and integrity constraints, add the `show_goals` preference column, and hand-edit `database.types.ts`. Deliberately does **not** touch `restore_backup` — see Critical Implementation Details.

### Changes Required:

#### 1. Goals table

**File**: `supabase/migrations/20260724130000_goals.sql`

**Intent**: Create the user-owned `goals` table so named savings goals persist with per-user isolation.

**Contract**: Follows the `20260624120000_allocation_targets.sql:22-42` template exactly — `BEGIN;` → table → index on `user_id` → `ENABLE ROW LEVEL SECURITY` → policy → `updated_at` trigger → `COMMIT;` + a commented rollback block. Columns: `id UUID PK DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `kind TEXT NOT NULL`, `category_id TEXT REFERENCES asset_categories(id)` (**no `ON DELETE` clause**, matching `assets.category_id`), `target_amount NUMERIC(18,2) NOT NULL`, `target_currency TEXT NOT NULL`, `target_date DATE`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

Three CHECK constraints, all inline `TEXT`-style per the repo idiom (`initial_schema.sql:34,48`):

```sql
CHECK (kind IN ('net_worth', 'category')),
CHECK (target_currency IN ('PLN', 'USD', 'EUR')),
CHECK (target_amount > 0),
CHECK (
  (kind = 'category' AND category_id IS NOT NULL) OR
  (kind = 'net_worth' AND category_id IS NULL)
)
```

The last one is why the FK carries no `ON DELETE` clause: `SET NULL` would violate it, so the FK would behave as RESTRICT anyway. `asset_categories` is seeded and immutable, so this never fires in practice.

RLS policy is the canonical pair (`20260602235644_rls_with_check.sql:17-21`) — **both clauses mandatory** per `lessons.md:45-55`:

```sql
CREATE POLICY "Users own their goals" ON goals
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

#### 2. Preference column

**File**: `supabase/migrations/20260724140000_user_preferences_show_goals.sql`

**Intent**: Add the dashboard-card toggle, defaulting on so existing users see the card.

**Contract**: `ALTER TABLE user_preferences ADD COLUMN show_goals BOOLEAN NOT NULL DEFAULT TRUE;` inside `BEGIN;`/`COMMIT;`. No backfill — the default covers existing rows. Template: `20260719120000_user_preferences_show_trajectory.sql:12`.

#### 3. Generated types

**File**: `src/lib/database.types.ts`

**Intent**: Keep the hand-maintained types in sync so `astro sync → typecheck` stays green in CI.

**Contract**: Add a `goals` table block — Row/Insert/Update — sorted alphabetically between `exchange_rate_cache` and `metal_price_cache`. `kind`, `category_id`, `target_currency` type as plain `string` (CHECK constraints do not surface as unions). `Relationships` gets exactly one entry, `goals_category_id_fkey → asset_categories.id`; the `auth.users` FK is omitted per the existing convention. Separately add `show_goals: boolean` to `user_preferences` Row (`:354`), Insert (`:373`), and Update (`:392`), alphabetically between `show_fire_dashboard` and `show_trajectory`.

Regenerate rather than hand-write if the local stack is running: `npx supabase gen types typescript --local > src/lib/database.types.ts`. Note `CLAUDE.md:20`'s claim that `npx astro sync` generates this file is inaccurate.

#### 4. Backup test fixture — approved Phase 1 deviation

**File**: `src/lib/backup.test.ts`

**Intent**: Keep `tsc --noEmit` green. `BackupInput.user_preferences` is a *whole* `Tables<"user_preferences">` Row, not a whitelist projection, so the moment `show_goals` (NOT NULL) lands in `database.types.ts` the `makeInput()` fixture literal is structurally incomplete and TS2741 fails the build. The plan originally scheduled this line for Phase 6 §5; that ordering is unachievable, so it moves here.

**Contract**: Add `show_goals: true` to the prefs fixture object (beside `show_trajectory: true`, `:39`) — one line, nothing else in the file. This does **not** pre-empt Phase 6: `backup-rpc-parity.test.ts` compares `USER_PREFERENCES_COLUMNS` against the RPC's INSERT list and neither changes here, and the `:125` assertion walks the whitelist, which `show_goals` does not join until Phase 6 — so `serialize` simply drops the extra fixture key. Precedent: commit `bed4831` landed `database.types.ts` and this same one-line fixture edit together for `show_trajectory`.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npx supabase db reset`
- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Existing test suite still green: `npm run test:ci`

#### Manual Verification:

- In Supabase Studio, inserting a `goals` row with `kind = 'net_worth'` and a non-null `category_id` is rejected by the CHECK
- A second user cannot select the first user's `goals` rows (RLS check via two sessions)
- `UPDATE goals SET name = ...` bumps `updated_at` (trigger fires)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Pure Goals Math

### Overview

Build `src/lib/goals.ts` — the first per-category subtotal in the codebase — plus a discriminated ETA result that never fabricates a date, and its oracle test suite.

### Changes Required:

#### 1. The goals module

**File**: `src/lib/goals.ts`

**Intent**: Compute, for one goal, its current value in the display currency, its progress percentage, and a discriminated estimated-completion state — all pure, so the dashboard card can stay a function of props.

**Contract**: Module header states the purity/totality policy and the round-only-at-the-view-edge rule, matching `trajectory.ts:1-18`. Input interfaces declare `currency: string` / `kind: string` and cast **inside** the function body, per `lessons.md:25-33`'s preferred lib-layer form for new modules (as `movers.ts:60` and `allocation.ts:296` do) — callers do not carry `as Currency`.

The ETA result is a discriminated union, not `number | null` — this is the whole point of the four-state decision:

```ts
export type GoalEta =
  | { status: "projected"; date: string }        // ISO-8601
  | { status: "reached" }                        // progress >= 100
  | { status: "not_reaching" }                   // flat or declining trend
  | { status: "insufficient_history" }           // <2 comparable samples / zero-variance t
  | { status: "unsupported" };                   // category goal, v1
```

Exports:

- `categorySubtotal(assets, categoryId, displayCurrency, rates): number` — sums `convertAmount(amount, currency, displayCurrency, rates)` over assets whose `category_id` matches. Structural template is the `Map` loop at `asset-trends.ts:55-64`. **Does not** filter liabilities or `converted > 0` the way `totalAssetPool` does — a liability category is a legitimate (if unusual) goal denominator, and filtering would silently under-report.
- `goalCurrentValue(goal, assets, netWorth, displayCurrency, rates): number` — dispatches on `kind`: `net_worth` returns the already-computed `netWorth`, `category` delegates to `categorySubtotal`.
- `goalProgressPct(current, targetInDisplayCurrency): number` — returns the **uncapped** 0-100-scale ratio. Guards `Math.abs(target) < EPSILON` (reuse `EPSILON` from `allocation.ts:22`) by returning `0`, which is what keeps `Infinity`/`NaN` out of `aria-valuenow` at the source rather than only at the view edge.
- `goalEta(goal, fit, lastT, originMs, progressPct, comparableCount): GoalEta` — the disambiguator. Order matters: `kind === 'category'` → `unsupported`; `progressPct >= 100` → `reached`; `comparableCount < 2` or `fit === null` → `insufficient_history`; `etaToTarget(...) === null` → `not_reaching`; otherwise `projected` with `new Date(originMs + etaT * MS_PER_DAY).toISOString()`.
- `onTrackVerdict(eta, targetDate): "on_track" | "behind" | null` — `null` when either input is absent or the ETA is not `projected`. Compares the two dates only; no rate math.

`MS_PER_DAY = 86_400_000` is declared locally, as `NetWorthChart.tsx:20` does.

#### 2. Unit tests

**File**: `src/lib/goals.test.ts`

**Intent**: Pin the money math and every ETA branch against independently-derived oracles.

**Contract**: Follows the 13 existing `src/lib/*.test.ts` conventions — one `describe` per export named exactly as the export; behavioural-sentence `it` titles; local override-based `inputs()` builders; the `unwrap<T>` helper (non-null assertions are eslint-forbidden); `@/lib/...` alias imports with `import type` split out; individual `it`s not `it.each`. Opens with a comment block stating the oracle policy — oracles computed from first principles, never by reading the implementation.

FP discipline: `toBe` only for provably-exact integers, `toBeCloseTo(_, 6)` for anything involving division. **Must include the 333.33-class FP probe** every money/percent module in this repo ships (`trajectory.test.ts:70,232`, `fire.test.ts:183-188`) — `goals.ts` is squarely in that class.

Branch coverage that matters: `target_amount` at `EPSILON` boundary; progress above 100; a category goal always returning `unsupported` even when a valid fit is supplied; `insufficient_history` distinct from `not_reaching`; `onTrackVerdict` returning `null` for all three absent-input paths.

### Success Criteria:

#### Automated Verification:

- New tests pass: `npx vitest run src/lib/goals.test.ts`
- Full suite passes: `npm run test:ci`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reading `goals.test.ts`, each oracle is derivable by hand from the stated inputs without consulting `goals.ts`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Goals CRUD API

### Overview

Two route files on the `allocation-cards` pattern, with the per-handler tests that surface never got, plus the `show_goals` validation branch in the preferences API.

### Changes Required:

#### 1. Collection route

**File**: `src/pages/api/goals/index.ts`

**Intent**: List and create goals for the authenticated user.

**Contract**: Local `ErrorShape` / `jsonError` / `jsonOk` declared per-file (there is no shared module) — copy `allocation-cards/index.ts:5-19`. `GET` returns `{ data: Goal[] }` filtered by `.eq("user_id", user.id)` and ordered `created_at` ascending. `POST` validates a JSON body and returns 201.

Validation, hand-rolled (Zod is not a dependency): `name` non-empty string, `NAME_MAX = 60`; `kind` in `['net_worth','category']`; `target_amount` a finite number `> 0`, rejected if it has more than 2 decimal places (the column is `NUMERIC(18,2)` — asset-balancer impl-review F4 flagged silent storage-precision drift when validation was looser than the column); `target_currency` in `['PLN','USD','EUR']`; `category_id` required non-empty when `kind === 'category'` and required absent otherwise, mirroring the DB CHECK so the user gets a 400 rather than a 500 from Postgres; `target_date`, when present, an ISO `YYYY-MM-DD` string.

A target *below* the current value is explicitly allowed — it renders as a completed goal. Codes: `UNAUTHORIZED` 401, `VALIDATION_ERROR` 400, `FETCH_FAILED`/`CREATE_FAILED` 500.

#### 2. Item route

**File**: `src/pages/api/goals/[id].ts`

**Intent**: Edit and delete one goal, with ownership enforced twice.

**Contract**: `PATCH` and `DELETE` (not PUT), `UUID_RE` id guard → 400 (`allocation-cards/[id].ts:33-36`). Every query chains `.eq("id", id).eq("user_id", user.id)` — the ownership belt alongside RLS. `.maybeSingle()`, not `.single()`, so an unmatched row surfaces as `NOT_FOUND` 404 rather than a PostgREST raise landing in the 500 branch. **No route emits 403** — a foreign row is a 404 by convention.

`PATCH` accepts partial updates but must re-validate `kind`/`category_id` coherence against the *resulting* row, not the payload alone: patching `kind` to `net_worth` without clearing `category_id` would otherwise hit the DB CHECK as a 500.

#### 3. Preference validation branch

**File**: `src/pages/api/user-preferences/index.ts`

**Intent**: Let the settings form persist `show_goals`.

**Contract**: Three edits mirroring `show_trajectory` exactly — add `show_goals` to `PREFS_SELECT` (`:16`), to the `updates` type (`:158-160`), and a fourth copy of the 6-line boolean validation branch after `:196`. Absent key means untouched; `:204-206` already rejects a wholly empty payload.

#### 4. Handler tests

**File**: `src/pages/api/goals/index.test.ts`, `src/pages/api/goals/[id].test.ts`

**Intent**: Close the gap `allocation-cards` and `allocation-targets` left — they have no per-handler tests, only the auto-generated auth-contract walk. Cross-tenant leak is risk #2 in `test-plan.md`.

**Contract**: `vi.hoisted` + `vi.mock("@/lib/supabase")` + import-after-mock, per `snapshots/index.test.ts:17-30`. Uses `createSupabaseMock`, `createCookiesStub`, `findCall` from `src/test-utils/supabase-mock.ts`; handlers invoked directly with a hand-built context cast `as never` (there is no APIContext helper). The `asClient` helper is **not** needed — that's only for `src/lib/` SUTs taking a real `SupabaseClient`.

Assertions: status codes; error `code` strings; the tenant filter via `findCall(m.recorded, "eq", ["user_id", userA])`; filter **ordering** on the `[id]` route; and a structural pin that the response payload does not leak `user_id`. Each validation rejection above gets a case, including the `kind`/`category_id` incoherence on both POST and PATCH.

### Success Criteria:

#### Automated Verification:

- New handler tests pass: `npx vitest run src/pages/api/goals`
- Auth-contract walk covers the new routes: `npx vitest run src/pages/api/api-auth-contract.test.ts`
- Full suite passes: `npm run test:ci`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- `curl` POST with `kind: "net_worth"` plus a `category_id` returns 400 with `VALIDATION_ERROR`, not a 500
- `curl` PATCH against another user's goal id returns 404, not 403 or 200
- `curl` POST with `target_amount: 0` returns 400
- Saving the settings form with the new payload key succeeds (once Phase 5 wires the checkbox — verify via direct `curl` PUT here)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Goals Page & Nav

### Overview

The management surface at `/dashboard/goals` plus both nav files.

### Changes Required:

#### 1. Goals page

**File**: `src/pages/dashboard/goals.astro`

**Intent**: Host the goals island, fetching the seeded category list server-side so the form's category picker needs no client fetch.

**Contract**: Repeats the `Astro.locals.user` frontmatter guard and redirect that every dashboard page carries, even though `/dashboard/goals` needs **no** middleware registration (`PROTECTED_ROUTES = ["/dashboard"]` matches by `startsWith` — `src/middleware.ts:4,35-39`). Fetches the user's goals and all `asset_categories` ordered by `display_order`, and passes both plus `displayCurrency` and `rates` to the island. `DashboardLayout`, `max-w-*` container, and the gradient `<h1>` match `settings.astro:43-52`.

#### 2. Goals management island

**File**: `src/components/goals/GoalsManager.tsx`

**Intent**: List, create, edit, and delete goals without a page reload.

**Contract**: The newer CRUD generation — JSON `fetch` against `/api/goals`, local `useState` list updated from each response rather than `window.location.reload()`. Create/edit is an **inline form** above the list (no dialog — `@radix-ui/react-dialog` is not installed and the native `<dialog>` pattern would be a second interaction model on one page). Delete confirms with `window.confirm()`.

Form fields: name text input; `kind` radio or select; a category `<select>` shown only when `kind === 'category'`; `target_amount` numeric; `target_currency` select (the option list is duplicated in three files already — duplicate it a fourth time rather than extracting, per the no-shared-primitives convention); and `target_date` as a native `<input type="date">` — **the repo's first**, since `grep 'type="date"' src/` returns zero hits.

Errors from the API render via the existing `ServerError` component (`SettingsForm.tsx:3`). List rows reuse the table/mobile-reflow markup from the assets list. `react-compiler` is an error-level lint rule, so no manual memo hooks.

#### 3. Desktop nav

**File**: `src/components/Topbar.astro`

**Intent**: Make Goals reachable on desktop.

**Contract**: Insert a Goals item pointing at `/dashboard/goals` after Assets (before `:28`), matching the surrounding `hidden … sm:inline-flex` item markup exactly. No active-route styling.

#### 4. Mobile nav

**File**: `src/components/TopbarMenu.tsx`

**Intent**: Make Goals reachable on mobile — the other half of `lessons.md:91-99`.

**Contract**: Insert the matching item after `:57` and add `Target` to the Lucide import at `:3`. **Do not touch** the iOS-Safari pointer-down workaround at `:17,27-35` — Radix's Trigger only listens to `onPointerDown` and iOS Safari can suppress the click, so the controlled-state + ref-gated `onClick` fallback there is load-bearing.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes (including `react-compiler` and `astro/no-set-html-directive`): `npm run lint`
- Full suite passes: `npm run test:ci`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Goals is reachable from the desktop nav **and** from the mobile dropdown at a narrow viewport
- Creating a net-worth goal and a category goal both succeed; the category select appears only for the category kind
- Editing a goal updates the list without a page reload
- Deleting prompts for confirmation and removes the row
- Submitting `target_amount: 0` surfaces the API's error message rather than failing silently
- The native date input opens and its value round-trips through save and reload

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 5: Settings Toggle & Dashboard Card

### Overview

Thread `show_goals` through the settings UI and render the gated `GoalsProgress` card with server-computed props.

### Changes Required:

#### 1. Settings form

**File**: `src/components/settings/SettingsForm.tsx`

**Intent**: Add the Goals card toggle alongside the three existing dashboard toggles.

**Contract**: Five wiring edits mirroring `show_trajectory` — `Props` (`:8-14`), destructure (`:28-34`), `useState` (`:37-39`), `hasChanges` (`:43-48`), and the diff payload (`:56-67`) — plus a checkbox block copied from `:196-215` with its own label and helper sentence. The settings page remains the single UI for this flag, per the S-05 lesson.

#### 2. Settings page

**File**: `src/pages/dashboard/settings.astro`

**Intent**: Read and default the new preference.

**Contract**: Four edits mirroring `show_trajectory` — add to the `select` (`:23`), the raw typed read (`:31`), the `?? true` default (`:39`), and the prop pass (`:58`).

#### 3. Card island

**File**: `src/components/goals/GoalsProgress.tsx`

**Intent**: Present goal progress on the dashboard. Purely presentational — a function of props with zero state, zero effects, zero fetching, exactly like `FireProgress`.

**Contract**: **Export the props interface** the way `DriftAlerts.tsx:17-24` does so `dashboard.astro` imports rather than redeclares it.

Card shell is the gated-card family string, identical in `FireProgress.tsx:32,56` and `DriftAlerts.tsx:100`:
`mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10`
(⚠️ chart cards use a *different* shell — `dark:bg-white/5`, no blur. Do not mix them.)

Eyebrow: `text-sm tracking-wider text-zinc-500 uppercase dark:text-white/50`.

Per-goal progress bar copies `FireProgress.tsx:68-80` verbatim in structure — track `h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10`; fill `transition-[width] duration-700 ease-out motion-reduce:transition-none`, `bg-emerald-500` at ≥100% else `bg-gradient-to-r from-blue-500 to-purple-500`; `role="progressbar"` with `aria-valuenow/min/max/label`. Label shows the **uncapped** true ratio; fill width is `Math.min(pct, 100)`.

The defensive clamp from `FireProgress.tsx:50-53` is copied per goal, not hoisted — it is the fix for impl-review F1 and belongs at the view edge even though Phase 2 already guards at the source:

```ts
const rawPct = percent ?? 0;
const pct = Number.isFinite(rawPct) ? Math.max(0, rawPct) : 0;
const fillWidth = Math.min(pct, 100);
```

ETA rendering switches on the `GoalEta` discriminant — this is where the four-state decision becomes visible:

| `status` | Rendering |
| --- | --- |
| `projected` | An ETA metric row with the formatted date, plus the on-track/behind badge when `onTrackVerdict` is non-null |
| `reached` | A "Reached" treatment using the same emerald accent as the ≥100% bar |
| `not_reaching` | The shipped copy, verbatim: *"On your current trend, you won't reach this."* (`NetWorthChart.tsx:326`) |
| `insufficient_history` | *"Not enough snapshot history in this currency to project a date."* |
| `unsupported` | The ETA row is **hidden entirely** (`FireProgress.tsx:83,86` — hide a row, never render "N/A") |

Metric rows use a local `Metric` subcomponent (`FireProgress.tsx:97-104`), `<dl>` + `flex items-baseline justify-between gap-4`.

Renders at most 3 goals sorted by progress descending; a remainder emits a muted `+N more` line linking to `/dashboard/goals`. Formatters stay local and duplicated — there is no shared formatter module, deliberately.

Placeholder state when the user has no goals copies `FireProgress.tsx:30-45`: same shell, same eyebrow, one prompt sentence, purple CTA `<a>` (`bg-purple-600 … hover:bg-purple-500`) to `/dashboard/goals`. Goals follows FIRE here, **not** `DriftAlerts` — drift renders nothing when there's nothing to alert because it is an alert; Goals is a persistent status widget.

Footer disclaimer mirrors `FireProgress.tsx:90-92`: an **estimate, not financial advice**, shown in `{displayCurrency}`.

#### 4. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Compute every goal's progress and ETA server-side and gate the card on the preference.

**Contract**: Add `show_goals` to the `prefs` select (`:75`) and `const showGoals: boolean = (prefs?.show_goals ?? true) as boolean;` beside the existing two. Add a `goals` query filtered by `user_id`.

Follow the null-object gating idiom used by both existing cards: `let goalsCard: GoalsProgressProps | null = null; if (showGoals) { …compute… goalsCard = {…} }`, then `{goalsCard && <GoalsProgress {...goalsCard} client:load />}` placed **after `FireProgress`, before `DriftAlerts`** in the gated-card cluster at `:249-250`. Unlike `driftAlerts`, `goalsCard` stays non-null when the goal list is empty — that is what renders the placeholder.

The ETA computation reuses the existing `snapshots` array already fetched at `:34-38` — no new snapshot query. Transform per `NetWorthChart.tsx:128-182`: filter to `s.display_currency === displayCurrency` **first**, take `originMs` from the first comparable row, map to `{t, value}` samples, fit once, then call `goalEta` per goal with the shared `fit`/`lastT`/`originMs` and that goal's progress. Fit once for all goals, not per goal.

`convertAmount(goal.target_amount, goal.target_currency, displayCurrency, rates)` supplies the denominator; `rates` is the already-awaited value from `:33`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Full suite passes: `npm run test:ci`
- Production build succeeds: `npm run build`

#### Manual Verification:

- With no goals, the dashboard card shows the placeholder and its CTA reaches `/dashboard/goals`
- With 4+ goals, exactly 3 render, ordered by progress descending, with a `+1 more` line
- A goal whose target is below current net worth renders at >100% with an uncapped label, a clamped emerald bar, and the "Reached" state — not a date
- A net-worth goal on a rising trend shows a plausible ETA date; setting a target date earlier than it flips the badge to behind
- A category goal shows a bar and no ETA row at all
- Switching display currency in Settings so fewer than 2 comparable snapshots remain shows the insufficient-history copy, **not** "you won't reach this"
- Unchecking the Settings toggle removes the card after the form's `window.location.reload()`
- The card is visually indistinguishable in shell, spacing, and dark mode from `FireProgress` directly above it

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 6: Backup Round-Trip

### Overview

Make both the `goals` table and the `show_goals` preference survive an export/import cycle. The RPC migration and the `backup.ts` whitelist edit land **together** — see Critical Implementation Details.

### Changes Required:

#### 1. Restore RPC

**File**: `supabase/migrations/20260724150000_restore_backup_goals.sql`

**Intent**: Extend `restore_backup` to carry the new preference column and the new table.

**Contract**: `CREATE OR REPLACE FUNCTION restore_backup(p_mode text, p_data jsonb)` copied wholesale from `20260724120000_restore_backup_show_trajectory.sql`, preserving `SECURITY DEFINER`, `SET search_path = public, pg_temp` (`lessons.md:81-89`), the delete ordering, and every existing insert unchanged.

Four additions:

1. `show_goals` in the `user_preferences` INSERT column list (after `:66`)
2. `COALESCE(r.show_goals, true)` in the corresponding `SELECT` (after `:85`) — the re-default pattern that keeps a lower-version backup from violating `NOT NULL`
3. `show_goals = EXCLUDED.show_goals` in `ON CONFLICT … DO UPDATE SET` (after `:103`) — **the line whose omission is the exact shape of the bug that shipped three times**: present in the INSERT but absent here restores correctly on a fresh row and silently keeps the stale value on an existing one, and the prefs row always exists
4. A `goals` insert block, `INSERT INTO goals (user_id, name, kind, category_id, target_amount, target_currency, target_date, created_at, updated_at) SELECT v_user, r.… FROM jsonb_populate_recordset(null::goals, p_data->'goals') AS r;`, plus `DELETE FROM goals WHERE user_id = v_user;` in the `replace` branch alongside the existing deletes (`:43-48`)

#### 2. Backup module

**File**: `src/lib/backup.ts`

**Intent**: Carry goals across the export/import boundary without breaking previously-exported files.

**Contract**: Bump `CURRENT_SCHEMA_VERSION` to `2` (`:15`). Add `"show_goals"` to `USER_PREFERENCES_COLUMNS` (`:44`). Add a `GOALS_COLUMNS` whitelist typed `as const satisfies readonly (keyof Tables<"goals">)[]` covering `id`, `user_id`, `name`, `kind`, `category_id`, `target_amount`, `target_currency`, `target_date`, `created_at`, `updated_at`, and thread `goals` through `BackupData`, `BackupInput`, `REQUIRED_FIELDS` (`name`, `kind`, `target_amount`, `target_currency`), `TIMESTAMP_FIELDS` (`created_at`, `updated_at` — **not** `target_date`, which is a `DATE` and fails `isIsoTimestamp`), `serialize`, and `prepareForImport` (drop `id` and `user_id`; the RPC stamps ownership).

The load-bearing change is in `validateEnvelope`: the table loop at `:228-233` currently fails an envelope missing any array. `goals` must be treated as **optional** — absent normalises to `[]` rather than erroring — otherwise every file exported before this change becomes un-importable. The existing version policy already accepts lower-versioned files (`:215` only rejects *newer*), and this is what makes that acceptance real.

`category_id` on goals must join the category-membership check at `:269-276` so an unknown id is caught before any write, not by the FK.

#### 3. Export route

**File**: `src/pages/api/backup/export.ts`

**Intent**: Include goals in the exported envelope.

**Contract**: Add `GOALS_COLUMNS` to the import list, derive a `goalsSelect` projection alongside the existing four, and add the query to the `Promise.all` at `:47-51` (goals has its own `user_id`, so it needs no transitive fetch like `snapshot_items`). Extend the combined error check and the `input` object.

#### 4. Import route

**File**: `src/pages/api/backup/import.ts`

**Intent**: No functional change — confirm the orchestration still holds.

**Contract**: The route already delegates entirely to `validateEnvelope` → `prepareForImport` → `restore_backup`, so it needs no edit. Verify the existing `import.test.ts` fixtures still pass given the schema-version bump, and update any that assert `schemaVersion: 1`.

#### 5. Test updates

**File**: `src/lib/backup.test.ts`, `src/lib/backup-rpc-parity.test.ts`, `src/pages/api/backup/export.test.ts`

**Intent**: Keep the parity gate meaningful and pin the backwards-compatibility behaviour.

**Contract**: In `backup.test.ts`, add goals coverage. (The `show_goals: true` prefs-fixture line at `:39` — which the assertion at `:125` depends on once `show_goals` joins the whitelist — **already landed in Phase 1 §4**; see the approved deviation recorded there. Do not add it twice.) **Add a new case pinning that a `schemaVersion: 1` envelope with no `goals` key validates successfully and yields `goals: []`** — this is the regression that would otherwise only surface when a real user imports an old file.

In `backup-rpc-parity.test.ts`, add `goals: ["id"]` to `INTENTIONALLY_OMITTED` (`:22-27`) and a `["goals", GOALS_COLUMNS]` row to `TABLES` (`:67-72`). Extend the export-route test's mock to cover the new query.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Parity gate passes: `npx vitest run src/lib/backup-rpc-parity.test.ts`
- Backup module tests pass: `npx vitest run src/lib/backup.test.ts`
- Backup route tests pass: `npx vitest run src/pages/api/backup`
- Full suite passes: `npm run test:ci`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Export a backup with 2+ goals and the toggle **off**; the downloaded JSON contains a `goals` array, `show_goals: false`, and `schemaVersion: 2`
- Import that file in `replace` mode into a second account: both goals appear and the dashboard card is hidden
- Import it again in `merge` mode: the toggle stays off (this is the `ON CONFLICT DO UPDATE` line the bug has hit three times — the prefs row already exists, so the INSERT branch never runs)
- Import a **pre-change** backup file (no `goals` key, `schemaVersion: 1`): it succeeds rather than erroring
- Importing a file whose goal references an unknown `category_id` fails validation with `UNKNOWN_CATEGORY` before any write

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

`src/lib/goals.test.ts` carries the correctness weight. Oracles are computed from first principles per the repo policy; `toBeCloseTo(_, 6)` for anything involving division; the mandatory 333.33-class FP probe.

Key edge cases: `target_amount` at the `EPSILON` boundary; progress above 100 (uncapped label, clamped fill); a category goal returning `unsupported` even with a valid fit in hand; `insufficient_history` distinct from `not_reaching`; `categorySubtotal` over a category containing a liability; `onTrackVerdict` null on each absent-input path; mixed target currency versus display currency.

### Integration Tests:

`src/pages/api/goals/*.test.ts` cover both handlers: status codes, error `code` strings, the `.eq("user_id")` tenant filter, filter ordering on the `[id]` route, the 404-not-403 convention for foreign rows, and a structural pin that responses never leak `user_id`. `api-auth-contract.test.ts` auto-covers the new routes with no authoring.

`backup-rpc-parity.test.ts` is the gate on Phase 6 and will go red if the RPC and whitelist drift apart in either direction.

### Manual Testing Steps:

1. Create one net-worth goal above current net worth and one below; confirm the first shows a projected date and the second shows the Reached state.
2. Create a category goal; confirm a bar renders and no ETA row appears at all.
3. Create 4 goals; confirm the dashboard shows exactly 3 by descending progress plus `+1 more`.
4. Set a target date earlier than the projected ETA; confirm the badge reads behind. Set it later; confirm on track.
5. Switch display currency in Settings so fewer than 2 comparable snapshots remain; confirm the insufficient-history copy, not "you won't reach this".
6. Toggle the Settings checkbox off and on; confirm the card disappears and returns after the form's reload.
7. Navigate to Goals from the desktop nav, then from the mobile dropdown at a narrow viewport.
8. Export → import (`replace`, then `merge`) with the toggle off; confirm goals and the toggle both survive both modes.
9. Import a pre-change backup file with no `goals` key; confirm it succeeds.
10. Delete a goal that is currently rendered on the dashboard card; confirm the card re-ranks after reload.

**No E2E spec.** The two hydration traps recorded in S-20's closeout make new form specs expensive: an island that hydrates after a `fill()` initialises React's value tracker to the DOM text, so re-filling the same string never fires `onChange`. The card's real risk is money math, which the unit tests cover directly, and the tenant boundary, which the handler tests cover. If an E2E is added later it must carry the `hasLocalDb()` skip guard from `e2e/trajectory-verify.spec.ts:19-34` — **CI e2e runs against remote Supabase**, so an unguarded seeding spec writes to production.

## Performance Considerations

No new queries on the dashboard's hot path beyond one `goals` select — the snapshot array the ETA needs is already fetched at `dashboard.astro:34-38`. The trajectory fit runs **once** for all goals, not per goal. `categorySubtotal` is a single pass over the already-loaded assets array. All of it is server-side in frontmatter, so the island ships no computation.

## Migration Notes

Three migrations, all forward-only with commented rollback blocks: `20260724130000_goals.sql`, `20260724140000_user_preferences_show_goals.sql` (Phase 1), and `20260724150000_restore_backup_goals.sql` (Phase 6).

`show_goals` defaults to `TRUE`, so existing users see the card without a backfill. That default is re-asserted at four layers that must agree: the DB default, the RPC `COALESCE`, `settings.astro`'s `?? true`, and `dashboard.astro`'s `?? true`.

`goals.category_id` references the globally-seeded `asset_categories`. Note that `seed.sql` runs on `db reset`/`start` but **not** on `supabase migration up`, so a production DB populated only by migrations could in principle have an empty `asset_categories` — the same latent condition already affecting `assets`.

`supabase/config.toml` is currently dirty with a `project_id` rename to `"bitworth"`. It renames the local Docker namespace, so the next `supabase start` after it lands spins up a fresh empty stack. Unrelated to this change, but worth knowing before the first `db reset` of Phase 1.

## References

- Research: `context/changes/savings-goals/research.md`
- Roadmap slice: `context/foundation/roadmap.md` §S-21
- Lessons: `context/foundation/lessons.md` (§RLS USING-only, §Currency cast boundary, §Nav items live in two files, §SECURITY DEFINER search_path)
- Trajectory helper: `src/lib/trajectory.ts:168-181`
- ETA caller recipe: `src/components/NetWorthChart.tsx:128-182`
- Card template: `src/components/fire/FireProgress.tsx:30-53,68-104`
- CRUD template: `src/pages/api/allocation-cards/index.ts:5-19,69-85`, `[id].ts:33-36,56-57`
- Table template: `supabase/migrations/20260624120000_allocation_targets.sql:22-42`
- RPC template: `supabase/migrations/20260724120000_restore_backup_show_trajectory.sql:66,85,103`
- Parity gate: `src/lib/backup-rpc-parity.test.ts:22-27,67-87`
- Prior slice deferring this one: `context/archive/2026-07-19-net-worth-trajectory/plan.md:32,50`
- The `Infinity`/`NaN` bug this repeats: `context/archive/2026-06-23-fire-dashboard/reviews/impl-review.md:25-37`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & Types

#### Automated

- [x] 1.1 Migrations apply cleanly: `npx supabase db reset` — fa9f0ed
- [x] 1.2 Type checking passes: `npx astro sync && npx tsc --noEmit` — fa9f0ed
- [x] 1.3 Linting passes: `npm run lint` — fa9f0ed
- [x] 1.4 Existing test suite still green: `npm run test:ci` — fa9f0ed

#### Manual

- [x] 1.5 `kind`/`category_id` CHECK rejects an incoherent insert (verified: psql against local DB — `net_worth`+`category_id` and `category`+NULL both raise `goals_check`; coherent insert succeeds; `target_amount 0`, `GBP`, and `kind='retirement'` also correctly rejected) — fa9f0ed
- [x] 1.6 RLS isolates `goals` rows between two users (verified: two `SET LOCAL request.jwt.claims` sessions — A sees only A's rows, B only B's; B reassigning `user_id` to A raises "new row violates row-level security policy" (WITH CHECK holds); B deleting A's row yields `DELETE 0`) — fa9f0ed
- [x] 1.7 `updated_at` trigger fires on UPDATE (verified: UPDATE on a goal bumped `updated_at` 116.63s past an unchanged `created_at`) — fa9f0ed

### Phase 2: Pure Goals Math

#### Automated

- [x] 2.1 New tests pass: `npx vitest run src/lib/goals.test.ts` — d47bf40
- [x] 2.2 Full suite passes: `npm run test:ci` — d47bf40
- [x] 2.3 Type checking passes: `npx tsc --noEmit` — d47bf40
- [x] 2.4 Linting passes: `npm run lint` — d47bf40

#### Manual

- [x] 2.5 Every oracle in `goals.test.ts` is hand-derivable without reading `goals.ts` (verified: read all 37 cases; re-derived the OLS fit (slope 1000/intercept 100_000 from the collinear samples), the 100-day crossing → 2026-04-11 calendar walk, the CAGR doubling, the declining-trend t=20 past-crossing, and every percent oracle by hand; independently confirmed the test's stated `convertAmount` semantics, `EPSILON = 1e-2`, and `etaToTarget` branch behaviour against the real sources. One comment mis-stated `33_333/333.33` as `100.0009` — it is exactly 100; corrected) — d47bf40

### Phase 3: Goals CRUD API

#### Automated

- [x] 3.1 New handler tests pass: `npx vitest run src/pages/api/goals` — 68f196f
- [x] 3.2 Auth-contract walk covers the new routes — 68f196f
- [x] 3.3 Full suite passes: `npm run test:ci` — 68f196f
- [x] 3.4 Type checking passes: `npx tsc --noEmit` — 68f196f
- [x] 3.5 Linting passes: `npm run lint` — 68f196f

#### Manual

- [x] 3.6 Incoherent `kind`/`category_id` POST returns 400, not 500 (verified: curl against dev server as a real signed-in user — `net_worth`+`category_id` → 400 `VALIDATION_ERROR` "category_id must be absent when kind is net_worth"; `category` without one → 400 with the mirrored message) — 68f196f
- [x] 3.7 PATCH against a foreign goal id returns 404 (verified: two accounts; A PATCHing B's goal → 404 `NOT_FOUND`, A DELETEing it → 404, and a follow-up GET as B confirmed the row unchanged) — 68f196f
- [x] 3.8 `target_amount: 0` returns 400 (verified: → 400 "target_amount must be greater than 0"; `100.123` → 400 "at most 2 decimal places", the `NUMERIC(18,2)` precision guard) — 68f196f
- [x] 3.9 PUT `/api/user-preferences` with `show_goals` persists (verified: PUT `{"show_goals":false}` → 200 with the flag in the response body, confirmed `f` in Postgres for that user while the other account still read `t` from the column default; non-boolean → 400) — 68f196f

### Phase 4: Goals Page & Nav

#### Automated

- [x] 4.1 Type checking passes: `npx tsc --noEmit` — aaff1d0
- [x] 4.2 Linting passes: `npm run lint` — aaff1d0
- [x] 4.3 Full suite passes: `npm run test:ci` — aaff1d0
- [x] 4.4 Production build succeeds: `npm run build` — aaff1d0

#### Manual

- [x] 4.5 Goals reachable from desktop nav and mobile dropdown (verified: Playwright against the dev server — desktop link visible at 1280px and navigates; at 390px the desktop item is CSS-hidden and the Radix dropdown's Goals menuitem navigates) — aaff1d0
- [x] 4.6 Both goal kinds create successfully; category select is conditional (verified: net_worth default renders zero Category selects; created a 1,000,000 EUR net-worth goal, then switching kind revealed the picker and a savings_account category goal created — 2 rows) — aaff1d0
- [x] 4.7 Edit updates the list without a page reload (verified: set a `window` marker before editing; the rename landed in the table and the marker survived, proving no document navigation) — aaff1d0
- [x] 4.8 Delete confirms and removes the row (verified: dismissing the `window.confirm` left the row intact; accepting removed it and the empty state returned) — aaff1d0
- [x] 4.9 Invalid `target_amount` surfaces the API error message (verified: `0` rendered "target_amount must be greater than 0" with nothing written; `100.123` rendered the distinct 2-decimal-places message) — aaff1d0
- [x] 4.10 Native date input round-trips through save and reload (verified: input is `type="date"`; `2027-12-31` persisted, survived a full page reload from Postgres, and repopulated the edit form) — aaff1d0

### Phase 5: Settings Toggle & Dashboard Card

#### Automated

- [x] 5.1 Type checking passes: `npx tsc --noEmit` — 025a54a
- [x] 5.2 Linting passes: `npm run lint` — 025a54a
- [x] 5.3 Full suite passes: `npm run test:ci` — 025a54a
- [x] 5.4 Production build succeeds: `npm run build` — 025a54a

#### Manual

- [x] 5.5 Empty state renders the placeholder with a working CTA (verified: Playwright as a goal-less user — eyebrow plus the purple "Create your first goal" CTA, which navigates to `/dashboard/goals`) — 025a54a
- [x] 5.6 4+ goals render exactly 3 by descending progress with `+N more` (verified: seeded 4 goals; exactly 3 `progressbar`s render with `aria-valuenow` 200/50/50 in descending order, the 25% goal has no bar, and the "+1 more goal" link points at `/dashboard/goals`) — 025a54a
- [x] 5.7 Over-100% goal shows uncapped label, clamped bar, Reached state (verified: target 50k against 100k net worth → `aria-valuenow="200"`, label reads "200%", inline `width: 100%` with `bg-emerald-500`, and a "Reached" status row instead of a date) — 025a54a
- [x] 5.8 Net-worth goal shows a plausible ETA; target date flips the on-track badge (verified: on the seeded +1000/day trend the 200k target projected to November 1, 2026 — exactly 100 days out, matching the hand-computed crossing; no badge with no target date, "Behind" for 2026-08-01, "On track" for 2027-12-31) — 025a54a
- [x] 5.9 Category goal shows a bar and no ETA row (verified: `Progress toward Emergency fund` bar at 50% of the savings subtotal, with no "Est. completion" row, no "N/A", and no trend copy anywhere in the block) — 025a54a
- [x] 5.10 Currency switch shows insufficient-history copy, not "won't reach" (verified: switching display currency to EUR leaves zero comparable snapshots → "Not enough snapshot history in this currency to project a date." rendered and the "won't reach" sentence absent) — 025a54a
- [x] 5.11 Settings toggle hides and restores the card (verified: `show_goals: false` → card and all progressbars gone after reload; `true` → restored) — 025a54a
- [x] 5.12 Card matches `FireProgress` in shell, spacing, and dark mode (verified: shell carries the gated-card family string — `bg-white/80`, `backdrop-blur-xl`, `border-zinc-200`, `dark:bg-white/10` — and not the chart cards' `dark:bg-white/5`; confirmed visually on a dark-mode screenshot with the card sitting directly below FireProgress) — 025a54a

### Phase 6: Backup Round-Trip

#### Automated

- [x] 6.1 Migration applies cleanly: `npx supabase db reset`
- [x] 6.2 Parity gate passes: `npx vitest run src/lib/backup-rpc-parity.test.ts`
- [x] 6.3 Backup module tests pass: `npx vitest run src/lib/backup.test.ts`
- [x] 6.4 Backup route tests pass: `npx vitest run src/pages/api/backup`
- [x] 6.5 Full suite passes: `npm run test:ci`
- [x] 6.6 Type checking passes: `npx tsc --noEmit`
- [x] 6.7 Linting passes: `npm run lint`

#### Manual

- [x] 6.8 Export carries `goals`, `show_goals: false`, and `schemaVersion: 2` (verified: real `GET /api/backup/export` for a user with 2 goals and the toggle off — `schemaVersion: 2`, both goals in `data.goals`, `show_goals: false` in `user_preferences`)
- [x] 6.9 `replace` import restores goals and the hidden card (verified: posted that envelope with `mode: "replace"` as a second account → 200; both goals present in Postgres with correct `kind`, `category_id` and `target_date`, and `show_goals` = `f`)
- [x] 6.10 `merge` import keeps the toggle off (the thrice-shipped bug) (verified: deliberately flipped the target account's `show_goals` back to `true` first so `ON CONFLICT … DO UPDATE SET` had to overwrite it, then merge-imported → back to `f`. This is the exact line whose omission shipped the bug three times; it holds)
- [x] 6.11 Pre-change backup with no `goals` key imports successfully (verified: stripped `goals` and `show_goals` and set `schemaVersion: 1` → 200, zero goals written, and `show_goals` re-defaulted to `t` via the RPC's `COALESCE`)
- [x] 6.12 Unknown `category_id` fails with `UNKNOWN_CATEGORY` before any write (verified: → 400 `UNKNOWN_CATEGORY` with `context.unknownCategoryIds: ["no_such_category"]`, and the goals table stayed at 0 rows — rejected ahead of the RPC, not by the FK)
