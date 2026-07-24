---
date: 2026-07-24T20:07:33+0200
researcher: maksymkozachuk
git_commit: 8cf9ecbdce79f23a8d47a08af74951340d47a1d3
branch: feature/savings-goals
repository: bitworth
topic: "S-21 Custom savings goals — what the codebase already provides and what must be built"
tags: [research, codebase, savings-goals, trajectory, user-preferences, crud, rls, migrations]
status: complete
last_updated: 2026-07-24
last_updated_by: maksymkozachuk
---

# Research: S-21 Custom savings goals

**Date**: 2026-07-24T20:07:33+0200
**Researcher**: maksymkozachuk
**Git Commit**: `8cf9ecbdce79f23a8d47a08af74951340d47a1d3`
**Branch**: `feature/savings-goals`
**Repository**: bitworth

## Research Question

Ground the S-21 roadmap slice (`context/foundation/roadmap.md:428-444`) in the live codebase: what does `etaToTarget` actually promise, what is the exact end-to-end pattern for a settings-gated dashboard card, what CRUD/API/migration conventions must a new `goals` table and `/dashboard/goals` page follow, and what do the tests and prior changes constrain?

## Summary

The slice is **mostly assembly, with one real build**. Four of the six roadmap Unknowns are already settled by precedent that can be copied nearly verbatim; two are not.

**What exists and can be reused as-is:**

- `etaToTarget` is shipped, pure, and tested (25 tests) — `src/lib/trajectory.ts:168-181`.
- The settings-gated dashboard card is a fully-worn groove with three precedents; the file-by-file checklist is mechanical.
- `convertAmount` handles the mixed-currency target directly — no new math.
- The migration/RLS shape for a new user-owned table has a copy-paste template (`allocation_targets`).

**What does not exist and must be built:**

1. **There is no per-category subtotal anywhere in the codebase.** Every existing helper is per-*asset* or per-*card*; `AssetsSummary` groups by currency, not category. A `kind: 'category'` goal needs net-new math.
2. **There is no per-category historical series either** — and that, not the subtotal, is the real cost. A category-goal *ETA* requires aggregating `snapshot_items` by category per snapshot, which is the separate S-23 slice's core work. **This is the biggest scope discovery in this research** (see Open Question 1).

**Three traps that have each already bitten this repo:**

- The preference chain is **9 touchpoints, not 7**. The roadmap lists the 5 obvious ones; `backup.ts` and the `restore_backup` RPC are the two that get forgotten, and forgetting the RPC has shipped a silent data-loss bug **three times** (`a1604bc`).
- `percent = current / target` with `target = 0` produces `Infinity`/`NaN` that leaks into `aria-valuenow` — the exact bug found in the FIRE card's impl-review (F1).
- `etaToTarget` returns `null` for **both** "already reached" and "will never reach". The card cannot tell them apart from the ETA alone.

---

## Detailed Findings

### 1. The trajectory math (`src/lib/trajectory.ts`)

Read fully; 182 lines, pure, no IO. Header contract (`:1-18`): *"Every function is pure and total: degenerate input … returns `null` rather than throwing, so callers guard a value instead of a try/catch."*

Exports (`:20-42` types, `:53-181` functions):

```ts
type FitModel = "linear" | "cagr"                                    // :20
interface TrajectorySample { t: number; value: number }              // :22-26  t = days since first sample
type Fit = LinearFit | CagrFit                                       // :42
fitLinear(samples): LinearFit | null                                 // :53
fitCagr(samples): CagrFit | null                                     // :87
valueAt(fit, t): number                                              // :124
projectForward(fit, fromT, toT, steps): TrajectorySample[]           // :141
etaToTarget(fit, target, fromT): number | null                       // :168
```

**`etaToTarget` returns a number of DAYS on the sample `t` axis — not a `Date`, not months.** Full body at `src/lib/trajectory.ts:168-181`. It returns `null` when:

| Condition | Line |
|---|---|
| linear slope is 0 (flat trend) | `:171` |
| cagr `target <= 0` (ln undefined) | `:174` |
| cagr logSlope is 0 | `:175` |
| solved `t` is non-finite | `:178` |
| **`t <= fromT` — already reached OR crossing is in the past** | `:179` |

That last row is the one to design around: a goal at 130% and a goal on a declining trend both yield `null`. The card must disambiguate on progress %, not on the ETA.

**Caller-side recipe to copy verbatim** — `src/components/NetWorthChart.tsx:128-182`:

```ts
const MS_PER_DAY = 86_400_000;                                                        // :20
const comparable = snapshots.filter((s) => s.display_currency === displayCurrency);   // :131
const originMs = new Date(comparable[0].created_at).getTime();                        // :132
const samples = comparable.map((s) => ({
  t: (new Date(s.created_at).getTime() - originMs) / MS_PER_DAY,
  value: s.total_net_worth,
}));                                                                                  // :133-136
const etaT = etaToTarget(activeFit, targetValue, lastT);                              // :181
const etaDate = etaT !== null ? new Date(originMs + etaT * MS_PER_DAY).toISOString() : null; // :182
```

Load-bearing details inherited from S-20:

