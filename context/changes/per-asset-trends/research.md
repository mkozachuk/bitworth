---
date: 2026-06-19T18:16:25+0200
researcher: maksymkozachuk
git_commit: 339a1d92c8169b80621079d69991bd0a1646b452
branch: feature/chart-update
repository: bitworth
topic: "Per-asset trend charts with per-asset opt-in flag + dashboard master toggle"
tags: [research, codebase, per-asset-trends, charts, snapshots, assets, recharts]
status: complete
last_updated: 2026-06-19
last_updated_by: maksymkozachuk
---

# Research: Per-asset trend charts with per-asset opt-in flag + dashboard master toggle

**Date**: 2026-06-19T18:16:25+0200
**Researcher**: maksymkozachuk
**Git Commit**: 339a1d92c8169b80621079d69991bd0a1646b452
**Branch**: feature/chart-update
**Repository**: bitworth

## Research Question

Build per-asset trends (S-12 `per-asset-trends`). It should be configurable on the
add/edit asset page — a switch/checkbox that defines whether to show the chart for
that asset. On the dashboard there should be a similar toggle to show/hide all asset
chart lines; default is **off**, and when on it shows **only the assets opted-in at the
asset level**.

## Decisions locked with the user (this session)

These resolve the roadmap's open "Unknowns" for S-12 (roadmap.md:257-261) and **override
the roadmap's earlier recommendation** of a single per-asset chart with a selector:

1. **Presentation → a SEPARATE "Asset Trends" chart** below the Net Worth chart, *not*
   overlaid on it. Rationale (user-raised): net worth is the sum of all holdings, so on a
   shared linear Y-axis individual asset lines collapse into a flat band near zero and
   become unreadable. A separate chart auto-scales its Y-axis to the selected assets only.
2. **Absolute ⇄ % (indexed) sub-toggle** on the Asset Trends chart. Even within a separate
   chart, assets of very different sizes (e.g. an 80k savings line vs a 2k crypto line)
   flatten the small one. Indexed mode rebases each line to 100 at its first present
   snapshot so the chart reads as *relative growth* and all lines share a scale honestly.
3. **Per-asset opt-in flag** (`show_on_chart` boolean) set on the add/edit asset form.
   Default `false`. This is the opt-in set the dashboard toggle reveals.
4. **Master dashboard toggle** = **ephemeral, client-only, default OFF each visit**. No DB
   column / migration for the toggle itself; only the per-asset flag needs a column.
   Persisting the toggle in `user_preferences` is captured as an easy follow-up (see Open
   Questions), not in this scope.
5. **Granularity = per-asset** (user said "this asset"), matched on `(name, category_id)`
   exactly like `src/lib/movers.ts` — there is no stable `asset_id` on snapshot history.

## Summary

