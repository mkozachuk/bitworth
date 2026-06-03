# Mobile Refactor Implementation Plan

## Overview

Ship the S-06 mobile-refactor slice: make the dashboard, assets list, and asset forms usable on a phone-sized viewport (~360px) without horizontal scrolling, truncated labels, or wrapped buttons. This is a pure UI refactor — no API, schema, or business-logic changes. The slice sets the responsive-design precedent for S-07 (asset list reflow) and S-08 (PWA install banner), both of which depend on a working mobile topbar.

## Current State Analysis

The authed surface is small (5 Astro pages + 1 shared Topbar + 9 React components per `research.md` §1) and the mobile-fragile hotspots are concentrated in **three places**:

1. **Topbar.astro:5-39** — single non-wrapping `flex justify-between` with email on the left and 3 nav links + sign-out form on the right. At 360px the right-side controls need ~256px and the email adds ~180px, leaving the content area ~80px shy of the 328px content width (research.md §2 Topbar overflow math).
2. **AssetForm.tsx:124, NetWorthDisplay.tsx:201, 227** — three fixed `grid-cols-2` blocks that never collapse to stack on narrow viewports. The AssetForm submit/cancel row at L329 also uses `flex-1` buttons that squeeze at 360px.
3. **dashboard.astro:89-98** — full second sign-out surface below all dashboard content. The Topbar already provides sign-out on every authed page; the dashboard copy is provably redundant.

The codebase has **no established responsive convention** — only `Welcome.astro` uses `sm:`/`md:`/`lg:` classes. Tailwind v4 is loaded via `@tailwindcss/vite` with no custom config (`astro.config.mjs:6,14`); full stock Tailwind defaults are available. The only Radix dep is `@radix-ui/react-slot` (used internally by `Button.asChild`) — no menu/popover/dialog primitives.

### Key Discoveries:

- The `Button` component already exposes a `size: "icon"` variant (`button.tsx:25` → 36×36 square). It is **dead code** — zero usages across `src/`. The roadmap suggested adding an `IconButton`; the right answer is to **adopt** the existing API, not add a new component. (`research.md` §4)
- The sign-out API route is a simple POST → `supabase.auth.signOut()` → redirect `/` (`src/pages/api/auth/signout.ts`, 10 lines). The two existing sign-out surfaces both POST to this route; consolidating to one surface is a pure markup change.
- Every authed page is pure-SSR Astro with React islands mounted via `client:load`. Currently **zero hydration on the Topbar** — adding a menu trigger makes it the first piece of client-side JS on the chrome. To keep the cost minimal, only the mobile menu is a React island; the rest of the Topbar stays Astro markup.
- The two existing sign-out forms are `<form method="POST" action="/api/auth/signout">` — no JS. The mobile menu's "Sign out" item can use the same form pattern (no `fetch` + redirect), preserving the no-JS-for-mutation contract.

## Desired End State

After this plan ships, a user on a 360px viewport can:

1. Open `/dashboard` and see a Topbar that fits without horizontal scroll: truncated email on the left, single menu trigger on the right.
2. Tap the menu trigger to open a Radix dropdown containing Dashboard / Assets / Settings / Sign out. Tap Sign out to POST to `/api/auth/signout` and be redirected to `/`.
3. Open `/dashboard/assets` and see the "Assets" header + "+ Add Asset" button in a row that fits (the existing `flex justify-between` already works at 360px because the h1 truncates and the button is short — verified visually during Phase 2).
4. Open `/dashboard/assets/new` or `/dashboard/assets/[id]/edit` and see the form fields stack vertically on <sm (Amount above Currency, save above cancel). Form is centered at `max-w-lg` (512px) on desktop.
5. Open `/dashboard` and see the Net Worth card with Assets/Liabilities and delta indicators stacked on <sm (one per row), side-by-side on ≥sm.
6. On ≥1024px (desktop), every page renders byte-identically to the current state — no visual regressions from the mobile pass.

### Verification:

- Manual browser check at 360px and 1280px for all 5 authed pages, per phase.
- `npm run lint` and `npm run build` pass on every commit.
- Desktop visual diff (≥1024px) is unchanged from the pre-S-06 baseline.

## What We're NOT Doing

- **`AssetList` table-to-card reflow** — explicitly deferred to S-07 (`roadmap.md` §S-06, confirmed 2026-06-01). The `<table>` will continue to overflow horizontally on <sm; this is acceptable for S-06 because adding/changing assets works (forms are mobile-friendly), and viewing the list is a desktop-primary use case until S-07.
- **New `IconButton` component** — the existing `size: "icon"` variant on `Button` is the primitive; we adopt it, not add a new alias.
- **PWA / install banner** — out of scope (S-08). The Radix dropdown we add here is the primitive S-08 will reuse.
- **Other responsive surfaces** — auth pages (`/auth/signin`, `/auth/signup`) are already incidentally responsive via centered `max-w-sm`. The landing page (`/`) is not authed and out of scope.
- **Back-link icon-only treatment on asset new/edit pages** — `← Back to Assets` fits at 360px. Not a hotspot.
- **Visual diff tooling (Playwright, Storybook)** — out of scope per `user-settings/plan-brief.md` "Out of scope" §9. Verification is manual.
- **Crypto panel internal grid re-layout in AssetForm** — same fix as the Amount/Currency grid (`grid-cols-1 sm:grid-cols-2`) covers the crypto panel too. The 3 inputs (symbol, quantity, total) stack to single column on <sm and pair nicely at ≥sm.

## Implementation Approach

**Pure Tailwind responsive classes, no new layout primitives.** Add one React island (a `<TopbarMenu>`) for the Radix dropdown. The rest of the changes are inline class edits on existing markup.

**Pattern**: `grid grid-cols-1 sm:grid-cols-2` and `flex flex-col sm:flex-row` — same visual at ≥sm, stacked at <sm. This is the cheapest, most consistent responsive primitive in the codebase and matches what `Welcome.astro` already does.

**Hydration strategy**: only the mobile menu trigger is a React island; the email span, the desktop nav anchors, and the existing sign-out form (on ≥sm) stay pure Astro. The mobile menu's "Sign out" item renders a `<form method="POST">` so submission is a no-JS form post — same pattern as the current Topbar.

**Phasing**: 4 phases, 1 commit each. Phases 1 is a no-visible-diff prep step; Phase 2 introduces the new client-side JS; Phases 3–4 are pure CSS class edits with zero new components.

## Critical Implementation Details

- **Hydration boundary on the Topbar**: Astro pages currently have zero hydration on the Topbar element. Promoting the *entire* Topbar to a React island would force every authed page to download React on first paint. The right shape: keep `Topbar.astro` as Astro markup, add a small `<TopbarMenu client:load />` React island inside it that renders only the mobile menu trigger + Radix dropdown. The island is invisible on ≥sm (CSS `hidden sm:block`-style or conditional render) and only mounts interactive UI on <sm. This keeps the desktop experience byte-identical and the hydration cost to a single small island.
- **Sign-out inside a Radix menu item**: Radix `DropdownMenu.Item` can render arbitrary content, including a `<form>`. The mobile menu's "Sign out" item is a `<DropdownMenu.Item asChild>` wrapping a `<form method="POST" action="/api/auth/signout">` with a `<button type="submit">` inside. The form pattern is identical to the existing Topbar sign-out (Astro) and the dashboard duplicate (being deleted). No new sign-out code path; no JS-based sign-out; no new endpoint.
- **Form page width `max-w-md` → `max-w-lg`**: at 360px the new `max-w-lg` (512px) is still larger than the viewport, so the page is full-width minus `px-4` (i.e. the existing `mx-auto max-w-lg px-4 py-8` pattern). The change is purely a desktop effect — the mobile layout is unchanged because `max-w-lg` exceeds the 360px content area.

## Phase 1: Cleanup & dependency

### Overview

Delete the duplicate sign-out form in `dashboard.astro` (L89-98) and add `@radix-ui/react-dropdown-menu` to `package.json` so Phase 2 can import it. No visible diff yet; this is a prep phase.