- **The fit runs only over snapshots whose `display_currency` matches the current one** (`:131`). Never fit across a currency change — S-20's plan calls this out explicitly (`context/archive/2026-07-19-net-worth-trajectory/plan.md:50`).
- Minimum is **≥2 *comparable* snapshots** (`:138`), not ≥2 snapshots.
- Two snapshots on the same calendar day → zero-variance `t` axis → `fitLinear` returns `null` (`trajectory.ts:73`).
- `fromT` is always the last historical sample's `t`.
- Shipped null-ETA copy: `"On your current trend, you won't reach this."` (`NetWorthChart.tsx:326`).
- `fitCagr` returns `null` if *any* value ≤ 0 (`trajectory.ts:91`); the UI disables CAGR with *"Compound projection needs positive history."* (`NetWorthChart.tsx:294-296`).

S-20's module header explicitly blesses **server-side** use: *"imported on both the Astro SSR server and the React island."* S-21 can compute ETAs in `dashboard.astro` frontmatter, matching the FIRE card's decision rather than the chart's.

### 2. Net-worth and currency math (`src/lib/net-worth.ts`, 57 lines)

```ts
convertAmount(amount, fromCurrency: Currency, toCurrency: Currency, rates: Record<Currency, number>): number  // :18-27
computeNetWorth(assets: NetWorthAsset[], displayCurrency, rates): number                                      // :40-55
```

- `rates` are **units-per-USD** (`USD: 1.0` always); conversion pivots through USD (`:25-26`).
- **No missing-rate guard** — `rates[missing]` yields `NaN` silently. The defense is upstream: `getRates` always returns a complete record via a `catch` fallback to `STATIC_RATES = { USD: 1.0, EUR: 0.92, PLN: 3.85 }` (`src/lib/exchange-rates.ts:83-85`). **Callers get no signal that rates are stale or hardcoded.**
- `getRates(supabase)` is **async** (`exchange-rates.ts:46-86`, 1h cache); `convertAmount` is sync. Established pattern: `await getRates()` once in `.astro` frontmatter, pass `rates` down as a prop. Call sites include `dashboard.astro:33`, `fire.astro:23`, `balancer.astro:22`.
- `Currency` is canonically `src/lib/exchange-rates.ts:3`, re-exported from `net-worth.ts:3`; everyone imports it from `@/lib/net-worth`.
- **Currency cast boundary** (`context/foundation/lessons.md:25-33`): keep `convertAmount` typed as `Currency`; cast at the call site. The preferred lib-layer form for *new* modules declares `currency: string` on the input interface and casts inside the function body (as `movers.ts:60` and `allocation.ts:296` do) — so a `goals.ts` should do that, not push casts onto its callers.

For S-21 the currency question is genuinely trivial: `convertAmount(target, targetCurrency, displayCurrency, rates)` on one side, the existing converted current value on the other.

### 3. Per-category math — **does not exist**

Searched `src/` for `byCategory|categoryTotals|perCategory|groupBy`, all `convertAmount` call sites, and every module in `src/lib/`. **Nothing groups assets by `category_id` and sums them.**

| Helper | file:line | Reusable for "current value of one category"? |
|---|---|---|
| `totalAssetPool` | `src/lib/allocation.ts:288-300` | Closest. Sums converted values but hard-filters liabilities (`:295`) and `converted > 0` (`:297`). Its `ShareAsset` type (`:48-52`) **carries no `category_id`**, so it cannot filter by category — a goals helper would pre-filter then call it, or copy the 8-line loop. |
| `contribution` | `src/lib/movers.ts:53-62` | Directly reusable as the per-row primitive; takes `currency: string` and casts internally, so no cast at the call site. |
| `assetSharePct` | `src/lib/allocation.ts:307-310` | Reusable for a progress %; returns `null` when `Math.abs(total) < EPSILON` (`EPSILON = 1e-2`, `:22` — canonical, reuse it). |
| `buildAssetTrends` | `src/lib/asset-trends.ts:50-94` | Groups by asset identity, not category — but its `Map` loop (`:55-64`) is the structural template for a category grouping. |

Category is currently used only as the **liability discriminator**: there is no `is_liability` on `assets`, it lives on `asset_categories.is_liability`, so every consumer joins `category:asset_categories(*)`.

**The historical series is the harder gap.** `snapshots.total_net_worth` gives net-worth history for free. A category goal's ETA needs history *per category*, which must be aggregated from `snapshot_items` (`category_id`, `original_amount`, `original_currency` — `src/lib/database.types.ts:247-260`). The query shape exists at `dashboard.astro:53-57`:

```ts
.from("snapshots").select("id, created_at, snapshot_items(*, category:asset_categories(*))")
```

…but the aggregation does not. Note the convention it must follow: both `movers.ts:66-68` and `asset-trends.ts:36-39` deliberately **re-convert `original_amount` at today's rates** rather than reading the stored `converted_amount`, *"so a display-currency switch never fabricates movement."* A category trajectory that reads `converted_amount` would show fake trend after a currency change.

This aggregation is precisely what roadmap slice **S-23** owns (`roadmap.md:74`: *"`S-23` sums `snapshot_items` by category per snapshot"*). See Open Question 1.

### 4. The settings-gated card chain — 9 touchpoints

