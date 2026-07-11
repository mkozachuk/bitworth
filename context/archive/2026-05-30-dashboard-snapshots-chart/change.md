---
date: "2026-05-30T17:30:00-04:00"
researcher: maksymkozachuk
git_commit: 552ea098b0bedc4686329faea0bd17cc53ebbcf0
branch: master
repository: bitworth
topic: "dashboard-snapshots-chart: internal code patterns, schema, and integration points for net worth display, delta indicators, trend chart, and snapshot save"
tags: [research, dashboard, snapshots, recharts, supabase]
status: archived
last_updated: "2026-05-31"
last_updated_by: maksymkozachuk
created: 2026-05-30
updated: 2026-07-11
archived_at: 2026-07-11T20:55:40Z
---

# Research: dashboard-snapshots-chart — Internal Patterns, Schema, and Integration

**Date**: 2026-05-30T17:30:00-04:00
**Researcher**: maksymkozachuk
**Git Commit**: 552ea098b0bedc4686329faea0bd17cc53ebbcf0
**Branch**: master
**Repository**: bitworth

## Research Question

What patterns, schema, and integration points exist in the codebase to implement the dashboard-snapshots-chart change (net worth display, delta indicators, trend chart with Recharts, and manual snapshot save)?

## Summary

The dashboard page currently renders only the `NetWorthDisplay` React component (hydrated `client:load`). The change requires: (1) extending `NetWorthDisplay` to show delta indicators vs. the last month and Jan 1st, (2) adding a new `NetWorthChart` React component with Recharts, (3) adding a "Save Snapshot" button that POSTs to a new API route, and (4) fetching snapshot history server-side in `dashboard.astro`. The snapshots table and supporting schema are already in place — no migration needed. The only new dependency is `recharts` + `react-is`.

## Internal Codebase Patterns

### Dashboard Page (`src/pages/dashboard.astro`)

- Server-side auth guard via `Astro.locals.user` → redirect to `/auth/signin` if absent
- Supabase client via `createClient(Astro.request.headers, Astro.cookies)`
- Exchange rates via `getRates(supabase)` — hits Frankfurter API with 1-hour cache TTL, falls back to static rates (`USD=1.0, EUR=0.92, PLN=3.85`)
- `displayCurrency` is hardcoded to `"USD"` — user preference from `user_preferences` table is not read yet
- Data passed as serializable props to `client:load` React components
- No additional API routes needed for server-side data — query runs in frontmatter

Key references:
- `dashboard.astro:18` — `createClient(Astro.request.headers, Astro.cookies)`
- `dashboard.astro:21-24` — assets query pattern
- `dashboard.astro:26` — `getRates(supabase)` call

### Styling Patterns (from `NetWorthDisplay.tsx`)

| Pattern | Tailwind |
|---|---|
| Glass card | `rounded-xl border border-white/10 bg-white/5 p-6` |
| Label | `text-sm font-medium tracking-wider text-white/60 uppercase` |
| Net worth value | `text-4xl font-bold text-white` |
| Positive delta | `text-green-300` |
| Negative delta | `text-red-300` |
| Two-col grid | `grid grid-cols-2 gap-4 border-t border-white/10 pt-4` |
| Currency badge | Via `CurrencyBadge` component |

### API Route Pattern

All existing API routes follow this exact pattern (reference: `src/pages/api/assets/index.ts`):
1. Guard `!supabase` → 401 `UNAUTHORIZED`
2. Guard `!user` via `supabase.auth.getUser()` → 401 `UNAUTHORIZED`
3. Extract fields from `request.formData()` (form POST) or `await request.json()` (JSON POST)
4. Validate required fields → 400 `VALIDATION_ERROR`
5. Supabase operation → check `error` → 5xx `INSERT_FAILED`/`FETCH_FAILED`
6. Return `{ data }` or `{ error: { code, message } }`

Error shape: `{ error: { code: string, message: string, context?: unknown } }` — never `{ error: string }`.

### Supabase Client Pattern

`src/lib/supabase.ts` — `createClient(requestHeaders, cookies)` from `@supabase/ssr`. Returns `null` if env vars are missing. All server-side routes use this.

### Currency Conversion Pattern

