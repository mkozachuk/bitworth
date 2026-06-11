---
date: 2026-06-11T11:45:29+0200
researcher: maksymkozachuk
git_commit: 57399bc267fd3073e56578100a69f1cbfb1f33ab
branch: master
repository: bitworth
topic: "FIRE calculator (S-09) — integration points for projection from current net worth"
tags: [research, codebase, fire-calculator, net-worth, recharts, user-preferences, vitest]
status: complete
last_updated: 2026-06-11
last_updated_by: maksymkozachuk
---

# Research: FIRE calculator (S-09) — integration points for projection from current net worth

**Date**: 2026-06-11T11:45:29+0200
**Researcher**: maksymkozachuk
**Git Commit**: 57399bc267fd3073e56578100a69f1cbfb1f33ab
**Branch**: master
**Repository**: bitworth

## Research Question

For roadmap slice **S-09 (`fire-calculator`)**: map the existing codebase systems the FIRE calculator must build on, so `/10x-plan` can design the feature without re-discovery. The calculator takes **current net worth as the projection starting principal**, projects years-to-FI and a FIRE number from target annual expenses, safe withdrawal rate (default 4%), expected return, and contributions, and renders a projection chart in the user's display currency. Four focus areas: (1) net worth as starting principal, (2) charting reuse from S-02, (3) persistence + display currency from S-05, (4) test patterns for the pure projection math.

## Summary

Every dependency S-09 needs already exists and is reusable with no new libraries:

- **Starting principal** — `computeNetWorth(assets, displayCurrency, rates)` in `src/lib/net-worth.ts:40` returns the net worth as a single `number` in the display currency. It is currently *unused by production code* (both live sites re-implement the loop inline); S-09 can be its first real caller. Rates come from `getRates(supabase)` (`src/lib/exchange-rates.ts:46`), always returning a full USD-relative `Record<Currency, number>` over the three supported currencies (`PLN | USD | EUR`).
- **Charting** — Recharts `^3.8.1` (`package.json:39`), already used by the only chart in the app, `src/components/NetWorthChart.tsx`. It already imports `ReferenceLine` (used for a "Start" marker) — exactly the primitive for a FIRE-number target line. Reuse the component's `ResponsiveContainer` + CSS-variable color + inline `toLocaleString` conventions.
- **Persistence + currency** — `user_preferences` (1:1 with `auth.users`, auto-created by a trigger, RLS already `USING` + `WITH CHECK`). Adding **4 numeric columns** to this table is the lowest-friction persistence path and inherits all existing RLS/triggers. Display currency is resolved once in `src/middleware.ts:18-33` into `Astro.locals.displayCurrency`; the FIRE page reads it the same way pages do today.
- **Test patterns** — Vitest with `vite-tsconfig-paths` (so the `@/` alias resolves). House style: one `describe` per function, explicit `it()` cases, `toBeCloseTo(expected, 6)` for any division/exponentiation result, oracle values computed from first principles in inline comments. No `it.each` exists yet — introducing it for table-driven FIRE tests is compatible. The function must be pure (no Supabase).

The roadmap risk note (`roadmap.md:210`) — isolate the math into a pure, unit-tested `src/lib/fire.ts` *before any UI* — is directly supported by the existing test infrastructure.

## Detailed Findings

### Area 1 — Net worth as the starting principal

**`src/lib/net-worth.ts`** (the reuse target)
- `Currency` re-exported from exchange-rates (`net-worth.ts:1,3`).
- `NetWorthAsset` interface (`net-worth.ts:5-9`): `{ amount: number; currency: Currency; category: { is_liability: boolean } }`.
- `convertAmount(amount, fromCurrency, toCurrency, rates)` (`net-worth.ts:18-27`): identity when `from === to`; otherwise `amount / rates[from] * rates[to]`. Rates are **USD-relative** (`rates[USD] = 1.0`, `rates[X]` = units of X per 1 USD). The `fromCurrency: Currency` param is the deliberate narrowing boundary documented in `lessons.md:25-33` ("Currency cast boundary") — DB rows are `string`, so call sites cast `as Currency`. Do not widen.
- `computeNetWorth(assets, displayCurrency, rates)` (`net-worth.ts:40-56`): returns a single `number` = assets − liabilities, converting each asset to `displayCurrency` and bucketing by `category.is_liability`. **Return type is just `number`, not a breakdown** (`net-worth.ts:32-38` TODO notes callers needing the breakdown re-implement the loop).