The feature threads **one new boolean column** (`assets.show_on_chart`) through five layers
(migration → generated types → form → POST/PUT handlers → tests), then adds a **read-only
trend feature** on the dashboard: a new pure series-builder (`src/lib/asset-trends.ts`)
that reuses `movers.ts`'s `(name, category_id)` matching + signed `contribution()` logic, a
new server-side query in `dashboard.astro` to load `snapshot_items` for **all** snapshots
(today only the latest snapshot's items are loaded), and a new `AssetTrendsChart` React
island built from the existing Recharts `LineChart` recipe in `NetWorthChart.tsx`.

Everything needed to draw the lines is **already captured** at snapshot time — each
`snapshot_items` row carries `name`, `category_id`, `original_amount`, `original_currency`
(database.types.ts:145-201). The only schema change is the opt-in flag. The hard parts are
all in the pure builder: sparse/late-appearing assets, mid-series gaps, rename
discontinuities, zero-baseline indexing, and liability sign — all enumerated below.

There is **no Zod, no Switch/Checkbox UI primitive, and no `<Legend>` usage** anywhere in
the repo — these are net-new but have close in-repo patterns to copy.

## Detailed Findings

### Area 1 — Per-asset `show_on_chart` flag: schema → form → API

**Schema / migration.** `assets` has no boolean flag today (database.types.ts:50-99). The
only prior `assets` alter is `ALTER TABLE assets ADD COLUMN quantity NUMERIC;`
(`supabase/migrations/20260531223101_crypto_price_cache.sql:43` — nullable, no default).
The canonical `NOT NULL DEFAULT` shape to copy is
`supabase/migrations/20260611120000_user_preferences_fire.sql:23,27` and
`20260603120000_user_preferences_theme.sql:6-8`. Convention: filename
`YYYYMMDDHHMMSS_snake_name.sql`, body wrapped in `BEGIN; … COMMIT;`.

Exact SQL (new file e.g. `supabase/migrations/20260619120000_assets_show_on_chart.sql`):

```sql
BEGIN;
ALTER TABLE assets
  ADD COLUMN show_on_chart BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
```

**RLS:** no change. The `assets` policy is `FOR ALL USING (auth.uid() = user_id) WITH CHECK
(auth.uid() = user_id)` (`20260602235644_rls_with_check.sql:17-21`) — row-scoped on
`user_id`, not column-scoped (satisfies lessons.md "RLS USING-only is not enough"). The
`assets_updated_at` trigger needs no change.

**Generated types.** `src/lib/database.types.ts` assets type is hand-editable, three
shapes: Row (`:51-63`, add `show_on_chart: boolean;`), Insert (`:64-76`, add
`show_on_chart?: boolean;`), Update (`:77-89`, add `show_on_chart?: boolean;`). **CLAUDE.md
is misleading**: `npx astro sync` regenerates Astro content-collection types only, NOT
Supabase types. The real command (per `context/changes/supabase-schema-migrations/plan.md:293`)
is `npx supabase gen types typescript --local > src/lib/database.types.ts`. For a
one-column add, hand-editing the three entries is the established norm.

**Form.** `src/components/assets/AssetForm.tsx` declares fields as `useState` + native input
with a `name` attr, submitted via `new FormData(form)` (AssetForm.tsx:74). **Checkbox
gotcha**: a native `<input type="checkbox">` appears in FormData *only when checked* (value
`"on"`) and is **absent when unchecked** — so on PUT you can't tell "user unchecked it" from
"field omitted." Fix: mirror controlled state into a hidden input (the form already uses a
hidden input at AssetForm.tsx:307 for crypto currency):

```tsx
const [showOnChart, setShowOnChart] = useState(asset ? asset.show_on_chart : false); // ~line 33
// near the notes block (AssetForm.tsx:312-327):
<label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-blue-100/80">
  <input type="checkbox" checked={showOnChart} onChange={(e) => setShowOnChart(e.target.checked)} />
  Show on chart
</label>
<input type="hidden" name="show_on_chart" value={showOnChart ? "true" : "false"} />
```

No Switch/Checkbox primitive exists — only `src/components/ui/button.tsx` and
`LibBadge.astro`. `@radix-ui/react-dropdown-menu` is installed but not
`react-switch`/`react-checkbox`. Use a native checkbox styled with `accent-purple-600`
(the established accent — see SettingsForm.tsx:100-124 radio cards).

**API parse.** Both handlers read `form.get("…") as string | null` and build the payload
inline.
- POST `src/pages/api/assets/index.ts`: read after `:91`
  (`const show_on_chart = form.get("show_on_chart");`), add to `.insert({…})` at `:119-128`
  → `show_on_chart: show_on_chart === "true",`.
- PUT `src/pages/api/assets/[id]/index.ts`: read after `:53`, add to the conditional
  `updates` builder after `:76` → `if (show_on_chart !== null) updates.show_on_chart =
  show_on_chart === "true";` (the hidden mirror makes it always present on submit, so
  toggling off is captured).

**Tests won't break.** `index.test.ts:76-80` only asserts `payload.user_id === userA`;
`[id]/index.test.ts:59-81` only asserts `updates` has no `user_id`. Adding `show_on_chart`
is safe. Mock is `src/test-utils/supabase-mock.ts` (`createSupabaseMock`, `findCall`).
Suggested new coverage: POST with `show_on_chart="true"` → `payload.show_on_chart === true`;
PUT with `"false"` → `updates.show_on_chart === false`.

**No Zod anywhere** — validation is hand-rolled at the handler boundary (documented in
`src/pages/api/user-preferences/index.ts:20-21`). A boolean needs only the `=== "true"`
coercion.

### Area 2 — Per-asset series builder from snapshot history

**Write path** `src/pages/api/snapshots/index.ts`: on POST it inserts one `snapshots` row
(`:110-121`: `user_id`, `total_net_worth`, `display_currency`, `base_currency:"USD"`,
`source:"manual"`) then N `snapshot_items` rows (`:140-153`). Each item carries
`snapshot_id`, `category_id`, `name`, `original_amount`, `original_currency`,
`converted_amount`, `display_currency`, `exchange_rate_usd`, `display_order`
(database.types.ts:145-201). **There is NO `asset_id`** — only FKs to `snapshots` and
`asset_categories`. Identity for cross-snapshot matching is **`(name, category_id)`**.
(No DB transaction; a compensating delete at `:155-156` rolls back the parent if items fail
— see lessons.md "DB multi-table writes must be atomic".)

**Read path** `src/pages/dashboard.astro`: loads snapshots ascending (`:28-32`) and **only
the latest snapshot's items** (`:38-40`). Per-asset trends need items for **all** snapshots
— a new query. Two shapes:
- Nested off snapshots (one round trip):
  `from("snapshots").select("id, created_at, display_currency, snapshot_items(*, category:asset_categories(*))").eq("user_id", user.id).order("created_at", { ascending: true })`
- Or load snapshot ids then `from("snapshot_items").select("*, category:asset_categories(*)").in("snapshot_id", snapshotIds)` (mirrors the existing `.eq("snapshot_id", …)` join at dashboard.astro:39). `snapshot_items` has no `user_id`, so you must filter by snapshot ids.

**Reuse `src/lib/movers.ts`** (tested in `movers.test.ts`):
- `key(name, categoryId) => \`${name} ${categoryId}\`` (`:47-50`) — the identity. Reuse verbatim.
- `contribution(amount, currency, isLiability, displayCurrency, rates)` (`:53-62`) — converts
  then negates for liabilities (a shrinking debt reads as a gain). Reuse for liability-correct
  signed series values.
- `EPSILON = 1e-2` (`:7`) — float-dust guard; reuse for zero-baseline detection.
- Both sides convert at **today's** rates so a display-currency switch doesn't fabricate
  movement (docstring `:64-74`). Prefer recomputing each point from
  `original_amount`/`original_currency` at one shared `rates` table over the frozen
  `converted_amount`.

**`is_liability` lives on the CATEGORY, not the asset/item.** `asset_categories.is_liability`
(database.types.ts:29); `assets` and `snapshot_items` have none. Populate it (and `icon`,
database.types.ts:27) from the `category:asset_categories(*)` join — same as `movers.ts`,
`net-worth.ts:8`, and the snapshot write path (`index.ts:101`).

**Currency** `src/lib/net-worth.ts:18-27`: `convertAmount(amount, from, to, rates)` →
`amount / rates[from] * rates[to]` (short-circuits when `from===to`). `Currency` union
`"PLN"|"USD"|"EUR"` canonical at `exchange-rates.ts:3`. `getRates(supabase)`
(`exchange-rates.ts:46-86`) is async + DB-touching (cache TTL 3600s, frankfurter.app, static
fallback `USD:1, EUR:0.92, PLN:3.85`) — call once server-side, thread `rates` into the pure
builder. Cast `as Currency` only at the `convertAmount` call site (net-worth.ts:11-17).

**X-axis = `snapshots.created_at`** (ISO string), ascending — mirror NetWorthChart.tsx:51-58
(`date: s.created_at`). Use the parent snapshot's `created_at`, not `snapshot_items.created_at`
(item insert time).

**Proposed pure builder** `src/lib/asset-trends.ts`:

```ts
import { convertAmount, type Currency } from "./net-worth";

export interface TrendItem {
  snapshotId: string;
  snapshotDate: string;        // parent snapshots.created_at (ISO) — the X value
  name: string;
  category_id: string;
  original_amount: number;
  original_currency: string;   // cast `as Currency` at the convertAmount boundary
  is_liability: boolean;       // from category.is_liability
  icon: string | null;         // from category.icon
}
export interface TrendPoint { date: string; value: number; indexed: number | null; }
export interface AssetTrendSeries {
  name: string; category_id: string; icon: string | null; is_liability: boolean;
  points: TrendPoint[];        // chronological
}
export function buildAssetTrends(
  items: TrendItem[], displayCurrency: Currency, rates: Record<Currency, number>,
): AssetTrendSeries[];
```

Internally: group by `key(name, category_id)`, compute each point via `contribution()`,
sort points ascending, set `indexed = Math.abs(firstValue) < EPSILON ? null : (value /
firstValue) * 100` against the line's own first present point.

### Area 3 — Chart + dashboard wiring

**Recharts recipe** (copy from `NetWorthChart.tsx`): imports at `:1`; `ResponsiveContainer
width="100%" height={300} initialDimension={{ width: 600, height: 300 }}` (`:118` — keep
`initialDimension` for SSR/island hydration); `LineChart` margins (`:119`); `CartesianGrid
stroke="var(--border)"` (`:120`); `XAxis dataKey="date"` with month `tickFormatter`
(`:121-125`); `YAxis` (`:126-134`); custom `<Tooltip content={<CustomTooltip />}>` (`:135`,
component `:21-50`); `<Line type="monotone" … stroke="var(--chart-1)" dot={false}
strokeWidth={2} />` (`:136`). Card wrapper + header-with-currency-badge at `:102-109`;
empty-state early return at `:82-96`. `FireProjectionChart.tsx` shows the same recipe with a
numeric x-axis and a tooltip that takes a `displayCurrency` prop.

**Colors**: `src/styles/global.css` defines exactly **5** theme-aware chart vars
`--chart-1..5` (light `:28-32`, dark `:62-66`, Tailwind aliases `:100-104`). No JS hex/palette
helper exists — cycle the vars: `stroke={\`var(--chart-${(i % 5) + 1})\`}`. With >5 opted-in
assets, colors repeat — disambiguate via legend.

**Legend**: **no `<Legend>` is used anywhere** in the repo. For N dynamic lines add Recharts
`<Legend />` and set `name={asset.name}` + a **stable unique `dataKey` per asset (use
`asset.id`, not `name`** — names can collide). Optionally a custom `content` render-prop for
styling, mirroring the custom Tooltip.

**Dashboard composition** `src/pages/dashboard.astro`: islands mount `client:load`. The new
`<AssetTrendsChart>` slots after `<NetWorthChart>` (closes `:78`). Already loaded
server-side and passable: `displayCurrency` (`:22`), `assets` as `AssetWithCategory[]`
(`:24`), `rates` (`:26`), `snapshots` ascending (`:28-32`). **Missing**: all-snapshots
`snapshot_items` (new query, Area 2).

**Toggle UI**: no Switch/`role="switch"` precedent. Closest patterns —
`PasswordToggle.tsx` (a plain `<button type="button">` with `aria-label` + lucide icon) for
the master toggle, and `SettingsForm.tsx:100-124` segmented **radio-cards**
(`<input type="radio" className="size-4 accent-purple-600">` + highlighted selected card)
for the absolute⇄% sub-toggle. If you build the master toggle on Radix, heed the MEMORY note
on Radix + iOS Safari (controlled `open` + `onClick` fallback gated by a ref).

**Proposed island props** `AssetTrendsChart`:

```ts
interface AssetTrendsChartProps {
  assets: AssetWithCategory[];          // current assets → opted-in line set + display names
  snapshots: SnapshotRow[];             // ascending by created_at
  snapshotItems: SnapshotItemRow[];     // for EVERY snapshot (new query); match by (name, category_id)
  displayCurrency: Currency;
  rates: Record<Currency, number>;
  defaultVisible?: boolean;             // master toggle initial; default false
}
// local state: visible: boolean; mode: "absolute" | "percent"
```

### Area 4 — `user_preferences` pattern (reference only — toggle persistence is a follow-up)

`src/pages/api/user-preferences/index.ts`: GET (`:104-132`) auth-guards, selects
`PREFS_SELECT` (`:15-18`) `.eq("user_id").maybeSingle()`. PUT (`:134-193`) validates
per-field, `upsert({ user_id, …updates }, { onConflict: "user_id" }).eq("user_id", …)`,
partial-update (absent fields untouched). Error shape strictly `{ error: { code, message } }`
via `jsonError` (`:59-64`). Middleware `src/middleware.ts:18-33` reads `theme,
display_currency` and validates into `Astro.locals` (typed at `env.d.ts:1-7`). Pattern for a
future "remember toggle": migration `ALTER TABLE user_preferences ADD COLUMN show_asset_trends
BOOLEAN NOT NULL DEFAULT false`, add to `PREFS_SELECT`, PUT validation branch, surface via
middleware. **Not in scope this slice.**

## Code References

- `src/lib/database.types.ts:50-99` — `assets` Row/Insert/Update (no flag today; add here)
- `src/lib/database.types.ts:23-49` — `asset_categories` incl. `is_liability:29`, `icon:27`
- `src/lib/database.types.ts:145-201` — `snapshot_items` (no `asset_id`)
- `supabase/migrations/20260611120000_user_preferences_fire.sql:23,27` — `NOT NULL DEFAULT` migration shape
- `supabase/migrations/20260602235644_rls_with_check.sql:17-21` — assets RLS (row-scoped, no change)
- `src/components/assets/AssetForm.tsx:33,74,307,312-327` — state, FormData submit, hidden-input precedent, insert point
- `src/pages/api/assets/index.ts:91,119-128` — POST parse + insert
- `src/pages/api/assets/[id]/index.ts:53,55-77` — PUT parse + conditional `updates`
- `src/pages/api/assets/index.test.ts:76-80`, `src/pages/api/assets/[id]/index.test.ts:59-81` — payload assertions
- `src/pages/api/snapshots/index.ts:110-121,140-153` — snapshot + item write
- `src/pages/dashboard.astro:22,24,26,28-32,38-40,71-90` — server load + island mount points
- `src/lib/movers.ts:7,47-50,53-62` — EPSILON, key, contribution (reuse)
- `src/lib/net-worth.ts:8,18-27` — `convertAmount`, category-carries-`is_liability`
- `src/lib/exchange-rates.ts:3,46-86` — `Currency`, `getRates`
- `src/components/NetWorthChart.tsx:1,21-50,82-96,102-148` — Recharts recipe to copy
- `src/components/fire/FireProjectionChart.tsx:1,13-39,67-87` — second Recharts reference
- `src/styles/global.css:28-32,62-66,100-104` — `--chart-1..5`
- `src/components/settings/SettingsForm.tsx:100-124` — radio-card pattern (absolute⇄% sub-toggle)
- `src/components/auth/PasswordToggle.tsx` — button-toggle pattern (master toggle)
- `src/middleware.ts:18-33`, `src/env.d.ts:1-7` — `displayCurrency`/`theme` into `Astro.locals`

## Architecture Insights

- **Hand-threaded columns.** No ORM/codegen wiring; every new column travels migration →
  `database.types.ts` (hand-edit the 3 shapes) → form `name` attr → handler `form.get` →
  inline insert/update → tests. No Zod — coerce/validate at the handler boundary.
- **Snapshot identity is `(name, category_id)`, intentionally.** `snapshot_items` has no
  `asset_id` by design; `movers.ts` already matches on this pair. The per-asset series builder
  must accept the same fragility (renames/category-moves = discontinuities).
- **Convert-at-today's-rates invariant.** Both `movers.ts` and the snapshot write path convert
  via `convertAmount` at a single shared `rates` set so a display-currency switch never
  fabricates movement. The series builder must follow suit (recompute from
  `original_amount`/`original_currency`, not the frozen `converted_amount`).
- **Charts are pure presentational islands** fed entirely by server-loaded props; all data
  fetching stays in `dashboard.astro` frontmatter. Keep the diff/series math in a pure,
  unit-tested `src/lib/*.ts` module (the `movers.ts` precedent).
- **5 chart colors, theme-aware via CSS vars.** Cycle them; lean on the legend past 5 lines.

## Historical Context (from prior changes)

- `context/changes/dashboard-snapshots-chart/` (S-02) — the one-time Recharts decision and
  `NetWorthChart`. `recharts-docs.md` there is a local Recharts reference. Reuse, don't add a lib.
- `context/changes/dashboard-top-movers/` (S-11) — introduced `src/lib/movers.ts`, the first
  reader of `snapshot_items`, the `(name, category_id)` matching, and signed contributions.
  S-12 explicitly reuses this (roadmap.md:260, 281).
- `context/changes/supabase-schema-migrations/plan.md:293` — the real Supabase type-gen command.
- `context/foundation/lessons.md` — "DB multi-table writes must be atomic" (snapshots write),
  "RLS USING-only is not enough" (assets policy already has WITH CHECK), "Currency cast
  boundary" (cast `as Currency` only at `convertAmount`).

## Related Research

- `context/changes/dashboard-snapshots-chart/research.md` — S-02 chart exploration.
- (No prior `research.md` for `per-asset-trends`; this is the first.)

## Open Questions

1. **Master-toggle persistence (deferred).** Currently ephemeral/default-off. If the user later
   wants it remembered, follow the `user_preferences` pattern (Area 4): new boolean column,
   `PREFS_SELECT`, PUT branch, middleware → `Astro.locals`. Easy, additive.
2. **Indexed-mode edge cases the plan must pin (Area 2):**
   - Late-appearing assets → rebase each line to 100 at *its own* first present snapshot, not
     the global first.
   - Mid-series gaps (asset deleted then re-added) → choose: `null` hole vs carry-forward vs
     interpolate.
   - Rename / category-move → `(name, category_id)` change = discontinuity (old line ends, new
     begins); no `asset_id` to stitch. Document as a known limitation, mirroring S-11/S-12 risk.
   - Zero/near-zero first value → can't index (÷0); emit `null` (mirror `movers.ts` `pct===null`).
   - Liabilities → `contribution()` makes the value negative; indexing a negative baseline to 100
     inverts direction confusingly. Decide: plot liabilities by absolute value, or a sign-aware
     mode, or rebase on `Math.abs(baseline)`.
3. **All-snapshots items query shape** (nested select vs `.in(snapshotIds)`) — perf vs
   round-trips; owner: planner.
4. **>5 opted-in assets** color collision — accept repeats + rely on legend, or add a palette
   helper? Also consider a soft cap / "too many lines" affordance.
5. **Empty / single-snapshot / no-opted-in-assets states** — the chart must render a friendly
   placeholder (mirror `NetWorthChart.tsx:82-96` and the TopMovers no-snapshot state), not crash.
6. **Where exactly the master toggle lives** — a control on the Asset Trends card header, vs a
   page-level control. Recommendation: on the card header next to the title (NetWorthChart's
   header row `:104-109` is the slot pattern).