`NetWorthDisplay.tsx:13-22` — converts via USD as intermediate:
```ts
function convertAmount(amount, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return amount;
  const inUSD = amount / rates[fromCurrency];
  return inUSD * rates[toCurrency];
}
```

## Supabase Schema — Snapshots

The schema is already migrated. Relevant tables:

### `snapshots` (migration lines 41-51)

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key |
| `user_id` | `UUID` | FK → `auth.users(id)` |
| `total_net_worth` | `NUMERIC(18,2)` | Already in display currency |
| `display_currency` | `TEXT` | CHECK in ('PLN','USD','EUR') |
| `base_currency` | `TEXT` | Always 'USD' per default |
| `source` | `TEXT` | CHECK in ('manual','auto') |
| `note` | `TEXT` | Optional |
| `created_at` | `TIMESTAMPTZ` | Second precision |

Indexes:
- `idx_snapshots_user_created ON snapshots(user_id, created_at DESC)` — covers chart query + ordering in single index scan

RLS policy: `auth.uid() = user_id` — authenticated queries are automatically filtered.

### `snapshot_items` (migration lines 53-66)

Stores itemized values at snapshot time with `exchange_rate_usd` per item — enables re-conversion to a different base currency post-facto.

### `assets` (migration lines 27-39)

Has `amount` (NUMERIC), `currency` (PLN/USD/EUR), `category_id` → `asset_categories(id)`. Used to compute `total_net_worth` when saving a snapshot.

### `user_preferences` (migration lines 9-15)

Stores `display_currency` per user. The dashboard hardcodes to `"USD"` currently — reading from this table is needed for the delta comparison to be meaningful.

### `asset_categories` (migration lines 18-25)

13 seeded categories with `is_liability` flag. "Loans & Credit" is the only liability category.

## Delta Computation Logic

### Delta vs last month

Fetch all snapshots for user, ordered by `created_at DESC`. Compare newest snapshot's `total_net_worth` against the snapshot from ~30 days prior:

```ts
const current = snapshots[0]; // newest
const lastMonth = snapshots.find(s => {
  const age = Date.now() - new Date(s.created_at).getTime();
  return age >= 25 * 24 * 60 * 60 * 1000; // ~25 days to cover month boundary
});
const deltaLM = current.total_net_worth - (lastMonth?.total_net_worth ?? current.total_net_worth);
```

Since `total_net_worth` is stored in the user's `display_currency`, the comparison is valid as-is (no re-conversion needed). If no last-month snapshot exists, the delta is zero or null.

### Delta vs January 1st

```ts
const yearStart = new Date(`${new Date().getFullYear()}-01-01T00:00:00Z`);
const janSnap = snapshots.find(s => new Date(s.created_at) <= yearStart);
// If no Jan snapshot, use the earliest available snapshot, or show "no baseline"
const deltaJan = current.total_net_worth - (janSnap?.total_net_worth ?? null);
```

## Recharts Integration

### Not yet installed

`package.json` has no charting library. Needs: `npm install recharts react-is`.

### Core component pattern (from `context/changes/dashboard-snapshots-chart/recharts-docs.md`)

```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid,
         Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface SnapshotPoint {
  date: string;      // ISO string, e.g. "2026-01-01"
  netWorth: number;  // in display currency
  label?: string;    // e.g. "Jan"
}

function CustomTooltip({ active, payload, label }) {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/10 p-3 text-white backdrop-blur">
        <p className="text-xs text-white/60">{label}</p>
        <p className="text-sm font-semibold">
          {Number(payload[0].value).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </p>
      </div>
    );
  }
  return null;
}

<ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>
  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
    <XAxis dataKey="date" tick={{ fill: '#a1a1aa', fontSize: 12 }}
           tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short' })} />
    <YAxis tick={{ fill: '#a1a1aa', fontSize: 12 }}
           tickFormatter={(v) => v.toLocaleString()} />
    <CartesianGrid stroke="#ffffff10" strokeDasharray="5 5" />
    <Line type="monotone" dataKey="netWorth" stroke="#a78bfa" dot={false} strokeWidth={2} />
    <Tooltip content={<CustomTooltip />} />
    <ReferenceLine y={startNetWorth} stroke="#4ade80" strokeDasharray="3 3"
      label={{ value: 'Start', fill: '#4ade80', position: 'insideTopRight' }} />
  </LineChart>
</ResponsiveContainer>
```