**`src/lib/exchange-rates.ts`**
- `Currency = "PLN" | "USD" | "EUR"` (`exchange-rates.ts:3`) — exactly three currencies.
- `STATIC_RATES` fallback (`exchange-rates.ts:5-9`): `USD 1.0, EUR 0.92, PLN 3.85`.
- `getRates(supabase): Promise<Record<Currency, number>>` (`exchange-rates.ts:46-86`): reads `exchange_rate_cache` (TTL 3600s), on miss fetches `https://api.frankfurter.app/latest?from=EUR`, upserts, and on any error returns `{...STATIC_RATES}`. **Always returns a full record keyed by all three currencies** — safe to index directly.

**Live data flow (assets → net worth number)** — two sites, both re-implementing the loop rather than calling `computeNetWorth`:
- **Dashboard render**: `src/pages/dashboard.astro:13-53` gets `user` from `Astro.locals.user`, `displayCurrency` from `Astro.locals.displayCurrency ?? "USD"` (`:20`), fetches `assets` joined with `category:asset_categories(*)` (`:22`), `rates = await getRates(supabase)` (`:24`). `src/components/assets/NetWorthDisplay.tsx:137-149` re-implements the loop inline, casting `asset.currency as Currency` (`:141`).
- **Snapshot POST**: `src/pages/api/snapshots/index.ts:47-168` auths, fetches assets, reads `display_currency` from `user_preferences` (`:80-90`, validates against `["USD","EUR","PLN"]`, defaults `"USD"`), `getRates` (`:95`), re-implements the loop (`:97-107`).

**`assets` table** (`src/lib/database.types.ts:50-99`): `amount: number`, `currency: string` (`:56` — cast `as Currency`), FK `category_id` → `asset_categories.id`; `asset_categories.is_liability: boolean` (`:29`) is the liability flag, joined as `category:asset_categories(*)`.

**Display currency at compute time**: originates in `user_preferences`; pre-resolved in `src/middleware.ts:20-33` into `context.locals.displayCurrency` (typed `"USD" | "EUR" | "PLN" | null` at `src/env.d.ts:5`); SSR pages read `Astro.locals.displayCurrency ?? "USD"`; API routes re-fetch it directly.

**Money/rounding**: floats throughout — `amount` is plain SQL numeric, no cent-scaling. No rounding at compute time. Formatting only at the view layer via `Number.prototype.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })` (e.g. `NetWorthDisplay.tsx:197,209,220`), with the currency code shown as a separate label (not `style: "currency"`).

**Seed pattern for an SSR `/fire` page:**
```ts
const supabase = createClient(Astro.request.headers, Astro.cookies);
const displayCurrency: Currency = Astro.locals.displayCurrency ?? "USD";
const { data: assets } = await supabase
  .from("assets").select("*, category:asset_categories(*)").eq("user_id", user.id);
const rates = await getRates(supabase);
const startingPrincipal = computeNetWorth(
  (assets ?? []).map(a => ({
    amount: a.amount,
    currency: a.currency as Currency,
    category: { is_liability: a.category.is_liability },
  })),
  displayCurrency, rates,
);
```
Prefer calling `computeNetWorth` (its first production caller) over a third inline loop. Keep the principal as an unrounded float; format only for display.

### Area 2 — Charting reuse (S-02)

