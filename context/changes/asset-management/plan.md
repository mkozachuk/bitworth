# Asset Management — Implementation Plan

## Overview

Build the asset CRUD layer for BitWorth: server-side API routes wrapping DB ops, React UI with separate list/create/edit pages, exchange rate fetching with DB cache, and live net worth display.

## Current State Analysis

The schema already exists (`assets` table with `user_id`, `category_id`, `name`, `amount`, `currency`, `crypto_symbol`, `notes`, timestamps). F-01 added RLS policies, auto-creation triggers, and the `exchange_rate_cache` table. The dashboard is a bare placeholder (`src/pages/dashboard.astro`). Supabase types are in `src/lib/database.types.ts`. Auth pages use controlled React forms with `useState`, validation, and `e.preventDefault()` on invalid submit.

## Desired End State

User can add an asset (name, amount, currency, category), edit it, delete it, and see their live net worth total (assets minus liabilities, converted to display currency) — all via a protected `/dashboard/assets` page with list/create/edit routes.

### Key Discoveries:

- `assets.currency` is CHECK-constrained to `'PLN'`, `'USD'`, `'EUR'`; only these three supported per roadmap.
- `asset_categories` is a seed table — no user-defined categories in S-01 scope.
- `exchange_rate_cache` has a public-read RLS policy and composite PK on `(base_currency, target_currency)` — any authenticated user can write rates.
- frankfurter.app is EUR-base — to get PLN→USD, fetch EUR→PLN and EUR→USD, then cross-rate: `PLN→USD = EUR→USD / EUR→PLN`.
- `Tables<"assets">`, `TablesInsert<"assets">`, `TablesUpdate<"assets">` from `~/lib/database.types` are the canonical types — never hand-write them.
- Error shape is always `{ error: { code: string, message: string, context?: unknown } }` per CLAUDE.md hard rule.
- Auth forms use `noValidate` on `<form>` + JS-side validation; follow the same pattern.

## What We're NOT Doing

- Category CRUD (asset_categories is seed-only, not user-managed)
- Demo mode
- Auto-snapshot trigger
- Net worth chart (S-02)
- Crypto price fetch (S-03)
- Dashboard layout / nav redesign (beyond adding the assets link)
- Exchange rate fetch from client-side React
- Custom category creation

## Implementation Approach

**Phase 1:** Server-side — add exchange rate fetch logic (frankfurter.app → exchange_rate_cache with 1h TTL), then the four REST API routes for assets.

**Phase 2:** React components — reusable AssetForm, AssetList/AssetRow, CurrencyBadge.

**Phase 3:** Astro pages — `/dashboard/assets` (list with net worth), `/dashboard/assets/new` (add form), `/dashboard/assets/[id]/edit` (edit form). All three are protected routes via existing middleware.

**Phase 4:** Dashboard integration — net worth calculation using cached rates, nav link to assets page.

## Critical Implementation Details