Three precedents. **`show_fire_dashboard` (S-14) and `show_drift_alerts` (S-18) are the template**; `show_trajectory` (S-20) is an outlier that gates a *prop on an existing chart*, not a card — do not copy it.

| # | Layer | File | What to add |
|---|---|---|---|
| 1 | Migration | `supabase/migrations/<ts>_user_preferences_show_goals.sql` | `ALTER TABLE user_preferences ADD COLUMN show_goals BOOLEAN NOT NULL DEFAULT TRUE;` in `BEGIN;/COMMIT;`. No backfill — the default covers existing rows. Template: `20260719120000_user_preferences_show_trajectory.sql:12` |
| 2 | **RPC parity** | `supabase/migrations/<ts>_restore_backup_show_goals.sql` | Copy `20260724120000_restore_backup_show_trajectory.sql` wholesale; add `show_goals` in **three** places: INSERT column list (`:66`), `COALESCE(r.show_goals, true)` in the SELECT (`:85`), and `show_goals = EXCLUDED.show_goals` in `ON CONFLICT … DO UPDATE SET` (`:103`) |
| 3 | Types | `src/lib/database.types.ts` | 3 lines, hand-added — Row `:354`, Insert `:373`, Update `:392`. Alphabetical: between `show_fire_dashboard` and `show_trajectory` |
| 4 | API | `src/pages/api/user-preferences/index.ts` | `PREFS_SELECT` (`:16`), `updates` type (`:158-160`), + a 4th copy of the 6-line validation branch after `:196` |
| 5 | Backup | `src/lib/backup.ts:44` | add `"show_goals"` to `USER_PREFERENCES_COLUMNS` |
| 6 | Backup test | `src/lib/backup.test.ts:39` | add `show_goals: true` to the fixture — `:125` asserts every whitelisted column exists |
| 7 | Settings UI | `src/components/settings/SettingsForm.tsx` | 5 wiring edits (`:8-14` props, `:28-34` destructure, `:37-39` state, `:43-48` `hasChanges`, `:56-67` diff payload) + a checkbox block inserted at `:215` |
| 8 | Settings page | `src/pages/dashboard/settings.astro` | select `:23`, raw read `:31`, `?? true` default `:39`, prop pass `:58` |
| 9 | Dashboard | `src/pages/dashboard.astro` | select `:75`, `const showGoals = (prefs?.show_goals ?? true) as boolean;`, the `goalsCard` null-object block, `{goalsCard && <GoalsProgress {...goalsCard} client:load />}` near `:249-250` |

**Steps 2, 5, 6 are the ones the roadmap omits.** `context/archive/2026-07-11-allocation-drift-alerts/plan.md:14` flags `backup.ts` as *"the touchpoint the roadmap omitted — missing it silently drops the pref from export/import."* The RPC gap is worse: commit `a1604bc`'s body reads *"This gap has shipped three times now (show_fire_dashboard/show_drift_alerts, metal_symbol, show_trajectory)."* `src/lib/backup-rpc-parity.test.ts` now guards it and **will go red** if step 5 lands without step 2.

`DEFAULT TRUE` is re-asserted at five layers that must agree: DB default, RPC `COALESCE`, `settings.astro:39`, `dashboard.astro:81`, and (trajectory only) the island prop default.

Validation branch to copy (`src/pages/api/user-preferences/index.ts:191-196`):

```ts
if (raw.show_trajectory !== undefined) {
  if (typeof raw.show_trajectory !== "boolean") {
    return jsonError("VALIDATION_ERROR", "show_trajectory must be a boolean", 400);
  }
  updates.show_trajectory = raw.show_trajectory;
}
```

Absent key = untouched; `:204-206` rejects an entirely empty payload; the write is an upsert on `user_id` (`:208-213`). Settings save ends in `window.location.reload()` (`SettingsForm.tsx:83`) so the SSR gate re-evaluates.

### 5. The card island — `FireProgress` is the template

`src/components/fire/FireProgress.tsx` (105 lines), read fully. **Pure presentational: zero `useState`, zero `useEffect`, zero `fetch`.** All math is server-side in `dashboard.astro`; the island is a function of props. Consequence: it has no loading and no error state — the only branch is the unconfigured placeholder.

Decision origin, `context/archive/2026-06-23-fire-dashboard/plan.md:47`: *"The card computes the FIRE projection **server-side** in `dashboard.astro` (unlike the FIRE page, which computes in its island) because the dashboard card is read-only."*

Elements to mirror:

- **Card shell** (identical string in `FireProgress.tsx:32,56` and `DriftAlerts.tsx:100`):
  `mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10`
  ⚠️ Two shells coexist — chart cards use `dark:bg-white/5` with **no** blur. A `GoalsProgress` card belongs to the gated-card family (with `backdrop-blur-xl`).