- **Library**: Recharts `^3.8.1` (`package.json:39`). No other chart libs present. Reuse it.
- **Existing component**: `src/components/NetWorthChart.tsx` (the only chart). Imports `LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine` (`:1`). **`ReferenceLine` is already in use** for a "Start" marker (`:137-140`) — the primitive for a FIRE-number target line.
- **Props** (`:15-19`): `{ snapshots: SnapshotRow[]; displayCurrency: Currency; onSaveSnapshot?: () => void }`. It does **not** take chart points as props — it maps raw DB `snapshots` rows internally into `SnapshotPoint { date, netWorth, displayCurrency }` (`:9-13, 53-61`), feeding `LineChart` with `dataKey="date"` (X) and a `Line` with `dataKey="netWorth"` (Y).
- **Styling**: Tailwind v4 card `mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 dark:...` (`:103`). Responsive + fixed height via `<ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>` (`:118`) — the `initialDimension` matters for island hydration before measuring; reuse it. Colors are **CSS variables** passed to SVG props: line `var(--chart-1)` (`:136`), reference line `var(--chart-2)` (`:140`), grid `var(--border)`, ticks `var(--muted-foreground)`. `--chart-1..--chart-5` are defined for light/dark in `src/styles/global.css`. Use `--chart-3`/`--chart-4` for the FIRE target line to distinguish it.
- **Currency/date formatting**: inline, no helper. Y-axis tick `v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })` (`:128-133`); X-axis tick `new Date(v).toLocaleDateString("en-US", { month: "short" })` (`:124`); `CustomTooltip` (`:21-50`) appends the currency code and uses 2-fraction `toLocaleString`.
- **Astro mounting**: imported `dashboard.astro:7`, rendered `:60-67` with `client:load`; props serialized server-side (`snapshots={snapshots as Tables<"snapshots">[]}`, `displayCurrency={displayCurrency}`); callbacks are inline arrows doing `window.location.reload()`.
- **No shared formatting helpers exist** — `src/lib/utils.ts` only exports `cn()`. Inline `toLocaleString` is the house convention (duplicated across NetWorthChart, NetWorthDisplay, AssetsSummary, AssetRow, AssetCard, AssetForm). A shared `formatCurrency` would be a net improvement but is not the established pattern — flag as an optional cleanup, not a requirement.
- **Empty state**: `NetWorthChart.tsx:82-96` returns a separate "No snapshots yet" card when `snapshots.length === 0` (Recharts never renders with empty data). A single point renders fine (`dot={false}` makes a 1-point line invisible but not an error). The e2e `e2e/empty-snapshot.spec.ts` tests the save-snapshot API flow, not the chart's empty render.

**Recommendation**: new `src/components/fire/FireProjectionChart.tsx` mirroring `NetWorthChart` — same imports, same `ResponsiveContainer`, X = year, Y = projected net worth, a `ReferenceLine` at the FIRE number (`var(--chart-3/4)`), reuse the `CustomTooltip` shape. Mount with `client:load`, passing server-computed projection data.

### Area 3 — Persistence + display currency (S-05)

**`user_preferences` table** — `supabase/migrations/20260529190856_initial_schema.sql:9-15`:
```sql
CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_currency TEXT NOT NULL DEFAULT 'USD' CHECK (display_currency IN ('PLN','USD','EUR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
- 1:1 with `auth.users`. `theme` column added later (`20260603120000_user_preferences_theme.sql:6-8`) — the canonical precedent for adding a setting.
- **Auto-row creation**: `SECURITY DEFINER` trigger `on_auth_user_created()` (`initial_schema.sql:121-131`) inserts a row per signup (fixed `search_path` in `20260603130000_...`, per `lessons.md:81-89`). **Every authed user already has a row**, so new columns must be `NOT NULL DEFAULT <x>` to backfill, or nullable.
- **`updated_at` trigger** `user_prefs_updated_at` BEFORE UPDATE (`initial_schema.sql:117-118`).
- **RLS** — fixed to USING + WITH CHECK in `20260602235644_rls_with_check.sql:11-15` (`FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`). Per `lessons.md:45-55`, a **new column on `user_preferences` inherits this correct policy**; a *separate* `fire_settings` table would need its own policy with **both** clauses.

**Display currency write/read**:
- Write: `PUT /api/user-preferences` (`src/pages/api/user-preferences/index.ts:55-143`); `SettingsForm.tsx:44-48` sends a partial `{ display_currency?, theme? }` then `window.location.reload()`.
- Read: middleware (`src/middleware.ts:18-33`) is the source of truth → `Astro.locals.displayCurrency` (typed `src/env.d.ts:1-7`). Pages read `Astro.locals.displayCurrency ?? "USD"` (`dashboard.astro:20`, `dashboard/assets/index.astro:19`).

**Settings API handler** (`src/pages/api/user-preferences/index.ts`, read fully) — the template for a FIRE settings handler:
- Auth: `createClient(request.headers, cookies)` → null-guard → `supabase.auth.getUser()` → 401 `{ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }`.
- **Validation is NOT Zod** here — manual allow-lists (`VALID_CURRENCIES`, `VALID_THEMES` as `as const`, `:8-11`), `typeof !== "string" || !ARRAY.includes(...)`. (Asset handlers *do* use Zod — `src/pages/api/assets/index.ts` — if preferred for the numeric range checks.)
- Error shape matches the CLAUDE.md hard rule: `{ error: { code, message, context? } }` via local `ErrorShape` + `satisfies` (`:4-6`). Codes: `UNAUTHORIZED` 401, `VALIDATION_ERROR` 400, `FETCH_FAILED`/`UPDATE_FAILED` 500, `NOT_FOUND` 404.
- Persistence: `.upsert({ user_id, ...updates }, { onConflict: "user_id" }).eq("user_id", user.id).select(...).single()` (`:128-133`). Tests at `index.test.ts`.

**Type generation**: `src/lib/database.types.ts`; `Tables<'user_preferences'>` Row/Insert/Update at `:235-258` (`display_currency`/`theme` typed as plain `string` — CHECK constraints are not reflected as TS unions, hence pages re-narrow). Regenerate via Supabase CLI `gen types` (surfaced as `npx astro sync` per project convention; **no npm script**). CI runs `astro sync → typecheck`, so a stale type file fails CI. The Supabase client (`src/lib/supabase.ts`) is *not* parametrized with `<Database>`, so results are cast-and-narrowed.

**Middleware / protected route**: `PROTECTED_ROUTES = ["/dashboard"]` (`src/middleware.ts:4`), prefix match (`:35`). Currency/theme locals are set for **all** authed requests regardless of route. **Placing the page at `src/pages/dashboard/fire.astro` makes it auto-protected** (consistent with `settings.astro`, `assets/index.astro`) — no middleware edit. Add the page-level guard `if (!user) return Astro.redirect("/auth/signin")` (belt-and-suspenders, as `dashboard.astro:13-17`).

**Persistence recommendation (4 numeric fields)**: add columns to `user_preferences` — inherits RLS, auto-create, and `updated_at` triggers for free:
```sql
ALTER TABLE user_preferences
  ADD COLUMN fire_target_annual_expenses NUMERIC(18,2),            -- nullable until set
  ADD COLUMN fire_safe_withdrawal_rate   NUMERIC(5,4) NOT NULL DEFAULT 0.04,
  ADD COLUMN fire_expected_return        NUMERIC(5,4),
  ADD COLUMN fire_annual_contribution    NUMERIC(18,2);