Key props:
- `Line`: `type="monotone"`, `dot={false}` — clean trend line for financial data
- `ReferenceLine`: dashed green line marking January 1st starting point
- `initialDimension`: prevents -1 warning on initial render
- `cartesianGrid stroke="#ffffff10"`: subtle grid matching dark theme

## Snapshot Save API Route

No snapshot API route exists. Needs new file at `src/pages/api/snapshots/index.ts`:

**GET** — fetch all snapshots for chart (runs server-side in dashboard.astro, but API route useful for client-side refresh):
```ts
export const GET: APIRoute = async ({ request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) return json({ error: { code: "UNAUTHORIZED", message: "Not configured" } }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  const { data, error } = await supabase
    .from("snapshots")
    .select("id, total_net_worth, display_currency, source, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return json({ error: { code: "FETCH_FAILED", message: error.message } }, { status: 500 });
  return json({ data }, { status: 200, headers: { "Content-Type": "application/json" } });
};
```

**POST** — save manual snapshot:
```ts
export const POST: APIRoute = async ({ request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) return json({ error: { code: "UNAUTHORIZED", message: "Not configured" } }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  // Fetch current assets → compute total_net_worth
  const { data: assets } = await supabase.from("assets").select("*, category:asset_categories(*)").eq("user_id", user.id);
  // Fetch user display currency preference
  const { data: prefs } = await supabase.from("user_preferences").select("display_currency").eq("user_id", user.id).single();
  const displayCurrency = prefs?.display_currency ?? "USD";
  // Compute net worth (convert via rates, same logic as NetWorthDisplay)
  // Insert snapshot + snapshot_items
  const { data, error } = await supabase.from("snapshots").insert({ ... }).select().single();
  // Insert snapshot_items for each asset
  // Return { data }
};
```

The snapshot save must: (1) fetch current assets, (2) compute total net worth in display currency using `getRates()`, (3) insert `snapshots` row with `source='manual'`, (4) optionally insert `snapshot_items` rows for itemized history.

## Components to Create or Modify

| File | Action | Purpose |
|---|---|---|
| `src/components/DashboardHeader.tsx` | **Create** | Net worth card + delta indicators (extends current `NetWorthDisplay` pattern) |
| `src/components/NetWorthChart.tsx` | **Create** | Recharts `LineChart` with custom tooltip and Jan 1st reference line |
| `src/pages/api/snapshots/index.ts` | **Create** | GET (fetch all) + POST (save manual snapshot) |
| `src/pages/dashboard.astro` | **Modify** | Fetch snapshots alongside assets; pass chart data as props |
| `src/lib/exchange-rates.ts` | **Reference** | Used server-side for snapshot save computation |
| `src/lib/database.types.ts` | **Reference** | `snapshots` and `snapshot_items` types |

## Related Prior Changes

- `context/changes/asset-management/` — asset CRUD pattern, API route structure, `NetWorthDisplay` component
- `context/changes/supabase-schema-migrations/` — full schema including `snapshots`, `snapshot_items`, `exchange_rate_cache` tables

## Open Questions

1. **Display currency preference**: `dashboard.astro:19` hardcodes `"USD"`. Should read from `user_preferences` table. This affects delta accuracy (snapshots are stored in user's preferred currency).
2. **Snapshot auto-save trigger**: Roadmap marks this as "owner: user" — first-login-of-month vs fixed day-of-month. Manual trigger ships regardless.
3. **Empty state**: What to show in the chart card when no snapshots exist yet? Likely: "No snapshots yet. Save your first one to see your trend." with the Save Snapshot button prominent.

## Recharts Library Status

- **No charting library installed** — `recharts` + `react-is` need to be added
- **React 19** compatible (Recharts v3.x supports React 19 per docs)
- **No other charting options in codebase** — Recharts is the only choice
- **Agent-friendly docs**: `context/changes/dashboard-snapshots-chart/recharts-docs.md` has full pattern reference