- **Eyebrow**: `text-sm tracking-wider text-zinc-500 uppercase dark:text-white/50`
- **Progress bar** (`:68-80`): track `h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10`; fill `transition-[width] duration-700 ease-out motion-reduce:transition-none`, `bg-emerald-500` at ≥100% else `bg-gradient-to-r from-blue-500 to-purple-500`; `role="progressbar"` + `aria-valuenow/min/max/label`.
- **Uncapped label, clamped fill** (`plan.md:53`): the % *label* shows the true ratio (may exceed 100); the fill width is `Math.min(percent, 100)`.
- **Defensive clamp** (`:50-53`) — copy this, it is the fix for impl-review F1:
  ```ts
  const rawPct = percent ?? 0;
  const pct = Number.isFinite(rawPct) ? Math.max(0, rawPct) : 0;
  const fillWidth = Math.min(pct, 100);
  ```
- **Metric rows**: local `Metric` subcomponent (`:97-104`), `<dl>` + `flex items-baseline justify-between gap-4`, `dt` muted / `dd` `font-semibold whitespace-nowrap`. **Hide the row, never show "N/A"** (`:83`, `:86`).
- **Formatters are local and deliberately duplicated** (`:12-13`): *"so this presentational island stays self-contained, per the plan."* There is no shared formatter module anywhere.
- **Placeholder state** (`:30-45`): same shell, eyebrow, one prompt sentence, purple CTA `<a>` (`bg-purple-600 … hover:bg-purple-500`). This is exactly what S-21's "no goals yet" state needs, pointing at `/dashboard/goals`.
- **Export the props interface** the way `DriftAlerts.tsx:17-24` does (`dashboard.astro:15` imports it) rather than redeclaring it in the page as FIRE does (`dashboard.astro:84-91`).
- **Disclaimer footer** (`:90-92`): *"An **estimate, not financial advice**, shown in {displayCurrency}."*

Placement: current order is `NetWorthDisplay → FireProgress → DriftAlerts → AssetsSummary → charts` (`dashboard.astro:239-278`). Roadmap wants Goals *"near FireProgress"* — i.e. in the gated-card cluster before `AssetsSummary`.

Semantics differ deliberately from `DriftAlerts`: drift renders **nothing** when there is nothing to alert (`allocation-drift-alerts/plan.md:41` — *"this is an alert, not a persistent status widget"*), whereas Goals wants a placeholder card. Follow FIRE, not drift.

### 6. CRUD conventions — two generations, pick the newer

| | Assets (older) | **Allocation cards (newer)** |
|---|---|---|
| Routes | 3 pages: list / `new` / `[id]/edit` | 1 page, CRUD inside the island |
| Body | `FormData` | **JSON** |
| Helpers | inlined `new Response(...)` ×12 | **`jsonError()` / `jsonOk()`** |
| Refresh | `window.location.reload()` | **local `useState` update** |
| Verbs | POST/PUT/DELETE | POST/**PATCH**/DELETE |
| Id check | `if (!id)` | **`UUID_RE` → 400** |

Named savings goals are structurally identical to allocation cards (user-owned, named, list/create/edit/delete). **Recommend modeling on `src/pages/api/allocation-cards/`**, borrowing only the table/mobile-reflow list markup from assets.

**Error shape** — verified against the CLAUDE.md hard rule, declared per-file (there is no shared module):

```ts
interface ErrorShape { error: { code: string; message: string; context?: unknown }; }
function jsonError(code, message, status, context?) { … }   // allocation-cards/index.ts:5-19
function jsonOk(data, status = 200) { … }
```

Codes in use: `UNAUTHORIZED` 401, `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `FETCH_FAILED`/`CREATE_FAILED`/`UPDATE_FAILED`/`DELETE_FAILED` 500. **No route ever emits 403** — a row owned by someone else is filtered out by `.eq("user_id", user.id)` and surfaces as 404. Success is always `{ data: … }`; create returns 201.

Documented intent (`allocation-cards/[id].ts:56-57`): *"`.eq("user_id")` is the ownership belt alongside RLS; an unmatched row returns no data, which we surface as 404 rather than a silent success."* Use `.maybeSingle()` not `.single()` — `.single()` makes PostgREST raise, landing in the 500 branch first.

**Validation is hand-rolled — Zod is not a dependency.** Template (`allocation-cards/index.ts:69-85`) with `NAME_MAX = 60`.

**UI primitives are nearly absent.** `src/components/ui/` contains exactly two files: `button.tsx` (shadcn) and `LibBadge.astro`. `components.json` exists but no input/select/dialog/label has been generated. `@radix-ui/react-dialog` is **not installed** — dialogs are native `<dialog>` + `showModal()/close()` (`EditContributionDialog.tsx:161-186`). Confirmation is `window.confirm()`. There is **no currency-select component** (the option list is duplicated in three files) and **no date input anywhere in the repo** — `grep 'type="date"' src/` returns zero hits, so a goal's `target_date` field would be the first; use native `<input type="date">`.

**Nav — both files, always** (`context/foundation/lessons.md:91-99`, earned the hard way in asset-balancer impl-review F2):

- `src/components/Topbar.astro:16-51` — 6 items, desktop, `hidden … sm:inline-flex`. Insert Goals after Assets (before `:28`).
- `src/components/TopbarMenu.tsx:46-81` — same 6 items, Radix dropdown, `sm:hidden`, Lucide icons imported at `:3`. Insert after `:57`, add `Target` to the icon import. Do not touch the iOS-Safari pointer-down workaround at `:17,27-35`.
- **There is no active-route highlighting** anywhere (`grep aria-current` → nothing). Do not invent one.
- `/dashboard/goals` needs **no** middleware registration — `PROTECTED_ROUTES = ["/dashboard"]` matches by `startsWith` (`src/middleware.ts:4,35-39`). Still repeat the frontmatter guard, as every dashboard page does.

### 7. Migration + RLS for the `goals` table

Naming: `YYYYMMDDHHMMSS_snake_case.sql`, hand-rounded to `120000` (or `130000` for a second same-day migration). `20260724120000` is taken.

**Copy-paste template** — `supabase/migrations/20260624120000_allocation_targets.sql:22-42`: `BEGIN;` → table with `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` → `CREATE INDEX idx_<table>_user_id` → `ENABLE ROW LEVEL SECURITY` → policy → `CREATE TRIGGER <table>_updated_at BEFORE UPDATE … EXECUTE FUNCTION update_updated_at()` → `COMMIT;` + a commented rollback block.

**Canonical policy pair** (`20260602235644_rls_with_check.sql:17-21`) — both clauses are mandatory per `lessons.md:45-55`:

```sql
CREATE POLICY "Users own their goals" ON goals
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**`asset_categories` is TEXT-keyed, global, and seeded — not user-scoped.**