```
`NUMERIC(18,2)` is the project money convention (`assets.amount`, `initial_schema.sql:33`). Then extend the existing `PUT /api/user-preferences` with the new fields (add 0–1 range checks for SWR/return), and widen the three `select(...)` projections (handler, settings page, middleware). A separate `fire_settings` table is only worth it for multiple FIRE scenarios per user — out of scope for v1's single-scenario design.

### Area 4 — Test patterns for the pure FIRE math

- **`vitest.config.ts`** (full): `plugins: [tsconfigPaths()]` (`:5`) is what resolves the `@/` alias (per `lessons.md:35-43`); `include: ["src/**/*.test.{ts,tsx}"]` (`:7`) so `src/lib/fire.test.ts` is auto-discovered; `environment: "node"` (`:8`). No `setupFiles`, no coverage config, no setup file in the repo. (DOM tests use `happy-dom` per-file; a pure function stays on `node`.)
- **House conventions** (canonical reference `src/lib/net-worth.test.ts`, full): `import { describe, expect, it } from "vitest"` — **globals are NOT enabled**, every file imports explicitly. Imports use the **`@/` alias** (`@/lib/net-worth`), not relative — note this *corrects* the MEMORY note `feedback_*`/`project_*` that said net-worth uses relative imports; current code uses `@/`. Single top-level `describe` named for the function under test; multiple behavioral `it()` cases. **Oracle discipline**: expected values computed from first principles in inline comments (e.g. `// 1000 USD ... = 1700` then `expect(...).toBe(1700)`).
- **Table-driven**: no `it.each`/`describe.each`/`test.each` exists anywhere in the repo (grep = 0). "Table-driven" today = a sequence of explicit `it()` rows. For S-09 you may introduce `it.each([...])` (Vitest supports it; new but compatible) or follow one-`it`-per-scenario house style — either satisfies the roadmap's table-driven requirement.
- **package.json scripts**: `test` = `vitest` (watch), `test:run` = `vitest run`, `test:ci` = `npm run test:run`, `test:e2e` = `playwright test`, `typecheck` = `tsc --noEmit`. No coverage script. Unit (`vitest` over `src/**/*.test.{ts,tsx}`) and e2e (`playwright` over `./e2e`) are fully distinct.
- **Money / FP assertions** (critical for compound growth): exact integer results → `toBe` (`net-worth.test.ts:29,57,58`); division/exponentiation results → `toBeCloseTo(expected, 6)` (`net-worth.test.ts:41` `toBeCloseTo(9154.545454545454, 6)`; `exchange-rates.test.ts:82` `toBeCloseTo(1/0.92, 6)`). The function returns raw floats — no pre-rounding helper. A deliberate FP probe (`333.33`-class values) guards ×100/÷100 bugs (`net-worth.test.ts:10-12`).
- **Supabase mock** (`src/test-utils/supabase-mock.ts` → `createSupabaseMock`, with per-file `asClient` cast helper per `lessons.md` / MEMORY `project_tsc_blocker_phase4`): **not needed** — keep `fire.ts` pure so `fire.test.ts` imports none of it.
- **TypeScript/CI**: strict via `tsconfig.json` (`extends astro/tsconfigs/strict`, `paths { "@/*": ["./src/*"] }`). CI (`.github/workflows/ci.yml`, Node 22): `npm ci → astro sync → typecheck → lint → test:ci → (conditional) test:e2e → build`. The e2e step is gated by `if: env.SUPABASE_URL != ''` (per recent commit `503b066`). A new pure-function test is enforced unconditionally by `test:ci`.