### Changes Required:

#### 1. Delete duplicate sign-out

**File**: `src/pages/dashboard.astro`

**Intent**: Remove the second sign-out form below the dashboard content. The Topbar is the single source of truth on every authed page (rendered on L36), so the dashboard copy is redundant.

**Contract**: Delete lines 89-98 (the `<div class="mt-6 flex justify-end">` wrapper and its inner `<form method="POST" action="/api/auth/signout">` + button). No replacement.

#### 2. Add Radix dropdown menu dependency

**File**: `package.json`

**Intent**: Add `@radix-ui/react-dropdown-menu` so the Topbar can use a headless accessible menu primitive. Single small dep; the only other Radix package already in the project is `@radix-ui/react-slot` (used internally by `Button.asChild`).

**Contract**: Add `"@radix-ui/react-dropdown-menu": "^2.1.x"` to `dependencies`. Run `npm install`. Verify the package appears in `package.json` and `package-lock.json`. No usage in this phase — Phase 2 imports it.

### Success Criteria:

#### Automated Verification:

- 1.1 `npm run lint` passes
- 1.2 `npm run build` passes
- 1.3 `package.json` contains `"@radix-ui/react-dropdown-menu"` in `dependencies`
- 1.4 Grep `dashboard.astro` for `/api/auth/signout` returns a single hit (the deleted copy is gone; the only remaining occurrence is in `Topbar.astro`)

#### Manual Verification:

- 1.5 Open `/dashboard` in a browser. The "Sign out" button below the empty-state card is gone. The Topbar's "Sign out" link still works (click it → POST to `/api/auth/signout` → redirect to `/`).
- 1.6 Open `/dashboard` on a 360px viewport. The page renders identically to the pre-phase-1 state (no other elements changed). Topbar still has the original overflow behavior — that fix lands in Phase 2.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Topbar refactor

### Overview

Refactor `Topbar.astro` to use a Radix dropdown menu on <sm, with the email truncated and a single menu trigger. The desktop ≥sm layout is unchanged: email on the left, three nav anchors + a text-link sign-out form on the right. The new `TopbarMenu` is a small React island; the rest of the Topbar stays Astro.

### Changes Required:

#### 1. Create `TopbarMenu` React component

**File**: `src/components/TopbarMenu.tsx` (new)

**Intent**: Render the Radix dropdown menu used on <sm. Contains a Menu trigger button (hamburger icon) and a Radix `DropdownMenu.Content` with four items: Dashboard, Assets, Settings, Sign out. The Sign out item wraps a `<form method="POST" action="/api/auth/signout">` so submission is a no-JS form post.

**Contract**: Default-exported React component. Props: `{ user: { email: string } }` (read from `Astro.locals.user` at the call site, passed in). Renders `<DropdownMenu.Root>` from `@radix-ui/react-dropdown-menu` with a `Menu` icon (lucide-react) trigger and a `DropdownMenu.Portal` content. The Sign out `DropdownMenu.Item` uses `asChild` and wraps a `<form>` (Radix `Slot` passes through). The component is mounted only on the mobile path; the parent (Topbar.astro) hides it on ≥sm via `hidden sm:block`.

#### 2. Refactor `Topbar.astro` to add the mobile menu

**File**: `src/components/Topbar.astro`

**Intent**: Add a Radix-powered mobile menu trigger visible only on <sm. Truncate the email on <sm. Keep the desktop ≥sm layout byte-identical.

**Contract**: Same outer `<div>` (`mb-4 flex items-center justify-between rounded-xl border ...`). Same user/anon branching. Inside the authed branch:
- Left side: `<span>` with `class="max-w-[140px] truncate ..."` (truncates the email on <sm, irrelevant on ≥sm).
- Right side: a wrapper `<div class="flex items-center gap-3">` containing:
  - The three existing nav anchors (`<a>` for Dashboard / Assets / Settings) with `class="hidden sm:inline-flex ..."` (hidden on <sm, visible on ≥sm).
  - The existing sign-out form with `class="hidden sm:block"` (hidden on <sm, visible on ≥sm).
  - `<TopbarMenu user={{ email: user.email }} client:load />` with `class="sm:hidden"` (visible on <sm, hidden on ≥sm).