```sql
CREATE TABLE asset_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
  is_liability BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);                                          -- 20260529190856_initial_schema.sql:17-25
```

So `goals.category_id` must be **`TEXT`**, not UUID. RLS is never enabled on it. 13 rows seeded in `supabase/seed.sql:6-19` (`checking_account`, `savings_account`, …, `loans_credit` is the only `is_liability`). `assets.category_id` FKs it with **no `ON DELETE` clause** (i.e. `NO ACTION`) — the roadmap's `ON DELETE SET NULL` recommendation diverges from that precedent; see Open Question 3.

Caveat: `seed.sql` runs on `db reset`/`start`, **not** on `supabase migration up` — a prod DB populated only by migrations could have an empty `asset_categories` (`context/archive/2026-06-20-data-backup-import-export/research.md:71`).

**No Postgres enums exist.** `Database.public.Enums` is `Record<never, never>` (`database.types.ts:416`); `grep "CREATE TYPE"` over migrations returns nothing. The universal idiom is `TEXT` + inline `CHECK`:

```sql
source TEXT NOT NULL CHECK (source IN ('manual', 'auto')),                  -- initial_schema.sql:48
currency TEXT NOT NULL CHECK (currency IN ('PLN', 'USD', 'EUR')),           -- initial_schema.sql:34
```

So `kind TEXT NOT NULL CHECK (kind IN ('net_worth', 'category'))`. **CHECK constraints do not surface as TS unions** — the generator types them as plain `string`, and the app re-narrows with a hand-written union + cast.

Money columns are `NUMERIC(18,2)` — asset-balancer impl-review F4 flagged storage-precision drift when a column was narrower than the input accepted, so `target_amount NUMERIC(18,2)` with matching validation.