**Test recommendation**: source `src/lib/fire.ts`, tests `src/lib/fire.test.ts`; `import { describe, expect, it } from "vitest"`; import SUT via `@/lib/fire`; one `describe` per exported function; `toBeCloseTo(expected, 6)` for compound-growth/division values, `toBe` for provably-exact integers; closed-form oracle in inline comments. No setup file, no mock, no coverage config.

## Code References

- `src/lib/net-worth.ts:40-56` — `computeNetWorth(assets, displayCurrency, rates): number` (starting principal; currently unused in prod)
- `src/lib/net-worth.ts:18-27` — `convertAmount`, USD-relative rate math; narrowing boundary
- `src/lib/exchange-rates.ts:3` — `Currency = "PLN" | "USD" | "EUR"`
- `src/lib/exchange-rates.ts:46-86` — `getRates(supabase)` → full `Record<Currency, number>`, frankfurter.app + static fallback
- `src/pages/dashboard.astro:13-67` — SSR data flow + island mounting pattern to mirror
- `src/components/assets/NetWorthDisplay.tsx:137-149` — inline net-worth loop (don't add a third)
- `src/pages/api/snapshots/index.ts:80-107` — API-route display-currency fetch + inline loop
- `src/components/NetWorthChart.tsx:1,15-19,82-96,103,118-140` — Recharts component to clone (props, empty state, ReferenceLine, ResponsiveContainer, CSS-var colors)
- `package.json:39` — `recharts@^3.8.1`
- `src/styles/global.css` — `--chart-1..--chart-5`, light/dark
- `supabase/migrations/20260529190856_initial_schema.sql:9-15,117-131` — `user_preferences`, triggers
- `supabase/migrations/20260603120000_user_preferences_theme.sql:6-8` — add-a-setting precedent
- `supabase/migrations/20260602235644_rls_with_check.sql:11-15` — USING + WITH CHECK policy
- `src/pages/api/user-preferences/index.ts:4-6,8-11,55-143` — settings handler template (auth, manual validation, error shape, upsert)
- `src/components/settings/SettingsForm.tsx:39-57` — partial-diff PUT + reload
- `src/pages/dashboard/settings.astro:14-46` — settings page guard + island props
- `src/middleware.ts:4,18-39` — PROTECTED_ROUTES, display-currency locals
- `src/env.d.ts:1-7` — `Astro.locals` typing
- `src/lib/database.types.ts:50-99,235-258` — `assets` + `user_preferences` row types
- `vitest.config.ts:5,7,8` — tsconfigPaths plugin, include glob, node env
- `src/lib/net-worth.test.ts:1-12,29,41,57-58` — house test conventions, FP probe, toBe/toBeCloseTo
- `.github/workflows/ci.yml:19-29` — CI order, e2e gate

## Architecture Insights

- **Pure-lib-then-UI is the established shape.** `src/lib/*.ts` hold pure functions (`net-worth`, `exchange-rates`) unit-tested in isolation; islands/pages consume them. S-09's `src/lib/fire.ts` fits this mold exactly — and the roadmap risk note mandates it.
- **`computeNetWorth` has no production caller.** Both live sites re-implement the asset/liability loop. S-09 should be its first real consumer; the duplication is a known smell (`net-worth.ts:32-38` TODO) and consolidating would be a welcome side effect.
- **Display currency is resolved once, in middleware.** Don't re-fetch on SSR pages — read `Astro.locals.displayCurrency`. API routes re-fetch from `user_preferences` (the snapshots handler is the precedent).
- **Money is floats, formatted only at the view edge** via inline `toLocaleString`. No cents/integer scaling, no shared formatter. Compound-growth math should stay in raw floats and be tested with `toBeCloseTo(_, 6)`.
- **`user_preferences` is the per-user KV store.** New scalar settings go as columns (inherit RLS + triggers); a separate table is only justified by multi-row needs. The `theme` migration is the copy-paste precedent.
- **Two validation styles coexist.** `user-preferences` uses manual allow-lists; `assets` uses Zod. Either is acceptable; numeric FIRE inputs argue mildly for Zod (range/`.positive()`), but matching the host handler's manual style keeps the diff local.
- **Type generation is a CI gate.** Any schema change requires regenerating `database.types.ts`; CI's `astro sync → typecheck` fails on a stale file.

## Historical Context (from prior changes)

- `context/changes/user-settings/plan.md` — S-05 plan: the `display_currency`/`theme` persistence pattern, `npx astro sync` regeneration note (`:126,425`), and the settings-form/API design this feature mirrors.
- `context/changes/supabase-schema-migrations/plan.md:293,341` — the real Supabase CLI `gen types` command behind the project's "astro sync" shorthand.
- `context/foundation/lessons.md` — directly applicable priors: **Currency cast boundary** (`:25-33`, keep `convertAmount` typed `Currency`, cast at call sites), **RLS USING + WITH CHECK** (`:45-55`, mandatory pair on any new user-owned table — relevant only if a separate `fire_settings` table is chosen), **vite-tsconfig-paths for `@/`** (`:35-43`), **SECURITY DEFINER search_path** (`:81-89`, if any new trigger is added).
- MEMORY `project_tsc_blocker_phase4` / `feedback_*` — the `asClient` cast helper for Supabase-typed SUTs; **not needed** for the pure FIRE function. Also note: the MEMORY claim that `net-worth.test.ts` uses relative imports is stale — it uses the `@/` alias today.

## Related Research

None prior for this change (`research.md` is the first artifact under `context/changes/fire-calculator/`). Upstream slice plans (`user-settings`, `dashboard-snapshots-chart`, `asset-management`, `supabase-schema-migrations`) under `context/changes/**/plan.md` are the closest related artifacts.

## Open Questions

These are **planning decisions** (owners per `roadmap.md:204-210`), not unresolved research — recorded so `/10x-plan` addresses them explicitly. The research above does not, by itself, decide them:

1. **Starting point override** (owner: planner) — prefill from live `computeNetWorth` and allow the user to override with a hypothetical? Recommendation in roadmap: prefill + allow override. *Note for scope honesty:* "uses current net worth as the starting point" is the wedge; an override field is an addition, not a given — confirm it's in v1 scope before building the input.
2. **Input set** (owner: user, before planning) — confirm the four inputs (target annual expenses, SWR default 4%, expected return, contributions). Defer separate inflation field + variable returns.
3. **Returns model** (owner: planner) — single real-return input (net of inflation) vs nominal + inflation. The roadmap risk note (`:210`) flags mixing nominal/real as the top correctness hazard; v1 recommendation is a single real-return field. **The pure `fire.ts` must document which it assumes**, or the tests will encode an ambiguous oracle.
4. **Persistence shape** (owner: planner) — columns on `user_preferences` (recommended here) vs `fire_settings` table. If columns: which are `NOT NULL DEFAULT` vs nullable (SWR has a natural default 0.04; expenses/return/contribution arguably nullable-until-set).
5. **FIRE-number / years-to-FI derivation** — not a codebase question but the core math contract: FIRE number = `target_annual_expenses / safe_withdrawal_rate`; years-to-FI = periods until `principal·(1+r)^n + contributions·annuity_factor ≥ FIRE number`. Off-by-one on compounding period (annual vs monthly) and contribution timing (start vs end of period) are the subtle bugs the table-driven tests must pin. Decide the compounding granularity (annual is simplest-correct) before writing the oracle.
6. **Currency mid-projection** — display currency is fixed for the projection (single currency end-to-end, per `roadmap.md:209`); no need to re-convert per year unless inputs are entered in mixed currencies (out of scope — all inputs in display currency).