In the anon branch (not signed in), no menu — keep the existing two nav anchors as-is. (The S-06 outcome is "authed surfaces" mobile-usable; the anon sign-in / sign-up nav already fits because it has only two short items.)

Import: add `import TopbarMenu from "./TopbarMenu";` at the top.

### Success Criteria:

#### Automated Verification:

- 2.1 `npm run lint` passes
- 2.2 `npm run build` passes
- 2.3 `npx astro check` passes (no broken imports)
- 2.4 Grep `Topbar.astro` for `TopbarMenu` returns one import + one usage
- 2.5 Grep `TopbarMenu.tsx` for `@radix-ui/react-dropdown-menu` and `<form method="POST" action="/api/auth/signout"` each return one hit

#### Manual Verification:

- 2.6 On 360px viewport: Topbar shows truncated email on the left, single menu trigger on the right. No horizontal scroll. Tap the trigger → menu opens with 4 items. Tap "Sign out" → POST to `/api/auth/signout` → redirect to `/`. Tap outside the menu → menu closes. Press Escape → menu closes.
- 2.7 On 1280px viewport: Topbar renders **byte-identically** to the pre-phase-2 state. Email on the left, three nav anchors + "Sign out" on the right. No menu trigger visible. No `<TopbarMenu>` hydration cost on the desktop path.
- 2.8 Tap each nav item in the mobile menu (Dashboard / Assets / Settings) → navigates to the correct page, menu closes.
- 2.9 On 768px viewport (md breakpoint): desktop nav is visible (matches ≥sm behavior). The menu trigger is hidden. Verify the breakpoint edge with the browser DevTools device toolbar.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Component grids

### Overview

Collapse the three fixed `grid-cols-2` blocks in `AssetForm.tsx` and `NetWorthDisplay.tsx` to stack on <sm. Also tighten the submit/cancel row in `AssetForm.tsx` so the buttons stack on <sm instead of squeezing.

### Changes Required:

#### 1. AssetForm Amount/Currency grid collapse

**File**: `src/components/assets/AssetForm.tsx`

**Intent**: Make the Amount and Currency fields stack on <sm (full width each) and sit side-by-side on ≥sm (existing visual). Matches the project pattern of "mobile-first stack, ≥sm grid" set by `Welcome.astro`.

**Contract**: At line 124, change `className="grid grid-cols-2 gap-4"` to `className="grid grid-cols-1 gap-4 sm:grid-cols-2"`. The two child `<div>` wrappers for Amount and Currency inputs are unchanged.

#### 2. AssetForm crypto panel grid collapse

**File**: `src/components/assets/AssetForm.tsx`

**Intent**: The crypto panel (lines 193-310) has 3 vertically-stacked inputs (Crypto Symbol, Quantity, Total Value) inside a `<div className="space-y-4 rounded-lg border ...">`. Each input is already a single column (each in its own `<div>`), so the panel itself does not have a horizontal `grid-cols-2` to collapse. **Verify during implementation that the panel renders correctly on <sm without changes.** If the panel needs a grid collapse at any inner point, apply the same `grid-cols-1 sm:grid-cols-2` pattern. No change expected.

**Contract**: No code change unless verification reveals a horizontal squeeze. If a change is required, it follows the same pattern as change 1 above. Document any change in the commit message.

#### 3. AssetForm submit/cancel row collapse

**File**: `src/components/assets/AssetForm.tsx`

**Intent**: The submit/cancel `flex gap-3` row at line 329 uses `flex-1` on the primary button and `px-4` on both, which squeezes at 360px. Stack the buttons vertically on <sm so each takes full width, and sit them side-by-side on ≥sm.