**`src/lib/database.types.ts` is nominally generated, in practice hand-edited.** There is no type-gen script in `package.json`; `CLAUDE.md:20` and `README.md:122` claim `npx astro sync` generates them, which is inaccurate (`astro sync` doesn't touch this file). The real command recorded in prior research is `npx supabase gen types typescript --local > src/lib/database.types.ts`. Every precedent commit adds the lines by hand. CI runs `astro sync → typecheck`, so a stale file fails the build. Tables are alphabetical — `goals` sorts between `exchange_rate_cache` and `metal_price_cache`. `Relationships` is populated for non-`auth` FKs only, so a `goals` block needs exactly one entry for `goals_category_id_fkey → asset_categories.id`.

Unrelated but noted: `supabase/config.toml` is dirty with a one-line `project_id = "10x-astro-starter"` → `"bitworth"` rename. Harmless, but it renames the local Docker namespace, so the next `supabase start` after it lands spins up a fresh empty stack.

### 8. Testing conventions

Runner: `vitest.config.ts:28-34`, `include: ["src/**/*.test.{ts,tsx}"]`, `environment: "node"`, `plugins: [tsconfigPaths(), astroEnvServerStub()]`. **No coverage tooling and no thresholds exist** — don't promise a coverage number. DOM tests opt in per-file with `// @vitest-environment happy-dom`.

CI (`.github/workflows/ci.yml`): `npm ci` → `astro sync` → `typecheck` → `lint` → `test:ci` → playwright install → `test:e2e` (both gated on `SUPABASE_URL != ''`) → `build`. **CI e2e runs against remote Supabase.** Pre-commit is lint-staged only; no test hook.

**Pure-lib unit tests** (13 files in `src/lib/`). Conventions a `goals.test.ts` must follow:

- One `describe` per exported function, named exactly as the export; `it` titles are full behavioural sentences.
- Every file opens with a comment block stating the oracle policy. Oracles are computed from first principles, **never by reading the implementation**.
- Individual `it`s, not `it.each` (which appears only 3× repo-wide, all for homogeneous enumerations).
- Local override-based builders at the top: `function inputs(overrides: Partial<T> = {}): T`.
- `unwrap<T>(v: T | null): T` helper because non-null assertions are eslint-forbidden (`trajectory.test.ts:7-10`).
- Alias imports `@/lib/x` with `import type` split out. (The `lessons.md:37` note quoting a relative import is stale.)
- **FP discipline**: `toBe` only for provably-exact integers; `toBeCloseTo(_, 6)` — always precision 6 — for anything involving division, growth, log/exp. Expected values written as expressions, not literals.
- **Every money/percent module ships a "333.33-class FP probe"** guarding ×100/÷100 scaling regressions (`trajectory.test.ts:70,232`, `fire.test.ts:183-188`). A `goals.ts` is squarely in this class.

**API tests** are co-located as `<handler-dir>/index.test.ts`. Boilerplate is `vi.hoisted` + `vi.mock("@/lib/supabase")` + import-after-mock (`snapshots/index.test.ts:17-30`). The shared mock is `src/test-utils/supabase-mock.ts` (`createSupabaseMock`, `createCookiesStub`, `findCall`). Handlers are invoked directly with a hand-built context cast `as never`; there is no APIContext helper. Assertions cover status, error `code`, the tenant filter (`findCall(m.recorded, "eq", ["user_id", userA])`), filter *ordering* on `[id]` routes, and structural payload pins (`expect(payload).not.toHaveProperty("user_id")`).

Note the `asClient` cast helper is **not** in the shared module — it's duplicated in the three `src/lib/` tests whose SUT takes a real `SupabaseClient`. API-route tests don't need it.

**`src/pages/api/api-auth-contract.test.ts:29-70` auto-generates a test for every file under `src/pages/api/`**, asserting the source contains `supabase.auth.getUser()` or a commented public-route justification. A new `/api/goals/*` route is covered with no authoring — but **fails CI until the auth check is present**.

Gap worth closing: `allocation-cards` and `allocation-targets` — the newest CRUD surface and the closest analogue — have **no per-handler tests**, only the contract walk. Goals is the chance not to repeat that.

**E2E** (`e2e/`): role/label/text locators only, zero `getByTestId`, zero `waitForTimeout`. Auth is a per-test API helper creating a throwaway user (`e2e/helpers/auth.ts:1-17`) — no storageState, no global setup. Isolation is by fresh user, not teardown.

The DB-seeding skip guard, verbatim (`e2e/trajectory-verify.spec.ts:19-34`, applied at `:86-87`):

```ts
const DB_CONTAINER = "supabase_db_bitworth";
function hasLocalDb(): boolean {
  try { execFileSync("docker", ["inspect", DB_CONTAINER], { stdio: "ignore" }); return true; }
  catch { return false; }
}
// …
test.skip(!hasLocalDb(), "requires the local Supabase container (npx supabase start)");
```

Two hydration traps recorded in S-20's closeout (`plan.md:318-327`) that apply to any new `client:load` island with inputs: (a) if the island hydrates *after* a `fill()`, React initialises its value tracker to the DOM text, so re-filling the same string never fires `onChange` — blank the field between attempts and wrap in `expect(async () => …).toPass()`; (b) Recharts writes the final path `d` immediately and animates visible length via `stroke-dasharray`, so a DOM-timed screenshot shows a convincing fake gap.

`context/foundation/test-plan.md` has all 5 rollout phases complete and **no risk-map row naming goals**. A goals feature introduces no new risk class — it lands inside existing risks #1 (money-math correctness), #2 (cross-tenant leak), #5 (route auth). The cheaper move is a new §6.x cookbook subsection, not a `--refresh`.

---

## Code References

- `src/lib/trajectory.ts:168-181` — `etaToTarget`, returns days or null; the five null branches
- `src/components/NetWorthChart.tsx:128-182` — snapshot rows → samples → ETA → Date, the recipe to copy
- `src/lib/net-worth.ts:18-27` — `convertAmount`, units-per-USD, no missing-rate guard
- `src/lib/exchange-rates.ts:83-85` — silent `STATIC_RATES` fallback, no staleness signal to callers
- `src/lib/allocation.ts:288-310` — `totalAssetPool` / `assetSharePct`, closest to a category subtotal but per-asset
- `src/lib/asset-trends.ts:36-39,55-64` — re-convert at today's rates; the Map-grouping template
- `src/components/fire/FireProgress.tsx:30-45,50-53,68-80,97-104` — placeholder, clamp, progress bar, Metric row
- `src/components/balancer/DriftAlerts.tsx:17-24,100` — exported props interface + card shell
- `src/pages/dashboard.astro:72-81,84-156,166-225,249-250` — prefs query, null-object gating blocks, render
- `src/pages/api/user-preferences/index.ts:13-18,155-161,191-196,208-213` — PREFS_SELECT, updates type, validation branch, upsert
- `src/components/settings/SettingsForm.tsx:196-215` — checkbox block template
- `src/pages/api/allocation-cards/index.ts:5-19,69-85` — `jsonError`/`jsonOk`, JSON validation template
- `src/pages/api/allocation-cards/[id].ts:33-36,56-57` — `UUID_RE`, ownership-belt comment
- `src/components/Topbar.astro:16-51` / `src/components/TopbarMenu.tsx:46-81` — the two nav files
- `src/middleware.ts:4,18-39` — `PROTECTED_ROUTES`, `Astro.locals.displayCurrency`
- `supabase/migrations/20260624120000_allocation_targets.sql:22-42` — new-table template
- `supabase/migrations/20260602235644_rls_with_check.sql:17-21` — canonical USING + WITH CHECK
- `supabase/migrations/20260529190856_initial_schema.sql:17-25,31,110-118` — `asset_categories`, FK, `update_updated_at` trigger
- `supabase/migrations/20260724120000_restore_backup_show_trajectory.sql:66,85,103` — the three RPC edit sites
- `src/lib/backup.ts:44,228` — `USER_PREFERENCES_COLUMNS`, the hardcoded table list
- `src/lib/backup-rpc-parity.test.ts:22-27,75` — the parity gate
- `src/pages/api/api-auth-contract.test.ts:29-70` — auto-covers any new API route
- `e2e/trajectory-verify.spec.ts:19-34,86-87` — the local-DB skip guard
- `src/test-utils/supabase-mock.ts` — `createSupabaseMock`, `createCookiesStub`, `findCall`

## Architecture Insights

- **Server computes, islands present.** Dashboard cards do all math in `.astro` frontmatter and pass flat props; the island holds no state and does no fetching. Established deliberately for the FIRE card and reaffirmed since.
- **Null-object gating.** The idiom is `let xCard: Props | null = null; if (showX) { …compute… xCard = {…} }` then `{xCard && <X {...xCard} client:load />}`. Whether the object stays null when there's nothing to show is the alert-vs-status distinction: drift disappears, FIRE renders a placeholder. Goals follows FIRE.
- **Convert at today's rates, always.** Historical rows keep their own `display_currency`; features re-convert `original_amount` rather than reading stored converted values, so switching display currency never fabricates movement. Mixing is *surfaced* (the amber banner) rather than silently reconciled.
- **Round only at the view edge.** Every pure lib says so in its header; formatters are local per component and there is no shared formatter module — deliberately.
- **No shared UI primitives, on purpose.** The drift restyle explicitly declined to extract a generic `Card`/`ProgressBar` (`dashbord-drift-restyle/plan.md:43`). Conventions are copied idioms, not imports.
- **Two defense layers on ownership**, always: RLS `USING` + `WITH CHECK` *and* a handler-side `.eq("user_id", user.id)`.
- **Percentages live on a 0-100 scale end-to-end**, no ×100/÷100 at the DB boundary. `EPSILON = 1e-2` (`allocation.ts:22`) is canonical — reuse it.

## Historical Context (from prior changes)

- `context/archive/2026-07-19-net-worth-trajectory/plan.md:32` — S-20 explicitly deferred this slice: *"**No persisted target and no named goals** — the target input is ephemeral. Persisted, named savings goals with progress cards are S-21, which reuses this slice's `etaToTarget`."* `plan-brief.md:60`: *"`etaToTarget` is a clean, tested helper ready for S-21 to reuse."*
- `context/archive/2026-07-19-net-worth-trajectory/plan.md:50` — never fit across a currency change; ≥2 *comparable* snapshots.
- `context/archive/2026-06-23-fire-dashboard/reviews/impl-review.md:25-37` (F1) — the `fireNumber = 0` → `Infinity`/`NaN` leak into `aria-valuenow`. Fixed with a tightened SSR guard **plus** a view-edge clamp. A goal with `target_amount = 0` reproduces it exactly.
- `context/archive/2026-06-23-fire-dashboard/reviews/impl-review.md:39-47` (F2) — `backup.ts` touchpoint missed by the plan.
- `context/archive/2026-07-11-allocation-drift-alerts/plan.md:14,41` — names `backup.ts` as the roadmap's omitted touchpoint; establishes alert-vs-status card semantics.
- `context/archive/2026-07-12-dashbord-drift-restyle/plan.md:20-25,43` — codified the card shell, bar idiom, Metric row, Lucide sizing, `cn()`, and the decision *not* to extract shared primitives. Also `:24`: use one severity accent, not a green/red good/bad split.
- `context/archive/2026-06-24-asset-balancer/reviews/impl-review.md:33-41` (F2) — the nav lesson as lived: the plan named only `TopbarMenu.tsx` and shipped a desktop-unreachable link. Now `lessons.md:91-99`.
- `context/archive/2026-06-28-contributions-vs-growth/plan.md:55,57` — FX-timing caveat and the "never coerce NULL to 0" discriminated-result rule. The direct analogue for a goal with no computable ETA: render a discriminated state, never a fabricated date.
- `context/archive/2026-06-03-user-settings/plan.md:307-309` — why `display_currency` is read once in middleware and published on `Astro.locals` instead of per-page queries.
- Commit `a1604bc` — the `restore_backup` RPC gap, *"shipped three times now."*
- Commit `2da7ef4` — repo status vocabulary is `preparing → implementing → implemented → archived`; "complete" was a one-off slip.

**Plan-shape convention** observed across S-14/S-15/S-17/S-18/S-20: Overview → Current State Analysis (every bullet with `file:line`) → Key Discoveries → Desired End State → What We're NOT Doing → Implementation Approach (always bottom-up) → Critical Implementation Details → `## Phase N` × N (each with File/Intent/Contract triplets, Automated + Manual success criteria, and a pause-for-confirmation note) → Testing Strategy → Performance → Migration Notes → References → Progress. Typically 220-450 lines, 2-6 phases. Commit convention: `feat(<change-id>): <phase title> (p<N>)` per phase.

## Related Research

- `context/archive/2026-06-24-asset-balancer/research.md` — nav insertion points, `Astro.locals` conventions, no-Zod rule, chart color tokens
- `context/archive/2026-06-20-data-backup-import-export/research.md:71` — `seed.sql` does not run on `migration up`
- `context/archive/2026-06-19-per-asset-trends/research.md:102` — the real `database.types.ts` generation command
- `context/foundation/test-plan.md` §6.1-6.7 — the per-layer test cookbook
- `context/foundation/lessons.md` — §Currency cast boundary, §RLS USING-only, §Nav items live in two files, §DB multi-table writes

---

## Open Questions

These are the decisions `/eon-plan` must make. The first is the significant one.

**1. Can a *category* goal have an ETA in v1 — and if so, who builds the per-category history?**

The roadmap treats net-worth goals and category goals as symmetric. They are not:

- A net-worth goal's ETA is nearly free — `snapshots.total_net_worth` is already a time series, and `NetWorthChart.tsx:128-182` shows the exact transformation.
- A category goal's ETA needs a per-category series aggregated from `snapshot_items` per snapshot. **That aggregation does not exist**, and it is the core of a *different* roadmap slice (S-23, `roadmap.md:74`).

Three ways out, in rough order of my preference:

- **(a) Category goals ship with progress only, no ETA in v1.** The card shows the bar and current/target; the ETA row is hidden (the codebase already prefers hiding a row to showing "N/A" — `FireProgress.tsx:83,86`). Keeps the slice at its intended size and leaves S-23 to unlock category ETAs later.
- **(b) Build the per-category series inside `goals.ts`.** Honest scope increase — a new aggregation, its own oracle tests, and the "re-convert at today's rates" discipline. Effectively pulls part of S-23 forward.
- **(c) v1 is net-worth goals only**, `kind` enum still added so category goals are a later additive change. Smallest, but drops half the stated outcome.

**2. What is `target_date` actually for?** The roadmap lists it as an optional column but never assigns it a behaviour — the ETA comes from the trend, not from the user's date. Candidates: purely decorative; an on-track/behind comparison against the trend ETA; or a required-rate ("you'd need €X/month to hit this by then"). Option 2 is the most useful and cheapest, but it needs a copy decision and its own null branch. Left unspecified, this column will get built and do nothing.

**3. `ON DELETE SET NULL` on `goals.category_id` contradicts a `kind`/`category_id` consistency CHECK.** The natural integrity constraint is:

```sql
CHECK ((kind = 'category' AND category_id IS NOT NULL) OR (kind = 'net_worth' AND category_id IS NULL))
```

…but with `ON DELETE SET NULL`, deleting a category would set `category_id` to NULL and **violate that CHECK**, making the delete fail — so the FK behaves as RESTRICT anyway, and the roadmap's "category removed" goal state is unreachable. Also note `assets.category_id` uses **no** `ON DELETE` clause at all. Pick one: drop the strict CHECK and validate `kind`/`category_id` coherence in the handler (enabling a genuine "category removed" state), or keep the CHECK and match the `assets` precedent (no ON DELETE clause) — defensible since `asset_categories` is seeded and immutable, so this never fires in practice.

**4. Does the `goals` table itself belong in backup/export?** Distinct from the `show_goals` preference. Including it means a third migration recreating `restore_backup` with a new table, matching whitelists in `backup.ts:228`, and a `backup-rpc-parity.test.ts` entry. Excluding it means users lose their goals on restore — and the parity test's allow-list needs an explicit intentional-omission entry (`backup-rpc-parity.test.ts:22-27`). Either is fine; silence is not.

**5. How many goals render on the dashboard card, and in what order?** `DriftAlerts` truncates to top 3 (`DriftAlerts.tsx:96`). Goals needs an equivalent rule (all? top N by progress? by nearest ETA?) plus a "+N more" affordance, or the card grows unbounded.

**6. Validation bounds for `target_amount`.** `> 0` is required to avoid the FIRE F1 `Infinity`/`NaN` class of bug at `current / target`. Also needs a `NAME_MAX`-style cap (allocation cards use 60) and a decision on whether a target *below* the current value is allowed (it's immediately 100% complete and its ETA is `null`).

**7. CRUD generation and page shape.** Confirm the recommendation: model on `allocation-cards` (single page, JSON API, `jsonError`/`jsonOk`, local-state refresh, `UUID_RE`) rather than assets (three routes, FormData, reload). Related: `target_date` would introduce the repo's first `<input type="date">`, and there is no dialog primitive — create/edit is either an inline form or a native `<dialog>`.

**8. Users who switched display currency will often see no ETA at all.** The fit runs only over same-currency snapshots, so a recent switch can leave <2 comparable snapshots. S-20 accepted this (*"Acceptable for v1"* — `plan-brief.md:52-53`); worth confirming the goals card carries the same honest empty state rather than silently showing a bar with no ETA and no explanation.