- **frankfurter.app is EUR-base.** Cross-rate formula: `PLN→USD = (rate_EUR_USD / rate_EUR_PLN)`. Fetch both EUR→USD and EUR→PLN (or EUR→EUR which is 1.0), compute all three pairs, write to cache. Fallback: hardcoded rates `{ USD: 1.0, EUR: 0.92, PLN: 3.85 }` as rough last-resort.
- **Net worth = Σ(assets.amount) − Σ(liabilities.amount), each converted to display_currency via cached rates.** Use `Tables<"assets">` rows; filter client-side by `category.is_liability`.
- **Edit page needs GET to load the asset for pre-filling the form.** The list page can use client-side filtering; the edit page needs a dedicated GET endpoint.
- **Crypto symbol** is nullable in the schema — no crypto price lookup in S-01 (that's S-03), so `crypto_symbol` stays null for now.
- **Delete is a full delete** (no soft-delete in the schema). Confirm with a browser `confirm()` dialog in React before submitting.

## Phase 1: Server-side — exchange rate service + asset API routes

### Overview

Add the exchange rate fetching utility, then the four REST endpoints for assets (GET list, POST create, PUT update, DELETE remove). All routes use the existing `createClient` pattern from `src/lib/supabase.ts` and follow the error shape `{ error: { code, message, context } }`.

### Changes Required:

#### 1. Exchange rate fetch utility

**File**: `src/lib/exchange-rates.ts`

**Intent**: Fetch rates from frankfurter.app (EUR-base), write to `exchange_rate_cache` table with 1h TTL, compute cross-rates for all three currency pairs. Expose a `getRates()` function that returns `{ USD: number, EUR: number, PLN: number }` (rates relative to USD = 1.0). Falls back to static rates if the fetch or cache miss.

**Contract**: `getRates()` → `Promise<Record<Currency, number>>` where `Currency = 'PLN' | 'USD' | 'EUR'`. Values are rates where USD = 1.0 (so `rates.USD === 1.0`, `rates.EUR ≈ 0.92`, `rates.PLN ≈ 3.85`). Cache TTL: 3600 seconds. Falls back to static `{ USD: 1, EUR: 0.92, PLN: 3.85 }` on any failure.

#### 2. Asset list API route

**File**: `src/pages/api/assets/index.ts`

**Intent**: GET endpoint returning the authenticated user's assets with category info pre-joined (name, icon from asset_categories). Returns JSON `data: AssetWithCategory[]`. Requires auth check; if `!supabase`, return `{ error: { code: 'UNAUTHORIZED', message: '...' } }`.

**Contract**: `GET /api/assets` → `{ data?: AssetWithCategory[], error?: ErrorShape }` where `AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> }`.

#### 3. Asset create API route

**File**: `src/pages/api/assets/index.ts`

**Intent**: POST endpoint creating a new asset. Reads `{ name, amount, currency, category_id, notes, crypto_symbol? }` from `formData`. Inserts into `assets`. Returns the created row.

**Contract**: `POST /api/assets` → `{ data?: Tables<'assets'>, error?: ErrorShape }`.

#### 4. Asset update API route

**File**: `src/pages/api/assets/[id]/index.ts`

**Intent**: PUT endpoint updating an existing asset. Reads `{ name?, amount?, currency?, category_id?, notes?, crypto_symbol? }` from `formData`. Updates the row by `id` (RLS ensures user owns it). Returns the updated row.

**Contract**: `PUT /api/assets/[id]` → `{ data?: Tables<'assets'>, error?: ErrorShape }`.

#### 5. Asset delete API route

**File**: `src/pages/api/assets/[id]/index.ts`

**Intent**: DELETE endpoint removing an asset. Uses `supabase.from('assets').delete().eq('id', id)` — RLS enforces user ownership.

**Contract**: `DELETE /api/assets/[id]` → `{ data?: null, error?: ErrorShape }`.

### Success Criteria:

#### Automated

- `npm run lint` passes (no ESLint errors)
- TypeScript type checking passes: `npx tsc --noEmit`

#### Manual

- POST to `/api/assets` with valid data creates a row visible in Supabase dashboard
- PUT to `/api/assets/[id]` updates the row and returns the updated data
- DELETE to `/api/assets/[id]` removes the row
- GET to `/api/assets` returns only the authenticated user's assets (verified by creating a second account and checking cross-user isolation)

---

## Phase 2: React components — asset list, form, and supporting UI

### Overview

Build the React UI components following the same patterns as the auth forms: controlled forms with `useState`, per-field validation, `noValidate` on `<form>`, `e.preventDefault()` on invalid submit. All components use the Radix UI button + existing `cn()` utility.

### Changes Required:

#### 1. Currency badge

**File**: `src/components/assets/CurrencyBadge.tsx`

**Intent**: Small inline badge showing the currency code with a color-coded dot (USD = blue, EUR = green, PLN = yellow).

**Contract**: `interface Props { currency: 'USD' | 'EUR' | 'PLN' }`. Renders a `<span>` with `bg-white/10` background, rounded-full, 2-char currency code.

#### 2. Category select

**File**: `src/components/assets/CategorySelect.tsx`

**Intent**: Dropdown (native `<select>`) listing all categories from `asset_categories`, grouped by assets vs liabilities.

**Contract**: `interface Props { value: string; onChange: (id: string) => void; error?: string }`. Fetches from `/api/categories` (new tiny endpoint) or accepts categories as a prop.

#### 3. Asset row

**File**: `src/components/assets/AssetRow.tsx`

**Intent**: Single row in the asset list table. Shows: name, amount + currency badge, category with icon, edit link, delete button.

**Contract**: `interface Props { asset: AssetWithCategory; onDelete: (id: string) => void; displayCurrency: string }`.

#### 4. Asset form

**File**: `src/components/assets/AssetForm.tsx`

**Intent**: Controlled form for add and edit. Fields: name (text), amount (number, step 0.01), currency (select: USD/EUR/PLN), category (CategorySelect), notes (optional textarea), crypto_symbol (optional text, visible only when category is crypto). On submit, POST or PUT to the appropriate API route.

**Contract**: `interface Props { asset?: Tables<'assets'>; mode: 'create' | 'edit'; onSuccess: () => void; onCancel?: () => void; serverError?: string | null }`.

#### 5. Asset list component

**File**: `src/components/assets/AssetList.tsx`

**Intent**: Fetches and renders the user's assets. Shows a filter bar (Assets / Liabilities / All tabs). Each row has edit + delete actions. Shows empty state when no assets.

**Contract**: `interface Props { displayCurrency: Currency }`.

#### 6. Net worth display

**File**: `src/components/assets/NetWorthDisplay.tsx`

**Intent**: Shows the user's live net worth (sum of all assets minus liabilities, converted to display currency) using rates from `getRates()`. Shows three numbers: total, assets, liabilities.

**Contract**: `interface Props { assets: AssetWithCategory[]; displayCurrency: Currency; rates: Record<Currency, number> }`. Renders with a large heading number + breakdown.

### Success Criteria:

#### Automated

- `npm run lint` passes
- TypeScript type checking passes

#### Manual

- Form validation prevents empty name, non-numeric amount, missing category
- Submit button shows pending state while API call is in flight
- Server errors surface in a `ServerError`-style banner
- Liabilities show as negative values in the net worth calculation

---

## Phase 3: Astro pages — list, add, edit

### Overview

Three protected Astro pages under `/dashboard/assets/`. Each is a server-rendered page that loads initial data (asset list, or single asset for edit) and hydrates the React components with `client:load`. The dashboard layout wraps content in a glassmorphism card matching the existing pattern.

### Changes Required:

#### 1. Asset list page

**File**: `src/pages/dashboard/assets/index.astro`

**Intent**: Protected page listing all user assets with the net worth display at top, filter tabs (Assets / Liabilities / All), and a link to add new. Fetches assets server-side via `createClient` (not via API route) for initial render.

**Contract**: Route `/dashboard/assets`. Protected (middleware). Renders `NetWorthDisplay` + `AssetList` + link to `/dashboard/assets/new`.

#### 2. Add asset page

**File**: `src/pages/dashboard/assets/new.astro`

**Intent**: Protected page with the add asset form. On successful POST redirect, go back to `/dashboard/assets`.

**Contract**: Route `/dashboard/assets/new`. Protected. Renders `AssetForm` in create mode. Success redirects to `/dashboard/assets`.

#### 3. Edit asset page

**File**: `src/pages/dashboard/assets/[id]/index.astro`

**Intent**: Protected page pre-filled with the asset's current values. Loads asset via GET to `/api/assets/[id]` (or via server-side DB query). On successful PUT redirect, go back to `/dashboard/assets`.

**Contract**: Route `/dashboard/assets/[id]/edit`. Protected. Renders `AssetForm` in edit mode with `asset` prop pre-populated. 404 if asset not found or not owned.

### Success Criteria:

#### Automated

- `npm run lint` passes
- TypeScript type checking passes

#### Manual

- Navigating to `/dashboard/assets` shows the asset list with correct net worth
- Adding an asset navigates back to the list and shows the new asset
- Editing an asset shows current values pre-filled and updates on save
- Deleting an asset removes it from the list immediately
- Navigating directly to `/dashboard/assets/[id]/edit` with a non-existent ID shows a 404 state
- Unauthenticated access redirects to `/auth/signin`

---

## Phase 4: Dashboard integration — net worth + nav link

### Overview

Update the dashboard to show the user's net worth using cached exchange rates, and add a link to assets in the nav. This wires the asset data into the main dashboard page.

### Changes Required:

#### 1. Dashboard net worth panel

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the placeholder "Dashboard" heading with a real net worth display. Fetch user's assets + rates server-side, compute net worth, render in a glassmorphism panel.

**Contract**: Panel shows: net worth total (large number), assets subtotal, liabilities subtotal, display currency, last-updated timestamp. Uses `NetWorthDisplay` component.

#### 2. Dashboard nav link

**File**: `src/components/Topbar.astro`

**Intent**: When user is authenticated, show a "Assets" link in the Topbar next to "Dashboard".

**Contract**: Add `<a href="/dashboard/assets" class="...">Assets</a>` to the authenticated nav section.

### Success Criteria:

#### Automated

- `npm run lint` passes
- TypeScript type checking passes

#### Manual

- Dashboard shows real net worth computed from user's assets
- "Assets" link appears in nav when logged in; clicking goes to `/dashboard/assets`

---

## Testing Strategy

### Unit Tests

- `exchange-rates.ts`: mock `fetch`, verify correct cross-rate computation, verify cache write, verify fallback on network error
- `AssetForm`: test validation (empty name, negative amount, missing category), test submit calls correct endpoint

### Integration Tests

- Full CRUD cycle via API routes: create → read → update → delete, verify RLS isolation with two different authenticated users
- Net worth calculation: create assets in different currencies, verify total matches expected conversion

### Manual Testing Steps

1. Sign in → dashboard shows net worth (0 if no assets)
2. Click Assets in nav → `/dashboard/assets` shows empty state
3. Click Add Asset → fill form, submit → return to list with new asset
4. Verify net worth on dashboard updates after adding asset
5. Edit an asset → change amount/currency → verify list and dashboard update
6. Delete an asset → confirm dialog → asset removed, net worth updates
7. Sign in as different user → verify no cross-user data leakage

## Performance Considerations

- Exchange rates cached in DB with 1h TTL — no rate limit risk from frankfurter.app
- Asset list loaded server-side on page load (SSR), not re-fetched on every navigation
- No virtual scrolling needed at MVP scale (users unlikely to have >100 assets)

## Migration Notes

No DB migration needed — `assets` table and `exchange_rate_cache` already exist from F-01. New code only.

## References

- Schema: `supabase/migrations/20260529190856_initial_schema.sql`
- Supabase types: `src/lib/database.types.ts`
- Auth pattern: `src/pages/api/auth/signin.ts`
- Form pattern: `src/components/auth/SignInForm.tsx`
- Exchange rate cache: `exchange_rate_cache` table (composite PK: base_currency, target_currency)
- frankfurter.app docs: https://www.frankfurter.app/docs

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Server-side — exchange rate service + asset API routes

#### Automated

- [x] 1.1 `npm run lint` passes — a68514f
- [x] 1.2 TypeScript type checking passes (`npx tsc --noEmit`) — a68514f

#### Manual

- [ ] 1.3 POST /api/assets creates a row and returns it
- [ ] 1.4 PUT /api/assets/[id] updates the row
- [ ] 1.5 DELETE /api/assets/[id] removes the row
- [ ] 1.6 GET /api/assets returns only the authenticated user's assets
- [ ] 1.7 Exchange rates are cached in exchange_rate_cache with 1h TTL
- [ ] 1.8 Fallback to static rates works when frankfurter.app is down

### Phase 2: React components — asset list, form, and supporting UI

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 TypeScript type checking passes

#### Manual

- [ ] 2.3 AssetForm validation prevents empty/invalid submissions
- [ ] 2.4 Add and edit modes work with correct API endpoints
- [ ] 2.5 Delete shows confirmation dialog before submitting
- [ ] 2.6 Liabilities tab shows liabilities only; Assets tab shows assets only

### Phase 3: Astro pages — list, add, edit

#### Automated

- [ ] 3.1 `npm run lint` passes
- [ ] 3.2 TypeScript type checking passes

#### Manual

- [ ] 3.3 /dashboard/assets shows asset list + net worth
- [ ] 3.4 /dashboard/assets/new creates asset and redirects to list
- [ ] 3.5 /dashboard/assets/[id]/edit pre-fills form and updates on save
- [ ] 3.6 Non-existent asset ID shows 404 state
- [ ] 3.7 Unauthenticated access redirects to /auth/signin

### Phase 4: Dashboard integration — net worth + nav link

#### Automated

- [ ] 4.1 `npm run lint` passes
- [ ] 4.2 TypeScript type checking passes

#### Manual

- [ ] 4.3 Dashboard shows real net worth computed from user assets
- [ ] 4.4 "Assets" nav link visible and functional when logged in