**Contract**: At line 329, change `className="flex gap-3 pt-2"` to `className="flex flex-col gap-3 pt-2 sm:flex-row"`. The two children (the `Button` and the cancel `<button>`) keep their existing classes — `flex-1` is still desirable on ≥sm (each button takes half the row) and on <sm each button already takes the full row width because of `flex-col`. **No need to change `flex-1` to `w-full` on either button** — the existing `flex-1` produces the right width in both directions under the new flex direction.

#### 4. NetWorthDisplay Assets/Liabilities grid collapse

**File**: `src/components/assets/NetWorthDisplay.tsx`

**Intent**: Stack the Assets and Liabilities cells on <sm so the labels and values aren't squeezed to ~150px each.

**Contract**: At line 201, change `className="mb-4 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 dark:border-white/10"` to `className="mb-4 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-white/10"`. The two child `<div>` wrappers for Assets and Liabilities are unchanged.

#### 5. NetWorthDisplay delta indicators grid collapse

**File**: `src/components/assets/NetWorthDisplay.tsx`

**Intent**: Stack the "vs Last Month" and "vs Jan 1st" delta indicators on <sm. Same reasoning as the Assets/Liabilities grid.

**Contract**: At line 227, change `className="mb-4 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 dark:border-white/10"` to `className="mb-4 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-white/10"`. The conditional children (DeltaIndicator or "No baseline" placeholder) are unchanged.

### Success Criteria:

#### Automated Verification:

- 3.1 `npm run lint` passes
- 3.2 `npm run build` passes
- 3.3 Grep `AssetForm.tsx` for `grid-cols-2` returns zero hits
- 3.4 Grep `NetWorthDisplay.tsx` for `grid-cols-2` returns zero hits
- 3.5 Grep `AssetForm.tsx` for `grid-cols-1 sm:grid-cols-2` returns one hit (the Amount/Currency grid at L124)
- 3.6 Grep `NetWorthDisplay.tsx` for `grid-cols-1 sm:grid-cols-2` returns two hits (L201 and L227)

#### Manual Verification:

- 3.7 On 360px viewport, open `/dashboard/assets/new` (asset form): Name is full-width; Amount and Currency are stacked full-width each; Category is full-width; (if crypto selected) Symbol / Quantity / Total are stacked full-width each; Notes is full-width; Save and Cancel buttons are stacked full-width each. No horizontal scroll inside the form card.
- 3.8 On 360px viewport, open `/dashboard`: Net Worth card shows the Net Worth number, then Assets and Liabilities stacked (one per row with full-width value), then (if snapshots exist) "vs Last Month" and "vs Jan 1st" stacked. No horizontal scroll inside the card.
- 3.9 On 1280px viewport, both pages render **byte-identically** to the pre-phase-3 state: Amount/Currency side-by-side, Assets/Liabilities side-by-side, deltas side-by-side, Save/Cancel side-by-side with `flex-1`. Desktop visual is unchanged.
- 3.10 Form validation still works: submit empty form → all required-field errors appear under the correct field. Submit valid form (non-crypto) → POSTs to `/api/assets`, navigates to `/dashboard/assets`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Form page widths

### Overview

Widen the asset form pages (`new.astro`, `edit.astro`) from `max-w-md` (448px) to `max-w-lg` (512px) to give the form more breathing room on desktop ≥md viewports. Mobile layout is unchanged because `max-w-lg` still exceeds the 360px content area.

### Changes Required:

#### 1. Widen `/dashboard/assets/new` page wrapper

**File**: `src/pages/dashboard/assets/new.astro`

**Intent**: Give the asset form a wider container on desktop. Mobile is unchanged (the page is already full-width minus `px-4` at 360px).

**Contract**: At line 16, change `class="mx-auto max-w-md px-4 py-8"` to `class="mx-auto max-w-lg px-4 py-8"`.

#### 2. Widen `/dashboard/assets/[id]/edit` page wrapper

**File**: `src/pages/dashboard/assets/[id]/edit.astro`

**Intent**: Same as above, for the edit page.

**Contract**: At line 36, change `class="mx-auto max-w-md px-4 py-8"` to `class="mx-auto max-w-lg px-4 py-8"`.

