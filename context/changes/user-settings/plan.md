# User Settings: Display Currency, Theme, and Preference Wiring — Implementation Plan

## Overview

Ship the S-05 user-settings slice: a dedicated `/dashboard/settings` page where the user can change their display currency and theme (light/dark/system). Add a `theme` column to `user_preferences`. Wire the dashboard and assets page to actually read `display_currency` from `user_preferences` (the dashboard hardcodes `"USD"` today, while the snapshot save API already reads the user's preference — an asymmetric write path the roadmap flagged as the main risk). Add a mixed-currency banner and per-point currency code to the chart so old and new snapshots render legibly. Add a `Settings` link to the topbar. The full app is currently dark-only with bespoke `bg-white/5` / `text-white/80` / `border-white/10` tokens; this slice migrates them to Tailwind v4 `dark:` variants so the theme toggle actually changes the app's appearance.

## Current State Analysis

- **`user_preferences` table** exists at `supabase/migrations/20260529190856_initial_schema.sql:9-15` with `display_currency` (CHECK in `'PLN','USD','EUR'`), `updated_at` trigger, and a row auto-created on `auth.users` insert. RLS `USING (auth.uid() = user_id)` was extended with `WITH CHECK` in `supabase/migrations/20260602235644_rls_with_check.sql` — the Phase 5 lesson §4 closure.
- **Asymmetric write path**: `src/pages/api/snapshots/index.ts:80-90` reads `user_preferences.display_currency` when saving a snapshot, but `src/pages/dashboard.astro:21` and `src/pages/dashboard/assets/index.astro:20` hardcode `displayCurrency: Currency = "USD"`. Snapshots are saved in the user's preferred currency; the dashboard displays in USD regardless. The roadmap (`context/foundation/roadmap.md` S-05) flagged this as the main risk of S-05.
- **No settings UI, no Settings link, no theme column** anywhere. `src/components/Topbar.astro:12-25` shows only `Dashboard | Assets | Sign out` for authed users.
- **Tailwind v4 dark mode is already wired** at `src/styles/global.css:4` (`@custom-variant dark (&:is(.dark *));`) with a full set of CSS variables for `:root` (light) and `.dark` (dark) under `@theme inline`. The custom variant is active — `dark:bg-zinc-900` already works at the CSS level.
- **Existing app does NOT use the variable-based tokens** (`bg-card`, `text-card-foreground`). It uses dark-only `bg-white/5` / `text-white/80` / `border-white/10` everywhere. The `bg-cosmic` utility at `global.css:113-115` is a hardcoded dark gradient (`linear-gradient(#0a0e1a, #0f1529, #0a0e1a)`) with no light counterpart.
- **API route pattern** is established: `createClient(request.headers, cookies)` → `supabase.auth.getUser()` guard → 401 if missing → operation → error shape `{ error: { code, message, context? } }`. The §6.4 contract test (`src/pages/api/api-auth-contract.test.ts`) auto-audits every new route for `supabase.auth.getUser()` or a public-route justification.
- **Lesson §2 (explicit auth decisions)** and **lesson §3 (currency cast boundary)** are directly applicable. The `as Currency` cast pattern at call sites is the agreed compromise — `convertAmount` stays typed as `Currency`.
- **Topbar nav** is inline (`<a>` + `<form>`) with no dropdown. Adding a `Settings` link is a one-line change.
- **Chart tooltip** is in `NetWorthChart.tsx` and currently shows a single `currency` prop at the top — needs to show per-snapshot currency in mixed mode.

## Desired End State

- Authenticated user can visit `/dashboard/settings` and change their display currency (PLN / USD / EUR) and theme (light / dark / system). Changes persist per user across sessions and devices via the `user_preferences` table.
- The dashboard and assets page render in the user's chosen display currency (no more hardcoded USD), so the number the user sees matches the currency their snapshots are stored in.
- The chart shows a small "Your chart mixes USD and PLN snapshots from before/after your currency change on YYYY-MM-DD" banner when snapshot `display_currency` values differ across rows, and each tooltip labels the snapshot's own currency.
- The theme toggle (light / dark / system) actually changes the app's appearance, with a no-FOUC paint. Light mode has its own background (`bg-cosmic-light`), a contrasting surface token set, and readable text.
- A `Settings` link in the topbar takes the user to `/dashboard/settings`.
- Per-handler integration tests pin the new API at the same level as the existing `/api/assets` tests.

### Key Discoveries:

- `user_preferences.user_id` is the PK (not a separate `id` column) — table is a 1:1 with `auth.users` keyed on `user_id`. Updates target `user_id = auth.uid()`.
- `display_currency` is `TEXT` in the generated `database.types.ts` (not a Postgres enum) — every read needs the `as Currency` cast per lesson §3.
- `NetWorthChart.tsx:5,14,79,99` already accepts `displayCurrency` as a prop and renders it in the header; per-point currency is a new prop (`snapshotCurrency?: string` or similar) added in Phase 4.
- The snapshot table's `display_currency` column is what determines the currency of each historical data point on the chart — it's already populated by the snapshot POST (`snapshots/index.ts:116`). No DB change needed for the mixed-currency state; the data is already heterogeneous when a user has changed currency.
- `vite.config.ts` / `astro.config.mjs` do not configure `darkMode` — Tailwind v4's `@custom-variant dark (&:is(.dark *));` in `global.css` is the only config. No config change needed for the variant to work; the implementer only needs to add the `.dark` class to `<html>`.
- `global.css:113-115` defines `bg-cosmic` as a hardcoded dark gradient. A new `bg-cosmic-light` utility is needed for the light variant.
- The `test-plan.md` §3 Phase 1 deferred a DOM integration test for the dashboard render; that deferral still stands. Per-handler tests at the API boundary are the ceiling for this slice (per the §6.4 ceiling pattern).

## What We're NOT Doing

- Auto-snapshot trigger (S-02 follow-up, separate slice)
- Demo mode
- Re-converting historical snapshot `total_net_worth` values when currency changes (data integrity: each snapshot stays in the currency it was saved in)
- Date format / number format settings (single field validates the pattern; future preferences land in the same page)
- Profile/avatar dropdown in the topbar (kept as a plain text link; the S-06 mobile refactor may reshape topbar nav)
- Sign-out button consolidation (S-06 mobile refactor)
- A no-system-detect client library — `prefers-color-scheme` is read directly via `window.matchMedia`
- Persisting theme to `localStorage` independently of `user_preferences` — single source of truth in the DB; the no-FOUC script reads the authed server-rendered `<html class="dark">` first and falls back to `localStorage` only for the (small) window between first paint and server response
- Per-component dark/light Storybook-style visual diffing — out of scope for this slice; verification is by manual review at each phase gate

## Implementation Approach

Five phases in dependency order. Each phase is independently shippable and has its own verification gate.

**Phase 1 — Theme foundation**: migration adds `theme` column; Layout.astro gets a no-FOUC inline script; new `bg-cosmic-light` utility; `bg-cosmic` swapped to `bg-cosmic-light dark:bg-cosmic` on the three pages. This makes the `<html class="dark">` toggle _able to do something_ without any user settings yet — flipping the class in DevTools should swap the background on every page.

**Phase 2 — Component token migration**: every `bg-white/5`, `bg-white/10`, `text-white/80`, `text-white/60`, `text-white/40`, `border-white/10`, `border-white/20` gets a `dark:` counterpart. Glass cards, gradients, button hover states, and the chart's color palette all need light variants. This is the largest blast radius and is split into a single phase because the work is homogeneous (one pass through every component) — splitting per-component would multiply phase overhead without reducing risk.

**Phase 3 — Settings API + UI**: GET and PUT `/api/user-preferences`; new `SettingsForm` React component; new `src/pages/dashboard/settings.astro`; Topbar `Settings` link. After this phase, the user can change preferences in the UI, and the API contract is pinned.

**Phase 4 — Display currency wiring**: `dashboard.astro` and `dashboard/assets/index.astro` read `display_currency` from `user_preferences` instead of hardcoding `"USD"`; mixed-currency banner on the chart; per-point currency code in chart tooltip. The `NetWorthDisplay`, `NetWorthChart`, `AssetsSummary`, `AssetList`, `AssetRow` components already take `displayCurrency` as a prop — no signature changes, just call-site updates.

**Phase 5 — Per-handler integration tests**: GET (401 unauthenticated, 200 with the user's prefs), PUT (400 on invalid currency, 400 on invalid theme, 200 on valid update with `.eq("user_id", user.id)` in the chain). Uses `src/test-utils/supabase-mock.ts` per §6.2.

## Phase 1: Theme foundation — migration, no-FOUC script, `bg-cosmic` swap

### Overview

Add a `theme` column to `user_preferences` with CHECK constraint (`'light' | 'dark' | 'system'`, default `'system'`). Wire a no-FOUC inline script in the Layout that sets `<html class="dark">` based on the authed user's preference (server-rendered) or `prefers-color-scheme` (unauthed / SSR fallback). Add a `bg-cosmic-light` utility. Swap the three pages' `bg-cosmic` for `bg-cosmic-light dark:bg-cosmic`. After this phase, flipping `.dark` on `<html>` in DevTools visibly changes the page background on every page.

### Changes Required:

#### 1. Add `theme` column to `user_preferences`

**File**: `supabase/migrations/<timestamp>_user_preferences_theme.sql`

**Intent**: New migration adds `theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system'))` to `user_preferences`. Existing rows get `'system'` via the column default. The existing RLS policy (`auth.uid() = user_id` with `WITH CHECK` from `rls_with_check.sql`) covers writes — no policy change needed.

**Contract**: New column `theme` on `user_preferences`. CHECK in `('light','dark','system')`. Default `'system'`. The existing `update_updated_at` trigger (`initial_schema.sql:117-118`) already fires on the table, so no trigger change.

#### 2. No-FOUC theme script in Layout

**File**: `src/layouts/Layout.astro`

**Intent**: Add an `is:inline` `<script>` to `<head>` that sets `<html class="dark">` on first paint, before the body renders, to avoid a flash of light theme when the user prefers dark. The script reads the user preference from `Astro.locals.theme` (server-rendered into the page as a small JSON data island) and falls back to `window.matchMedia('(prefers-color-scheme: dark)')` if the data island is absent or stale.

**Contract**: `<html>` element on every page has `class="dark"` when the user prefers dark, `class="dark"` when their theme is `'system'` and the OS reports dark, and no class otherwise. The script is `is:inline` so Astro does not bundle or move it.

#### 3. New `bg-cosmic-light` utility

**File**: `src/styles/global.css`

**Intent**: Add a light counterpart to the `bg-cosmic` utility at `global.css:113-115` so pages can use `bg-cosmic-light dark:bg-cosmic`. Reuse the existing `:root` `--background` token for the light gradient so the `bg-background` Tailwind utility and `bg-cosmic-light` are visually consistent.

**Contract**: New `@utility bg-cosmic-light { background-image: linear-gradient(...); }` block in `global.css`. The `bg-cosmic` utility is unchanged.

#### 4. Swap `bg-cosmic` → `bg-cosmic-light dark:bg-cosmic` on every page

**Files**:

- `src/pages/dashboard.astro:35`
- `src/pages/dashboard/assets/index.astro:31`
- `src/pages/auth/signin.astro` (background)
- `src/pages/auth/signup.astro` (background)
- `src/pages/auth/confirm-email.astro` (background)
- `src/pages/index.astro` (landing page background)

**Intent**: Each page's root background div swaps to `bg-cosmic-light dark:bg-cosmic` so the theme toggle visibly changes the page background. Auth pages also flip.

**Contract**: Every `bg-cosmic` outside of `global.css` is followed by `dark:bg-cosmic`. (The `bg-cosmic` definition itself stays unchanged — it remains the dark gradient.)

#### 5. Expose `theme` on `Astro.locals`

**File**: `src/middleware.ts`

**Intent**: Extend the existing middleware (which already loads the user) to also load their `theme` from `user_preferences` and set `context.locals.theme`. The Layout reads it to render the no-FOUC script. Caching: skip the DB roundtrip if the user is null (unauthed — fallback to `prefers-color-scheme`).

**Contract**: `Astro.locals.theme: 'light' | 'dark' | 'system' | null` where `null` means "unauthed or row missing, use system". The DB query filters `eq('user_id', user.id)` and `maybeSingle()` so a missing row returns null instead of an error.

### Success Criteria:

#### Automated

- 1.1 Migration applies cleanly: `npx supabase db reset` (or equivalent local apply) succeeds, no errors.
- 1.2 `npm run lint` passes.
- 1.3 TypeScript type checking passes: `npx tsc --noEmit`.
- 1.4 `npx astro sync` regenerates `src/lib/database.types.ts` with the new `theme` column.

#### Manual

- 1.5 Open DevTools on `/dashboard`, run `document.documentElement.classList.add('dark')` in the console — page background visibly changes to the dark gradient. Run `document.documentElement.classList.remove('dark')` — reverts to the light gradient. The change is instant (no FOUC).
- 1.6 Hard-reload the page — background matches the OS preference when theme is `'system'`.
- 1.7 Sign out — background reverts to the OS preference (no authed user theme leaking to the unauthed layout).

---

## Phase 2: Component token migration — every dark-only token gets a `dark:` variant

### Overview

Every existing component uses dark-only tokens (`bg-white/5`, `bg-white/10`, `text-white/80`, `text-white/60`, `text-white/40`, `border-white/10`, `border-white/20`, `bg-cosmic`). To make the theme toggle actually change _content_ (not just the page background), each token needs a `dark:` counterpart. This is a single, homogeneous pass through the components: search, replace, verify. The work does not split well per-component because most components share the same handful of tokens; splitting would multiply the phase count without reducing the per-phase work.

### Changes Required:

#### 1. Sweep `src/components/` for dark-only tokens and add `dark:` variants

**Files**: every `.astro` and `.tsx` file under `src/components/`, plus the page files that have inline component classes. Includes:

- `src/components/Topbar.astro`
- `src/components/Banner.astro`
- `src/components/Welcome.astro`
- `src/components/NetWorthChart.tsx`
- `src/components/assets/NetWorthDisplay.tsx`
- `src/components/assets/AssetList.tsx`
- `src/components/assets/AssetRow.tsx`
- `src/components/assets/AssetForm.tsx`
- `src/components/assets/AssetsSummary.tsx`
- `src/components/assets/CurrencyBadge.tsx`
- `src/components/assets/CategorySelect.tsx`
- `src/components/auth/SignInForm.tsx`
- `src/components/auth/SignUpForm.tsx`
- `src/components/auth/SubmitButton.tsx`
- `src/components/auth/FormField.tsx`
- `src/components/auth/PasswordToggle.tsx`
- `src/components/auth/ServerError.tsx`
- `src/pages/dashboard.astro` (inline classes on heading, link, sign-out button)
- `src/pages/dashboard/assets/index.astro`
- `src/pages/dashboard/assets/new.astro`
- `src/pages/dashboard/assets/[id]/index.astro`
- `src/pages/auth/signin.astro`
- `src/pages/auth/signup.astro`
- `src/pages/index.astro`

**Intent**: Every dark-only Tailwind class gets a `dark:` counterpart so the same component renders legibly in both modes. Light counterparts: `bg-white/5` → `bg-white/5 dark:bg-zinc-900/60`; `text-white/80` → `text-white/80 dark:text-zinc-200`; `border-white/10` → `border-white/10 dark:border-zinc-800`; gradients get a light variant. The exact light values come from a manual contrast check (the implementer eyeballs each swap) — there is no automated tooling to pin the light-mode contrast against the design baseline, and lesson §1 (no over-engineering) argues against building one.

**Contract**: After the sweep, every existing `bg-white/`, `text-white/`, `border-white/`, and `bg-cosmic` token in a component or page file has a `dark:` companion. The dark defaults are preserved so the app looks identical in dark mode (no regression).

#### 2. Chart palette — `NetWorthChart` color tokens

**File**: `src/components/NetWorthChart.tsx`

**Intent**: The chart uses `stroke="#a78bfa"` (purple line), `stroke="#ffffff10"` (grid), and `tick={{ fill: '#a1a1aa' }}` (axis labels) — all dark-only. Replace with `currentColor`-relative or CSS-variable-driven colors so the chart adapts to the theme. Tailwind v4 exposes the `--chart-1` etc. CSS variables already defined at `global.css:26-30, 60-64` — use those.

**Contract**: The `Line`, `CartesianGrid`, `XAxis`/`YAxis` ticks, and `ReferenceLine` colors all read from CSS variables (`--chart-1` for the line, `--border` for the grid) so the chart palette switches on `.dark` activation.

### Success Criteria:

#### Automated

- 2.1 `npm run lint` passes.
- 2.2 TypeScript type checking passes: `npx tsc --noEmit`.
- 2.3 `grep -rE 'bg-white/(5|10)\b' src/components src/pages` returns zero matches without a `dark:` companion on the same class string.

#### Manual

- 2.4 Toggle `.dark` on `<html>` via DevTools on `/dashboard`, `/dashboard/assets`, `/dashboard/assets/new`, `/dashboard/assets/[id]/edit`, `/auth/signin`, `/auth/signup`, `/` — every page is legible and visually consistent in both modes. Specifically check: the net worth card, the asset list table, the asset form, the chart, all buttons and links, the topbar, the auth forms.
- 2.5 The chart palette visibly differs between dark and light modes (line color, grid, axis labels) without losing contrast.

---

## Phase 3: Settings API + UI — GET/PUT `/api/user-preferences`, settings page, topbar link

### Overview

Add the API surface for reading and updating user preferences. Build the settings page and form. Add the topbar link. After this phase, the user can change their display currency and theme in the UI, and the changes persist per user.

### Changes Required:

#### 1. `GET /api/user-preferences` — read current preferences

**File**: `src/pages/api/user-preferences/index.ts`

**Intent**: Returns the authed user's `display_currency` and `theme`. Auth guard per the established pattern. Returns 404 if the user's `user_preferences` row is missing (defensive — the trigger should ensure it always exists, but if a user predates the trigger, this lets the client know to POST). Single read query, no mutations.

**Contract**: `GET /api/user-preferences` → 200 `{ data: { display_currency: 'PLN' | 'USD' | 'EUR', theme: 'light' | 'dark' | 'system' } }` | 401 `UNAUTHORIZED` | 404 `NOT_FOUND`. The §6.4 contract test catches the auth check automatically.

#### 2. `PUT /api/user-preferences` — update preferences

**File**: `src/pages/api/user-preferences/index.ts`

**Intent**: Updates one or both of `display_currency` and `theme` for the authed user. Body is JSON `{ display_currency?: Currency, theme?: 'light' | 'dark' | 'system' }`. Validates each field against the allowed set; returns 400 `VALIDATION_ERROR` with a message naming the bad field. Upserts the row (`onConflict: 'user_id'`) so a missing row is created — defensive against pre-trigger users. The `.eq('user_id', user.id)` clause is in the chain (pinned by the integration test) so RLS's `USING` + `WITH CHECK` clauses are the structural defense, with the handler filter as belt-and-suspenders per lesson §4.

**Contract**: `PUT /api/user-preferences` body `{ display_currency?: 'PLN' | 'USD' | 'EUR', theme?: 'light' | 'dark' | 'system' }` → 200 `{ data: { display_currency, theme } }` | 400 `VALIDATION_ERROR` | 401 `UNAUTHORIZED`. Returns the full updated row so the client can re-render.

#### 3. `SettingsForm` React component

**File**: `src/components/settings/SettingsForm.tsx`

**Intent**: Controlled form with two fields — `display_currency` (radio / select: PLN, USD, EUR) and `theme` (radio / select: light, dark, system). On submit, sends a PUT to `/api/user-preferences` with only the changed fields. On success, calls `window.location.reload()` so the server-rendered `<html class="dark">` and the dashboard's server-rendered `displayCurrency` both pick up the new values without a client-side store.

**Contract**: Component renders the two fields with the user's current values. Submit button shows a "Saving..." pending state. On 4xx/5xx, renders the error message via the existing `ServerError` pattern. Component reads initial values from props (server-rendered into the settings page) — does not fetch on mount, since the page already has the data.

#### 4. `/dashboard/settings` Astro page

**File**: `src/pages/dashboard/settings.astro`

**Intent**: Protected page that loads the user's current `display_currency` and `theme` server-side, renders the form with the current values, and provides a success message on a redirect from PUT. Pattern matches the existing `/dashboard/assets/index.astro` (middleware redirects, `createClient`, `Topbar`, glass card around the form).

**Contract**: Route `/dashboard/settings`, protected by middleware. Page server-side reads `user_preferences` for the current user; renders `<SettingsForm initialDisplayCurrency={...} initialTheme={...} />`. On 401 from the read, redirects to `/auth/signin` (matches existing pattern).

#### 5. Topbar `Settings` link

**File**: `src/components/Topbar.astro:12-25`

**Intent**: Add a third link `Settings` between the existing `Assets` link and the `Sign out` form, in the authed-user branch. Same Tailwind classes as the existing links.

**Contract**: New `<a href="/dashboard/settings">Settings</a>` between the `Assets` link and the `Sign out` form. No dropdown, no icon — the user picked a plain text link.

### Success Criteria:

#### Automated

- 3.1 `npm run lint` passes.
- 3.2 TypeScript type checking passes: `npx tsc --noEmit`.
- 3.3 `npm run test:run` — the existing §6.4 contract test passes (the new route has `supabase.auth.getUser()`).
- 3.4 `grep -rE 'class="[^"]*bg-white/' src/components/Topbar.astro` (and similar) — the new `Settings` link has the same `dark:` companion as the existing `Dashboard` / `Assets` links (caught by Phase 2 sweep, but verify the new element was added correctly).

#### Manual

- 3.5 Sign in, navigate to `/dashboard/settings` — both fields show the user's current values.
- 3.6 Change display_currency from USD to EUR, click Save — page reloads, dashboard renders in EUR, the saved snapshot from before the change still shows USD in its tooltip (verifying the mixed-currency data shape, not the UX).
- 3.7 Change theme to light, click Save — page reloads, app background switches to the light gradient, all content is legible.
- 3.8 Change theme to system with the OS in dark mode — app background switches to dark. Switch the OS to light mode — the next page load shows light. The `<html class="dark">` toggle follows `prefers-color-scheme`.
- 3.9 Click `Settings` in the topbar from `/dashboard` — lands on `/dashboard/settings`. Click `Dashboard` from `/dashboard/settings` — lands on `/dashboard`. The two topbar links are interchangeable in both directions.

---

## Phase 4: Display currency wiring — kill the hardcodes, surface mixed-currency on the chart

### Overview

`dashboard.astro:21` and `dashboard/assets/index.astro:20` hardcode `displayCurrency = "USD"`. This phase replaces the hardcode with a server-side read of `user_preferences.display_currency`, validates the read shape (falling back to `'USD'` per the existing pattern in `snapshots/index.ts:86-90`), and surfaces the mixed-currency state on the chart with a banner and per-point currency code in the tooltip.

### Changes Required:

#### 1. `dashboard.astro` reads from `user_preferences`

**File**: `src/pages/dashboard.astro:21`

**Intent**: Replace the hardcoded `const displayCurrency: Currency = "USD";` with a server-side read of `user_preferences.display_currency` for the authed user, validated against `['PLN', 'USD', 'EUR']`, falling back to `'USD'` if the row is missing or the value is invalid (matches `snapshots/index.ts:86-90`). The same fallback pattern means the dashboard never crashes on a corrupt row.

**Contract**: `displayCurrency` is the user's stored preference, validated, with `'USD'` fallback. Passed to `<NetWorthDisplay displayCurrency={...}>`, `<AssetsSummary displayCurrency={...}>`, `<NetWorthChart displayCurrency={...}>` as today.

#### 2. `dashboard/assets/index.astro` reads from `user_preferences`

**File**: `src/pages/dashboard/assets/index.astro:20`

**Intent**: Same change as above — replace the hardcoded `'USD'` with the user's stored preference.

**Contract**: Same as Phase 4.1.

#### 3. `NetWorthChart` accepts per-snapshot currency in tooltip and shows a banner

**File**: `src/components/NetWorthChart.tsx`

**Intent**: When the user has snapshots in more than one `display_currency` (because they changed currency at some point), show a small banner above the chart: "Your chart mixes USD and PLN snapshots from before/after your currency change on YYYY-MM-DD." and tag each tooltip with the snapshot's own currency. The banner is hidden when all snapshots share the same `display_currency` (the common case).

**Contract**:

- New prop or new shape: `snapshots` already includes `display_currency` per row (the table column is populated by `snapshots/index.ts:116`). The chart derives `currenciesUsed: Set<Currency>` from the snapshots and shows the banner iff `currenciesUsed.size > 1`.
- The tooltip (already shows date and value) gains a currency line: `value.toLocaleString() {currency}` where `{currency}` is `snapshot.display_currency` for that point, not the prop.
- The banner lists the distinct currencies (alphabetical) and the date of the most recent change. (Deriving the "date of change" = the first `created_at` of any snapshot in the _new_ currency is acceptable; alternative is to add a `currency_changed_at` column to `user_preferences`, but that's over-scope for a banner — the implementer derives from snapshot data.)

#### 4. `middleware.ts` exposes `displayCurrency` on `Astro.locals`

**File**: `src/middleware.ts`

**Intent**: Extend the middleware to also load the user's `display_currency` from `user_preferences` and set `context.locals.displayCurrency: Currency | null`. Pages read from `Astro.locals.displayCurrency` instead of querying `user_preferences` themselves. Avoids three separate round-trips for the same data (one each in `dashboard.astro`, `assets/index.astro`, and the future `settings.astro`).

**Contract**: `Astro.locals.displayCurrency: 'PLN' | 'USD' | 'EUR' | null` where `null` means "unauthed or row missing, fall back to `'USD'` per Phase 4.1 / 4.2". Reuses the same `user_preferences` query as Phase 1.5.

### Success Criteria:

#### Automated

- 4.1 `npm run lint` passes.
- 4.2 TypeScript type checking passes: `npx tsc --noEmit`.
- 4.3 `npm run test:run` — existing tests pass.
- 4.4 `grep -nE 'displayCurrency.*=.*"USD"' src/pages` returns zero matches (no hardcoded `"USD"` left in pages).

#### Manual

- 4.5 Sign in as a user with no snapshots — `/dashboard` shows their preferred display currency, and `<NetWorthChart>` renders the empty-state chart with no banner.
- 4.6 Sign in as a user with snapshots all in the same currency — the chart renders without the banner; the tooltip shows the snapshot's currency (which happens to equal the user's current preference).
- 4.7 Sign in as a user with snapshots in two different currencies (e.g., save a snapshot in USD, change preference to EUR via `/dashboard/settings`, save another snapshot in EUR) — the chart shows the mixed-currency banner listing both currencies, and each tooltip tags its own currency.
- 4.8 Confirm the dashboard number and the assets list number both reflect the user's stored `display_currency`, not a hardcoded value.

---

## Phase 5: Per-handler integration tests for `/api/user-preferences`

### Overview

Per test-plan §6.4 ceiling pattern, add a per-handler integration test for the new API route. Mirrors the structure of `src/pages/api/snapshots/index.test.ts` and `src/pages/api/assets/index.test.ts` — uses `src/test-utils/supabase-mock.ts` (the shared factory from Phase 2 of the test rollout). Pins the `.eq('user_id', user.id)` clause for the lesson §4 defense, the validation regex for `display_currency` and `theme`, and the 401 path for missing auth.

### Changes Required:

#### 1. `src/pages/api/user-preferences/index.test.ts`

**File**: `src/pages/api/user-preferences/index.test.ts`

**Intent**: Integration tests for GET and PUT. Scenarios:

- **GET, no session cookie** → 401 `UNAUTHORIZED`
- **GET, valid session, prefs row present** → 200 with `{ data: { display_currency, theme } }`
- **GET, valid session, prefs row missing** → 404 `NOT_FOUND`
- **PUT, no session cookie** → 401 `UNAUTHORIZED`
- **PUT, invalid `display_currency` (e.g. `'GBP'`)** → 400 `VALIDATION_ERROR`, error message names the field
- **PUT, invalid `theme` (e.g. `'auto'`)** → 400 `VALIDATION_ERROR`
- **PUT, valid body** → 200, returns updated row, the `__recorded` chain contains `.eq('user_id', user.id)` (the lesson §4 pin — re-using the structural-property assertion pattern from the assets test)
- **PUT, valid body, only one field** → 200, only that field is in the update payload (no surprise writes of unchanged values)

**Contract**: All 8 scenarios pass under `npm run test:run`. Test uses `src/test-utils/supabase-mock.ts` per §6.2. Per the established `vi.mock("@/lib/supabase", ...)` boilerplate, the test file imports the shared mock factory and configures it for the request/response shape it needs.

### Success Criteria:

#### Automated

- 5.1 `npm run test:run` — all new test scenarios pass, no regression in the existing test suite.
- 5.2 `npm run lint` passes.
- 5.3 TypeScript type checking passes: `npx tsc --noEmit`.

#### Manual

- 5.4 Inspect the test file — the structural-property pin for `.eq('user_id', user.id)` is in the recorded-chain assertion (visible grep, not just a passing test), so a future refactor that drops the filter is caught on the next test run.

## Testing Strategy

### Unit Tests

- None required for this slice. The settings form is thin UI over the API; the API is covered by the integration tests in Phase 5. The `convertAmount` helper and the net worth calculation are already covered (`src/lib/net-worth.test.ts`).

### Integration Tests

- `src/pages/api/user-preferences/index.test.ts` — Phase 5 covers GET (401, 200, 404) and PUT (401, 400 invalid currency, 400 invalid theme, 200 valid, structural-property pin for `.eq('user_id', user.id)`).
- The §6.4 contract test (`src/pages/api/api-auth-contract.test.ts`) auto-audits the new route — already in the suite.
- Existing tests in `src/pages/api/snapshots/index.test.ts` and `src/pages/api/assets/index.test.ts` continue to pass.

### Manual Testing Steps

1. Apply the migration locally, sign in, navigate to `/dashboard/settings`, change display currency, verify dashboard and assets page both reflect the change.
2. Save a snapshot in USD, change currency to EUR, save another snapshot, open `/dashboard` — verify the mixed-currency banner appears, the banner names both currencies, and each tooltip shows the snapshot's own currency.
3. Change theme to light — verify every page is legible (no white text on white background, no missing dark-mode contrast on the chart).
4. Change theme to system, switch the OS theme, refresh — verify the page follows the OS.
5. Inspect the chart palette in both themes — the line color, grid, and axis labels all switch.
6. Sign out — verify the unauthed topbar and landing page render correctly in both themes (no leaked authed user theme state).
7. Verify cross-user isolation: sign in as a second user, confirm their `display_currency` and `theme` are theirs, not the first user's.

## Performance Considerations

- The middleware now runs two Supabase queries (user + preferences) instead of one. Both are indexed on `user_id` (PK on `user_preferences`, implicit on `auth.users`). Combined cost is well under 50 ms on a Supabase free-tier project — no caching strategy is warranted for a personal app with low QPS.
- The new `theme` column is `TEXT` with a CHECK constraint — no measurable cost over the existing schema.
- No new external API calls in this slice.

## Migration Notes

- One new migration: `supabase/migrations/<timestamp>_user_preferences_theme.sql` adds the `theme` column. Existing rows get `'system'` via the column default — no backfill needed.
- The existing RLS policy (`auth.uid() = user_id` with `WITH CHECK`) covers writes to the new column. No policy change.
- The existing `update_updated_at` trigger already fires on the table — no trigger change.
- No data backfill, no views to update, no other tables reference `user_preferences`.

## References

- Roadmap: `context/foundation/roadmap.md` S-05
- PRD: `context/foundation/prd.md` FR-011 (display currency), §Non-Goals (no settings beyond what's in scope)
- Schema: `supabase/migrations/20260529190856_initial_schema.sql:9-15, 117-131`, `20260602235644_rls_with_check.sql`
- Lessons: `context/foundation/lessons.md` §2 (auth decision), §3 (currency cast), §4 (RLS WITH CHECK — closed)
- Test plan: `context/foundation/test-plan.md` §6.4 contract test, §6.2 integration test pattern
- Existing pattern: `src/pages/api/snapshots/index.ts:80-90` (read `display_currency` with validation)
- Existing pattern: `src/pages/api/api-auth-contract.test.ts` (auth-or-comment contract)
- Tailwind v4 dark: variant: `src/styles/global.css:4`
- Existing topbar: `src/components/Topbar.astro:12-25`
- Existing dashboard hardcode: `src/pages/dashboard.astro:21`, `src/pages/dashboard/assets/index.astro:20`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Theme foundation

#### Automated

- [x] 1.1 Migration applies cleanly — 5707780
- [x] 1.2 `npm run lint` passes — 5707780
- [x] 1.3 TypeScript type checking passes — 5707780
- [x] 1.4 `npx astro sync` regenerates `database.types.ts` with `theme` — 5707780

#### Manual

- [ ] 1.5 DevTools `<html class="dark">` toggle visibly changes page background
- [ ] 1.6 Hard-reload follows OS preference under `system` theme
- [ ] 1.7 Sign-out does not leak authed user theme

### Phase 2: Component token migration

#### Automated

- [x] 2.1 `npm run lint` passes — 51bf8f4
- [x] 2.2 TypeScript type checking passes — 51bf8f4
- [x] 2.3 `grep` for unpaired `bg-white/`, `text-white/`, `border-white/` returns zero — 51bf8f4

#### Manual

- [ ] 2.4 Every page legible in both light and dark modes
- [ ] 2.5 Chart palette visibly differs between modes

### Phase 3: Settings API + UI

#### Automated

- [x] 3.1 `npm run lint` passes
- [x] 3.2 TypeScript type checking passes
- [x] 3.3 Contract test passes for the new route
- [x] 3.4 New topbar `Settings` link has matching `dark:` companion

#### Manual

- [ ] 3.5 `/dashboard/settings` shows current values
- [ ] 3.6 Display currency change persists and re-renders dashboard
- [ ] 3.7 Light theme visibly changes every page
- [ ] 3.8 System theme follows `prefers-color-scheme`
- [ ] 3.9 Topbar `Settings` ↔ `Dashboard` navigation works both ways

### Phase 4: Display currency wiring

#### Automated

- [ ] 4.1 `npm run lint` passes
- [ ] 4.2 TypeScript type checking passes
- [ ] 4.3 Existing tests pass
- [ ] 4.4 No hardcoded `"USD"` remains in `src/pages`

#### Manual

- [ ] 4.5 No-snapshot user sees their preferred currency
- [ ] 4.6 Single-currency snapshot history renders no banner
- [ ] 4.7 Mixed-currency history shows banner + per-point currency in tooltip
- [ ] 4.8 Dashboard and assets page both reflect stored preference

### Phase 5: Per-handler integration tests

#### Automated

- [ ] 5.1 `npm run test:run` — all 8 scenarios pass, no regression
- [ ] 5.2 `npm run lint` passes
- [ ] 5.3 TypeScript type checking passes

#### Manual

- [ ] 5.4 Test file contains visible `.eq('user_id', user.id)` structural pin
