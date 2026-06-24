---
date: 2026-06-24T08:10:59+0200
researcher: maksymkozachuk
git_commit: 731012c8bb9ebf8d8a33eacd60938e254a4d5d09
branch: feature/asset-balancer
repository: bitworth
topic: "Asset balancer (S-15) — target vs real allocation pie charts + per-asset % label"
tags: [research, codebase, asset-balancer, allocation, recharts, supabase, rls]
status: complete
last_updated: 2026-06-24
last_updated_by: maksymkozachuk
---

# Research: Asset balancer (S-15) — target vs real allocation

**Date**: 2026-06-24T08:10:59+0200
**Researcher**: maksymkozachuk
**Git Commit**: 731012c8bb9ebf8d8a33eacd60938e254a4d5d09
**Branch**: feature/asset-balancer
**Repository**: bitworth

## Research Question

For the `asset-balancer` change (roadmap slice S-15), map the exact live-code patterns a `/10x-plan` will copy across four surfaces: (1) data & schema (new `allocation_targets` table, RLS, generated types, prefs), (2) allocation math reuse (`net-worth.ts`, the `Currency` cast boundary, pure-helper + test conventions), (3) charting & UI (first Recharts `PieChart`, the new `/dashboard/balancer` page, nav, the per-asset "% of all assets" label), and (4) API route conventions (auth, error shape, atomic multi-row writes).

## Summary

The feature decomposes cleanly into **one new table + one new pure helper + one new page + one new API route + three in-place edits**, and every piece has a recent, copyable precedent in the repo:

- **Data**: a new user-owned `allocation_targets(user_id, asset_id, target_pct)` table is the right model — not a `user_preferences` column (that's 1:1, untyped for a variable-length per-asset list) and not a flag on `assets` (it needs a per-asset percentage, not a boolean). FK `asset_id → assets(id) ON DELETE CASCADE` + `UNIQUE(user_id, asset_id)` makes upserts idempotent and auto-cleans on asset delete. Mirror the F-01 DDL + RLS `USING + WITH CHECK` template; regenerate `src/lib/database.types.ts` via `npx astro sync` (do not hand-edit).
- **Math**: isolate everything in a pure `src/lib/allocation.ts` mirroring `src/lib/fire.ts` (raw floats, round only at the view edge, throw/`null` on divide-by-zero). Reuse `convertAmount` / `computeNetWorth` from `net-worth.ts`. Follow the **lib-layer cast precedent** (`movers.ts`, `asset-trends.ts`): declare `currency: string` on the input interface, cast `as Currency` only at the `convertAmount` call. Percentages on a **0–100 scale** with an `EPSILON`-guarded `null` for a ~0 denominator (the `movers.ts` convention).
- **Liabilities**: there is **no `is_liability` flag on `assets`** — it lives on `asset_categories.is_liability`. You must join `category:asset_categories(*)` and filter `!is_liability`. The balancer set is non-liability assets only.
- **UI**: copy `FireProjectionChart.tsx` for the PieChart island (it's the first PieChart — Recharts `^3.8.1` supports it), copy `dashboard/fire.astro` for `balancer.astro`, add a "Balance" nav item to `TopbarMenu.tsx` between Assets and FIRE, and add the "% of all assets" label by computing the denominator in `AssetList.tsx` and passing it down to `AssetRow`/`AssetCard`. `/dashboard/balancer` is auto-protected — no middleware change.
- **API**: new `src/pages/api/allocation-targets/index.ts` with the two-guard auth (null-client + no-user → 401 `UNAUTHORIZED`), `.eq("user_id", user.id)` filter, the inline `{ error: { code, message, context? } }` shape via a `jsonError` helper, **hand-rolled validation (no Zod in the repo)**, and a **single `.upsert(array, { onConflict: "user_id,asset_id" })`** for the multi-row write (one statement = atomic; avoid the snapshots compensating-delete anti-pattern). Use JSON body (`request.json()`), not `formData`.

No new preference is required for v1. The roadmap's recommendations (denominator = sum of selected non-liability assets; declared pie renders raw targets and flags ≠100% sum; real pie normalizes by construction) are all consistent with the live code.

## Detailed Findings

### 1. Data & schema patterns

**Migration filename convention**: `YYYYMMDDHHMMSS_snake_case.sql`. Every feature migration since the initial schema uses a noon-padded stamp (`20260623120000_user_preferences_show_fire_dashboard.sql`). Next migration → `20260624120000_allocation_targets.sql`. All wrap DDL in `BEGIN; … COMMIT;` with an intent/RLS/rollback comment header.

**User-owned table DDL** — canonical shape (`supabase/migrations/20260529190856_initial_schema.sql:28-39`, the `assets` table):
- PK `UUID DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
- money `NUMERIC(18,2)`; rate/fraction `NUMERIC(5,4)` (the FIRE-rate precedent, values in [0,1])
- `created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`; attach the `update_updated_at()` trigger (`:115-118`)
- index on `user_id` (`:78`), `ENABLE ROW LEVEL SECURITY` (`:85-89`)

**RLS is already retrofitted** with `WITH CHECK` (the lesson at `lessons.md:45-55` is **closed**). Current `assets` policy (`supabase/migrations/20260602235644_rls_with_check.sql:17-21`):
```sql
CREATE POLICY "Users own their assets" ON assets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```
`allocation_targets` has its own `user_id`, so use this **direct** template (not the transitive `snapshot_items` form).

**Generated types**: `src/lib/database.types.ts` (note `src/lib/`, not `src/db/`). Generated via `npx astro sync` (CLAUDE.md + `README.md:116`) — do **not** hand-edit. Each table = `{ Row, Insert, Update, Relationships }`; `Insert` makes default-bearing columns optional. Full current `user_preferences.Row` (`database.types.ts:239-255`) confirms the pref set: `display_currency`, `theme`, a block of `fire_*` columns, `show_fire_dashboard: boolean`. Consumers reference types via the `Tables<"assets">` helper generic.

**`assets` columns** (initial schema + two ALTERs, confirmed against `database.types.ts:51-64`): `id` UUID PK, `user_id`, `category_id TEXT → asset_categories(id)`, `name`, `amount NUMERIC(18,2)`, `currency TEXT CHECK IN ('PLN','USD','EUR')`, `crypto_symbol?`, `quantity?`, `notes?`, `show_on_chart BOOLEAN DEFAULT FALSE` (the boolean opt-in column precedent), `created_at`, `updated_at`.

**Liability discriminator** is **category-based**, not a column on `assets`: `asset_categories.is_liability BOOLEAN` (`initial_schema.sql:22`). Seeded liability is only `loans_credit` (`supabase/seed.sql`; note `p2p_loans` is an asset). Code always joins `category:asset_categories(*)` and filters `!a.category.is_liability` (e.g. `AssetList.tsx:24-25`, `NetWorthDisplay.tsx:207`).

**Where to persist the balancer's "investment set"**: a **new `allocation_targets` table**, not a pref, not a column on `assets` — the feature is a `(user, asset) → target_pct` mapping. Presence of any rows is itself the "in the set" signal; no separate boolean needed. If a global on/off is ever wanted, follow the `show_fire_dashboard` boolean-pref flow.

### 2. Allocation math reuse

**`src/lib/net-worth.ts`** (read fully, 57 lines) exports exactly two functions plus the re-exported `Currency` type and the `NetWorthAsset` interface:
- `convertAmount(amount, fromCurrency: Currency, toCurrency: Currency, rates: Record<Currency, number>): number` (`:18-27`) — pivots through USD: `amount / rates[from] * rates[to]`; same-currency short-circuits. `rates` is a `Currency`→`number` table, "units per 1 USD" (USD = 1.0).
- `computeNetWorth(assets: NetWorthAsset[], displayCurrency: Currency, rates): number` (`:40-56`) — assets minus liabilities, single number. A `TODO(future-refactor)` (`:32-38`) notes callers re-implement the loop to expose `totalAssets`/`totalLiabilities` separately — the balancer likely wants that breakdown, so `allocation.ts` should return structured totals rather than a bare number.
- `NetWorthAsset` (`:5-9`): `{ amount: number; currency: Currency; category: { is_liability: boolean } }`.

**`Currency` type**: `"PLN" | "USD" | "EUR"`, canonical in `src/lib/exchange-rates.ts:3`, re-exported from `net-worth.ts:1-3`.

**Currency cast boundary** (lesson `lessons.md:25-33`): DB `currency` is `string`; cast `as Currency` **at the call site / convertAmount boundary**, never widen the helper. Real precedents: page-level `fire.astro:30`, component-level `NetWorthDisplay.tsx:141` / `AssetsSummary.tsx:22`, and the **lib-layer precedent** in `movers.ts:14,60` and `asset-trends.ts:15` — the interface declares `currency: string` with a comment and the cast happens inside the function body at the `convertAmount` call. `allocation.ts` should follow the **lib-layer** form.

**Pure-helper + test conventions** (mirror `src/lib/fire.ts` + `fire.test.ts`):
- Header contract (`fire.ts:1-12`): "No Supabase, no React, no I/O. All values are raw floats; rounding happens only at the view edge." Invalid input **throws** (`RangeError`, `fire.ts:81-83`) rather than returning sentinels.
- Vitest, config at `vitest.config.ts` with `tsconfigPaths()` so the `@/` alias resolves. **Import via `@/lib/allocation`** (the lesson note at `lessons.md:35-43` that tests use *relative* imports is **stale** — both current tests use the `@/` alias).
- Test house style: `describe` per function; oracle-from-first-principles comments; `toBe` only for exact integers/short-circuits, `toBeCloseTo(_, 6)` for any division; a `333.33`-class probe to catch ×100/÷100 scaling bugs; an `overrides`-factory fixture; explicit `Record<Currency, number>` rate literals.

**Rates at runtime**: `getRates(supabase): Promise<Record<Currency, number>>` (`exchange-rates.ts:46-86`) — 1-hour Supabase cache → Frankfurter API → `STATIC_RATES` fallback (`{ USD: 1.0, EUR: 0.92, PLN: 3.85 }`). **Server path** (what the Balance page uses): call `getRates(supabase)` in `.astro` frontmatter and pass `rates` + `displayCurrency` into the island as props — exact template at `assets/index.astro:27,49-61`. Client path is `GET /api/rates` with `sessionStorage["bw_rates"]` caching (`NetWorthDisplay.tsx:118-134`).

**Percentage / rounding conventions**: no shared `formatPercent` in `src/lib` — formatting is per-component at the view edge (`.toFixed(1)`, `toLocaleString`). The math precedent is `movers.ts:101`: percentages on a **0–100 scale** (`* 100`), and a near-zero denominator returns **`null`** guarded by `EPSILON = 1e-2` (`movers.ts:7`), not `=== 0`, because converted floats carry rounding dust. Adopt both: keep `allocation.ts` outputs as raw 0–100 floats with an `EPSILON`/`null` divide-by-zero guard; format in the component.

### 3. Charting & UI conventions

**Recharts `^3.8.1`** (package.json). All existing charts are `LineChart` — `PieChart` will be the **first**. Recharts 3.8.1 supports `PieChart`/`Pie`/`Cell`/`Legend`/`Tooltip`/`ResponsiveContainer`.

**Chart island template** — `src/components/fire/FireProjectionChart.tsx`:
- named imports from `"recharts"` (`:1`); typed `interface Props` (`:6-11`) with pre-shaped server data
- **empty-data guard** returns a placeholder card (`:44-53`) — Recharts won't render empty data; replicate for zero allocation
- card wrapper `rounded-2xl border border-zinc-200 bg-white/80 p-6 dark:border-white/10 dark:bg-white/5` + uppercase header (`:56-62`)
- `<ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>` (`:64`) — `initialDimension` is consistently set (SSR-safe)
- custom local `CustomTooltip` passed via `content={...}` (`:13-39, 83`)
- **colors are CSS variables** `var(--chart-1)`…`var(--chart-5)` (defined in `src/styles/global.css:28-32` light, `:62-66` dark, mapped to Tailwind at `:100-104`) — never hardcoded hex. Build a `Cell` color array cycling the 5 tokens; **both pies must reuse the same per-asset color mapping** so declared vs real slices are comparable.
- rendered as island with **`client:load`** (all charts use it, e.g. `dashboard.astro:183-198`).

**Page template** — `src/pages/dashboard/fire.astro` (closest recent sibling). Frontmatter sequence: `DashboardLayout` import → auth guard (`const { user } = Astro.locals; if (!user) return Astro.redirect("/auth/signin")`, `:12-16`) → `createClient(Astro.request.headers, Astro.cookies)` (`:18`) → `displayCurrency = Astro.locals.displayCurrency ?? "USD"` (`:19`) → assets with `.select("*, category:asset_categories(*)").eq("user_id", user.id)` (`:21`) → `getRates(supabase)` (`:23`) → prefs `.maybeSingle()` (`:37-48`) → **compute server-side, pass flat props to a presentational island**. Per-page `type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> }` (`:10`). Routing: `PROTECTED_ROUTES = ["/dashboard"]` matched by `startsWith` (`middleware.ts:4,35`) → `/dashboard/balancer` is **auto-protected, no middleware change**.

**Nav** — `src/components/TopbarMenu.tsx`: items are hardcoded `<DropdownMenu.Item asChild>` blocks (not a data array), order Dashboard / Assets / FIRE / Settings (`:46-69`). Lucide imports at `:3` — add `Scale` (or `PieChart`). Insert a "Balance" item (`href="/dashboard/balancer"`, `<Scale className="size-4" />`) between Assets (`:53-57`) and FIRE (`:59`). **No active-route handling exists** — don't invent one. The **iOS Safari dropdown fix** (lesson `feedback_radix_dropdown_ios`) is already implemented here (`:16-17` ref, `:21` controlled `open`, `:27-35` `onPointerDown` + `onClick` fallback) — a new item inherits it for free.

**Per-asset "% of all assets" label** — `AssetRow.tsx` (desktop `<tr>`) and `AssetCard.tsx` (mobile `<li>`, S-07 reflow) share identical props (`:9-14`): `{ asset, onDelete, displayCurrency, rates }`, and each computes its own `convertAmount` (`:16-17`) — they receive **no denominator**. Compute `totalAssets` (sum of positive non-liability converted values) in the parent `AssetList.tsx` (it has the full array + `displayCurrency` + `rates`, maps rows at `:105-113` and cards at `:117-127`) and pass it as a new prop. Roadmap (`roadmap.md:319`) fixes the denominator = **sum of all positive (non-liability) asset values**; hide/handle the label on liability rows. Reuse the muted `text-xs text-zinc-500 dark:text-white/40` sub-label style. `AssetsSummary.tsx:14-29` is a reference for the per-currency `convertAmount` + reduce summation.

**Settings-gated pattern**: the balancer does **not** need a `show_balancer` toggle for v1 (roadmap defines it as an always-present page + nav item). The `show_fire_dashboard` gate (S-14) is the template **if** one is ever added: boolean pref column → server read with `?? true` default → `SettingsForm.tsx:139-149` native `<input type="checkbox" className="size-4 accent-purple-600">` → `user-preferences` PUT validation (`:171-176`).

**Reusable picker**: there is **no generic Checkbox/Switch component** (`src/components/ui/` has only `button.tsx`, `LibBadge.astro`). Existing checkbox usage is inline native inputs (`SettingsForm.tsx:139-147`). Build the "pick which assets are in the set" UI as a list of native checkboxes (restricted to non-liability assets). `CategorySelect.tsx` is the one styled `<select>` reference for any per-asset target-% inputs.

### 4. API route patterns

**Client + auth** (`src/lib/supabase.ts:5-24`): `createClient(request.headers, cookies)` returns `null` when env vars are missing. Every handler has **two 401 guards** — null client, then `supabase.auth.getUser()` no-user — both returning `{ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }` at 401 (`assets/index.ts:9-32`). API routes create the client directly; they do not use a `locals` client.

**RLS filter on every query** — `.eq("user_id", user.id)` is the first defense layer; insert stamps `user_id: user.id` from the session, never the body; update/delete filter on **both** `id` and `user_id` (`assets/[id]/index.ts:83-89, 153-159`).

**Error shape**: `interface ErrorShape { error: { code: string; message: string; context?: unknown } }` redeclared per file. Newer routes use a `jsonError` helper — best version supporting `context` at `backup/import.ts:9-15`. Codes in use: `UNAUTHORIZED`(401), `VALIDATION_ERROR`(400), `NOT_FOUND`(404), `*_FAILED`(500). Success: `{ data }` at 200, 201 on create, always `Content-Type: application/json`.

**Validation**: **no Zod anywhere** (not a dependency; `user-preferences/index.ts:24` documents the hand-roll convention). For the balancer's array body `[{ asset_id, target_pct }]` (no existing array-body route), copy the field-spec loop in `user-preferences/index.ts:37-57,70-102` (`typeof === "number" && Number.isFinite`, bounds-check) applied per row; parse via `await request.json()` in try/catch → 400 (`:147-152`); check `Array.isArray`; optionally cross-field validate the **targets sum**. Use **JSON body**, not `formData` (the `assets` routes use `formData` only because they back HTML forms).

**Atomic multi-row write** (the load-bearing lesson, `lessons.md:5-13,57-67`): the `snapshots` POST is the **anti-pattern** — sequential parent-then-children insert with a compensating delete on failure (`snapshots/index.ts:141-153`), still orphan-prone. For `allocation_targets`, the safe path is a **single `.upsert(rowsArray, { onConflict: "user_id,asset_id" })`** — one statement is atomic per call (requires the `UNIQUE(user_id, asset_id)` constraint). If the operation must full-replace (delete-then-insert), follow the **`restore_backup` RPC precedent** (`supabase/migrations/20260620120000_restore_backup_rpc.sql:30-181`): `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`, stamps `user_id := auth.uid()` with a null-guard, plus the `REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated` pair. **Do not** copy the snapshots compensating-delete. ⚠️ Any new `SECURITY DEFINER` function **must** include `SET search_path = public, pg_temp` (`lessons.md:81-89`) — omitting it silently breaks with "relation does not exist".

**Closest single-row analog**: `user-preferences/index.ts` (GET + PUT, single-row `.upsert({ user_id, ...updates }, { onConflict: "user_id" })`, `PREFS_SELECT` shared read/write projection at `:15-18`). Good structural reference, but per-asset rows make the `assets` CRUD + bulk-upsert model the better fit.

## Code References

- `supabase/migrations/20260529190856_initial_schema.sql:28-39` — `assets` table DDL (the user-owned-table template)
- `supabase/migrations/20260529190856_initial_schema.sql:22` — `asset_categories.is_liability` (the liability discriminator)
- `supabase/migrations/20260602235644_rls_with_check.sql:17-21` — `USING + WITH CHECK` policy template
- `supabase/migrations/20260623120000_user_preferences_show_fire_dashboard.sql:11` — most recent ADD COLUMN (boolean pref) precedent
- `supabase/migrations/20260620120000_restore_backup_rpc.sql:30-181` — the atomic SECURITY DEFINER RPC pattern
- `src/lib/database.types.ts:50-101` — `assets` Row/Insert/Update/Relationships; `:239-255` — full `user_preferences.Row`
- `src/lib/net-worth.ts:18-27` — `convertAmount`; `:40-56` — `computeNetWorth`; `:5-9` — `NetWorthAsset`
- `src/lib/exchange-rates.ts:3` — `Currency`; `:46-86` — `getRates`; `:5-9` — `STATIC_RATES`
- `src/lib/fire.ts:1-12` — pure-helper contract; `src/lib/fire.test.ts` + `src/lib/net-worth.test.ts` — test house style
- `src/lib/movers.ts:7,101` — `EPSILON` + 0–100 percentage + `null` divide-by-zero guard; `:14,60` — lib-layer Currency cast precedent
- `src/components/fire/FireProjectionChart.tsx` — Recharts island template (copy for PieChart)
- `src/styles/global.css:28-32,62-66,100-104` — `--chart-1..5` color tokens
- `src/pages/dashboard/fire.astro` — `/dashboard/*` page template (copy for `balancer.astro`)
- `src/pages/dashboard/assets/index.astro:27,49-61` — `getRates` → props wiring
- `src/components/TopbarMenu.tsx:3,46-69` — nav items + Lucide imports + iOS Safari fix
- `src/components/assets/{AssetRow,AssetCard,AssetList}.tsx` — per-asset label edit sites (`AssetList` owns the denominator)
- `src/pages/api/assets/index.ts:5-32,118-147` + `assets/[id]/index.ts:83-89,153-159` — CRUD auth + RLS + response shape
- `src/pages/api/user-preferences/index.ts:15-18,37-102,188-193` — hand-rolled validation + single-row upsert
- `src/pages/api/backup/import.ts:9-15,68` — `jsonError` helper + RPC call site
- `src/pages/api/snapshots/index.ts:141-153` — the multi-write anti-pattern to avoid
- `src/middleware.ts:4,35` — `/dashboard/balancer` auto-protected

## Architecture Insights

- **Compute server-side, render presentational islands.** Every dashboard page does its math in `.astro` frontmatter (`getRates` + assets join + prefs) and passes flat props to `client:load` React islands. The balancer follows this: `balancer.astro` calls `src/lib/allocation.ts` server-side, passes shaped slices to the pie island(s).
- **Isolate math in pure `src/lib/*.ts` helpers, test with Vitest.** `net-worth.ts`, `fire.ts`, `movers.ts`, `asset-trends.ts` are all I/O-free, raw-float, view-edge-rounding helpers with sibling `.test.ts` files. `allocation.ts` joins this family.
- **The `Currency` cast boundary is a settled compromise** (lesson, closed): DB `string` → `as Currency` at the `convertAmount` boundary. Keep the helper typed `Currency`; do not widen it.
- **RLS is defense-in-depth, not the only defense.** Handler `.eq("user_id", user.id)` is layer one; `USING + WITH CHECK` is layer two. New tables need both.
- **No Zod, no shared error/format helpers** — the repo hand-rolls validation and redeclares `ErrorShape`/`jsonError` per file. Match the local idiom rather than introducing abstractions.
- **Atomic writes are a known weak spot.** The snapshots compensating-delete is the cautionary tale; `.upsert(array, { onConflict })` (single statement) or a `SECURITY DEFINER` RPC are the sanctioned paths.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:307-324` (S-15) — the slice's outcome, prerequisites (F-01, S-01, S-02), and unknowns-with-recommendations. Live code confirms every recommendation: dedicated `allocation_targets` table keyed on the stable `asset_id` UUID with `ON DELETE CASCADE`; denominator = sum of selected non-liability assets; declared pie renders raw targets + flags ≠100%, real pie normalizes; restrict the set to non-liabilities; reuse Recharts (first PieChart); "Balance" nav label at `/dashboard/balancer`.
- `context/foundation/lessons.md` — five load-bearing priors apply here: atomic multi-table writes (`:5-13`), RLS `WITH CHECK` (`:45-55`, closed), the `(snapshot_id, asset_id)` missing-unique-constraint variant (`:57-67`) → motivates `UNIQUE(user_id, asset_id)`, the Currency cast boundary (`:25-33`), and SECURITY DEFINER `search_path` (`:81-89`).
- S-14 `fire-dashboard` (most recent shipped sibling) — the `show_fire_dashboard` boolean-pref flow and `FireProjectionChart` chart island are the closest copyable precedents for the optional gate and the pie island respectively.

## Related Research

- No prior `context/changes/**/research.md` exists for asset-balancer (this is the first). Sibling FIRE-feature changes (`fire-calculator`, `fire-dashboard`) are the nearest precedents but were not formally researched in `context/`.

## Open Questions

These are planner decisions for `/10x-plan` (the roadmap already recommends an answer for most):

1. **`target_pct` storage scale & type**: store as a 0–1 fraction `NUMERIC(5,4)` (the FIRE-rate repo convention) or 0–100 `NUMERIC(5,2)`? The math layer uses a 0–100 scale (`movers.ts`); pick one and convert at the DB boundary consistently. Add a `CHECK` constraint for the chosen range.
2. **Write strategy — upsert vs full-replace**: a single `.upsert(array, { onConflict: "user_id,asset_id" })` is atomic and simplest but leaves stale rows for assets removed from the set; a full-replace (delete-then-insert) needs the `restore_backup`-style RPC to stay atomic. Decide whether "removed from set" must delete the row.
3. **"% of all assets" denominator on liability rows**: roadmap says sum of positive (non-liability) values; confirm whether to hide the label on liability rows or show it against a liabilities subtotal (`roadmap.md:319`).
4. **Declared-sum handling**: live "targets sum = X%" indicator with a warn/normalize affordance vs hard-block on save (roadmap recommends non-blocking + visible flag; `roadmap.md:318`).
5. **Structured return from `allocation.ts`**: given the `computeNetWorth` `TODO` about exposing `totalAssets`/`totalLiabilities`, should `allocation.ts` return the breakdown both pies and the per-asset label need in one structured object?