### Success Criteria:

#### Automated Verification:

- 4.1 `npm run lint` passes
- 4.2 `npm run build` passes
- 4.3 Grep `new.astro` and `edit.astro` for `max-w-md` returns zero hits
- 4.4 Grep `new.astro` and `edit.astro` for `max-w-lg` returns one hit each

#### Manual Verification:

- 4.5 On 360px viewport, both `/dashboard/assets/new` and `/dashboard/assets/[id]/edit` render identically to the pre-phase-4 state: page is full-width minus `px-4`, form card has the same padding, no horizontal scroll.
- 4.6 On 1280px viewport, both pages now have a 512px-wide centered container (was 448px). The form's inner 2-col grid has visibly more room. No regression on the form card's rounded-2xl border, padding, or background.
- 4.7 On 768px viewport (md): the 512px container is centered, with wider empty sides than before. The form still fits comfortably.

**Implementation Note**: After completing this phase and all automated verification passes, the human confirms the final manual pass at 360px and 1280px covers all 5 authed pages (dashboard, assets list, asset new, asset edit, settings). Phase 4 closes out S-06.

---

## Testing Strategy

### Manual tests (per phase, both viewports):

- **Phase 1**: `/dashboard` at 360px and 1280px. No Topbar change. Sign out via Topbar still works. Duplicate dashboard sign-out is gone.
- **Phase 2**: All 5 authed pages at 360px and 1280px. Topbar behavior matches the success criteria (truncated email + menu trigger on <sm; byte-identical on ≥sm). Menu interactions (open / close / select / Escape).
- **Phase 3**: Asset new/edit + dashboard at 360px and 1280px. Form grids stack on <sm, sit side-by-side on ≥sm. NetWorthDisplay cards stack on <sm, sit side-by-side on ≥sm. Submit/cancel buttons stack on <sm, sit side-by-side on ≥sm.
- **Phase 4**: Asset new/edit at 360px and 1280px. Mobile is unchanged. Desktop is wider (448px → 512px).

### Automated checks (every commit):

- `npm run lint` — catches Tailwind class typos, unused imports, ESLint regressions.
- `npm run build` — confirms Astro can compile the new `TopbarMenu` island, no broken imports, no type errors.
- Grep checks — confirm the structural changes landed (e.g. `grid-cols-2` is gone, `max-w-lg` is present).

### Out of scope:

- No new test files. No new API routes. No schema changes. No new dependencies beyond `@radix-ui/react-dropdown-menu`.
- No Playwright / visual diff tooling (per `user-settings/plan-brief.md` "Out of scope" §9).
- No DOM integration tests on the dashboard render (`test-plan.md` §3 Phase 1 deferral still stands).

## Performance Considerations

- **Hydration cost**: Phase 2 introduces the first React island on the Topbar. The island is small (one Radix dropdown, four menu items, one lucide icon). Estimated client-side JS: ~10 KB gzip for Radix dropdown + ~2 KB for the island. This is paid on every authed page (dashboard, assets list/new/edit, settings — 5 pages). Mitigation: the island is hidden on ≥sm via CSS (`sm:hidden`), so desktop users still pay the cost unless we add dynamic import. Acceptable for S-06; S-08 may revisit with `@serwist/astro` SW caching.
- **CSS cost**: no new utility classes, no new tokens, no custom CSS. Tailwind's purge already handles the new responsive variants.

## Migration Notes

- No database changes. No API changes. No new env vars.
- `package.json` adds one dep (`@radix-ui/react-dropdown-menu`). Both Cloudflare runtime secrets and build env vars are unchanged.
- Rollback per phase: revert the commit. No data migration. No deprecation window needed.

## References

- Research: `context/changes/mobile-refactor/research.md`
- Roadmap slice: `context/foundation/roadmap.md` §S-06 (lines 136-148)
- GitHub issue: [#15](https://github.com/mkozachuk/bitworth/issues/15)
- Sibling plan for format: `context/changes/user-settings/plan-brief.md`
- Hotspot files (per research):
  - `src/components/Topbar.astro:5-39`
  - `src/pages/dashboard.astro:89-98` (deleted in Phase 1)
  - `src/components/assets/AssetForm.tsx:124, 329`
  - `src/components/assets/NetWorthDisplay.tsx:201, 227`
  - `src/pages/dashboard/assets/new.astro:16`
  - `src/pages/dashboard/assets/[id]/edit.astro:36`
  - `src/components/ui/button.tsx:25` (existing `size: "icon"` primitive)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cleanup & dependency

#### Automated

- [x] 1.1 `npm run lint` passes — 8c7a58a
- [x] 1.2 `npm run build` passes — 8c7a58a
- [x] 1.3 `package.json` contains `"@radix-ui/react-dropdown-menu"` in `dependencies` — 8c7a58a
- [x] 1.4 Grep `dashboard.astro` for `/api/auth/signout` returns a single hit — 8c7a58a

#### Manual

- [x] 1.5 `/dashboard` at 1280px: duplicate sign-out button below content is gone; Topbar sign-out still works — 8c7a58a
- [x] 1.6 `/dashboard` at 360px: page renders identically to pre-phase-1 state — 8c7a58a

### Phase 2: Topbar refactor

#### Automated

- [x] 2.1 `npm run lint` passes — cb79ceb
- [x] 2.2 `npm run build` passes — cb79ceb
- [x] 2.3 `npx astro check` passes — cb79ceb
- [x] 2.4 Grep `Topbar.astro` for `TopbarMenu` returns one import + one usage — cb79ceb
- [x] 2.5 Grep `TopbarMenu.tsx` for `@radix-ui/react-dropdown-menu` and `<form method="POST" action="/api/auth/signout"` each return one hit — cb79ceb

#### Manual

- [ ] 2.6 `/dashboard` at 360px: truncated email + menu trigger, no horizontal scroll, menu opens/closes/Sign out works
- [ ] 2.7 `/dashboard` at 1280px: byte-identical to pre-phase-2 state
- [ ] 2.8 Mobile menu nav items (Dashboard / Assets / Settings) navigate correctly
- [ ] 2.9 `/dashboard` at 768px (md breakpoint): desktop nav visible, menu trigger hidden

### Phase 3: Component grids

#### Automated

- [x] 3.1 `npm run lint` passes — 0b96b37
- [x] 3.2 `npm run build` passes — 0b96b37
- [x] 3.3 Grep `AssetForm.tsx` for `grid-cols-2` returns zero hits — 0b96b37
- [x] 3.4 Grep `NetWorthDisplay.tsx` for `grid-cols-2` returns zero hits — 0b96b37
- [x] 3.5 Grep `AssetForm.tsx` for `grid-cols-1 sm:grid-cols-2` returns one hit — 0b96b37
- [x] 3.6 Grep `NetWorthDisplay.tsx` for `grid-cols-1 sm:grid-cols-2` returns two hits — 0b96b37

#### Manual

- [x] 3.7 `/dashboard/assets/new` at 360px: form fields stack, no horizontal scroll — 0b96b37
- [x] 3.8 `/dashboard` at 360px: Net Worth card stacks Assets/Liabilities + deltas — 0b96b37
- [x] 3.9 Asset new/edit + dashboard at 1280px: byte-identical to pre-phase-3 state (grids side-by-side) — 0b96b37
- [x] 3.10 Asset form validation still works end-to-end — 0b96b37

### Phase 4: Form page widths

#### Automated

- [x] 4.1 `npm run lint` passes
- [x] 4.2 `npm run build` passes
- [x] 4.3 Grep `new.astro` and `edit.astro` for `max-w-md` returns zero hits
- [x] 4.4 Grep `new.astro` and `edit.astro` for `max-w-lg` returns one hit each

#### Manual

- [ ] 4.5 Asset new/edit at 360px: identical to pre-phase-4 state
- [ ] 4.6 Asset new/edit at 1280px: 512px-wide centered container
- [ ] 4.7 Asset new/edit at 768px: 512px container centered with wider empty sides
