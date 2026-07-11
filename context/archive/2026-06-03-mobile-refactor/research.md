---
date: 2026-06-03 03:19 CEST
researcher: claude-opus-4
git_commit: a64f2222d400710aca0972c403e9ef58e8c8a7d7
branch: master
repository: bitworth
topic: "S-06 Mobile refactor — authed surfaces, responsive patterns, sign-out consolidation, IconButton prep"
tags: [research, mobile-refactor, responsive-ui, sign-out, icon-button, s-06]
status: complete
last_updated: 2026-06-03
last_updated_by: claude-opus-4
---

# Research: S-06 Mobile refactor

**Date**: 2026-06-03 03:19 CEST
**Researcher**: claude-opus-4
**Git Commit**: `a64f2222d400710aca0972c403e9ef58e8c8a7d7`
**Branch**: master
**Repository**: bitworth
**GitHub permalink prefix**: `https://github.com/mkozachuk/bitworth/blob/a64f2222d400710aca0972c403e9ef58e8c8a7d7`

## Research Question

Pre-plan research for the S-06 mobile-refactor slice (see `context/foundation/roadmap.md` §S-06). Goals, in priority order:

1. Inventory every authed surface and shared component so the planner knows the full attack surface.
2. Audit responsive patterns already in use (Tailwind breakpoint classes, layout primitives, viewport-aware JS) to identify what's reusable vs what must be introduced.
3. Resolve the two open questions flagged in the roadmap: (a) collapse the duplicated "Sign out" buttons, (b) decide whether an `IconButton` variant of `src/components/ui/button.tsx` is warranted.

Out of scope (deferred to S-07): the `AssetList` table-to-card reflow.

## Summary

The authed surface is small — 5 Astro pages + 1 shared Topbar + 1 shared Layout + ~9 React components. The mobile-fragile hotspots are concentrated in **three places**: (1) the shared `Topbar.astro` which packs an email + 3 nav links + sign-out form into a single non-wrapping flex row that **mathematically overflows at 360px**; (2) two components that hard-code `grid-cols-2` and never collapse (`AssetForm.tsx:124`, `NetWorthDisplay.tsx:201,227`); and (3) the `AssetList` table (already excluded from S-06 scope). The auth pages (`signin`, `signup`) are incidentally responsive because they use a centered `max-w-sm` card.

The codebase has **no responsive design convention** — only `Welcome.astro` uses `sm:`/`lg:` classes, and only the auth pages reach a responsive layout through width constraints. No `useMediaQuery`, no headless menu/drawer library, no `Container` primitive. Tailwind v4 is loaded via `@tailwindcss/vite` with no custom config (`astro.config.mjs:6,14`).

**Sign-out duplication**: `dashboard.astro:89-98` is a full second sign-out surface below all dashboard content. The Topbar already provides sign-out on every authed page (including the dashboard). **Recommended: delete the dashboard copy outright** — no replacement, no new code, no new deps. This is the simplest correct fix.

**IconButton**: not needed. The `Button` component already exposes a `size: "icon"` variant (`button.tsx:25`) producing a 36×36 square button. It is currently **dead code** — zero usages across `src/`. The reason callers haven't adopted it: the only icon-only buttons in the codebase live inside Astro files (where importing a React `Button` would force island hydration) or inside existing hand-rolled slots like `PasswordToggle.tsx`. No new `IconButton` component is warranted; what is warranted is **consumer adoption**, which the planner can address by example in this slice.

**Hamburger menu**: there is no installed headless menu/popover primitive. The only Radix package in `package.json` is `@radix-ui/react-slot` (used internally by `Button.asChild`). If S-06 wants the Topbar nav to collapse into a hamburger on narrow viewports, adding `@radix-ui/react-dropdown-menu` is the lightest path — but it is a **decision the planner must call out explicitly**, not a default.

## Detailed Findings

### 1. Authed surface inventory

The authed surface area is small enough to enumerate fully. All routes are gated by `src/middleware.ts:4` (`PROTECTED_ROUTES = ["/dashboard"]`).

| File | Wrapper | Topbar? | Notable mobile-fragile pattern |
|---|---|---|---|
| `src/pages/dashboard.astro` | `mx-auto max-w-3xl px-4 py-8` (L37) | yes (L3, L36) | Three React islands stack vertically with no responsive grid; duplicate sign-out form (L89-98) |
| `src/pages/dashboard/assets/index.astro` | `mx-auto max-w-3xl px-4 py-8` (L34) | yes (L3, L33) | Header `flex items-center justify-between` (L35) with h1 + "+ Add Asset" on one row; table deferred to S-07 |
| `src/pages/dashboard/assets/new.astro` | `mx-auto max-w-md px-4 py-8` (L16) | yes (L3, L15) | `max-w-md` (448px) is too narrow for desktop; form internals include fixed `grid-cols-2` (see below) |
| `src/pages/dashboard/assets/[id]/edit.astro` | `mx-auto max-w-md px-4 py-8` (L36) | yes (L3, L35) | Same shape as `new.astro` |
| `src/pages/dashboard/settings.astro` | `mx-auto max-w-2xl px-4 py-8` (L39) | yes (L3, L38) | Cleanest of the authed pages — `SettingsForm` uses `w-full` inputs, no fragility |

**Shared chrome**:
- `src/components/Topbar.astro` — one-row `flex items-center justify-between px-4 py-2` (L5-6). Email on the left; 3 nav anchors + a sign-out form on the right inside `flex items-center gap-3` (L12). **The biggest mobile hotspot**: at 360px viewport the right-side controls (Dashboard / Assets / Settings / Sign out) need ~256px after gaps, and the email on the left adds another ~180px, leaving ~80px shy of the 328px content area. There is no `sm:`/`md:` breakpoint, no `flex-wrap`, no hamburger.
- `src/layouts/Layout.astro` — bare `<html lang="en">` with `meta viewport="width=device-width"` (L18) and an inline theme-detection script (L21-32). No max-width, no padding, no font at the layout level — each page picks its own `max-w-*` and `px-4 py-8`. No `<header>`/nav at the layout level; the Topbar is rendered per-page.

**Shared components (post-inventory)**:

| Component | Posture | Mobile concern |
|---|---|---|
| `NetWorthChart.tsx` | desktop-only | `ResponsiveContainer` with `height={300}` fixed (L118); `initialDimension` is a SSR hint, not responsive |
| `SettingsForm.tsx` | desktop-only but safe | stacked `space-y-6`; inputs `w-full`; no fragility |
| `AssetForm.tsx` | **needs work** | L124: `grid grid-cols-2 gap-4` for Amount/Currency — never collapses; crypto panel (L193-310) is also a fixed 2-col block; submit/cancel `flex gap-3` row (L329) — both buttons `flex-1 px-4` may squeeze at 360px |
| `AssetList.tsx` | **out of scope (S-07)** | raw `<table>` (L92-112); no responsive card mode, no horizontal-scroll wrapper |
| `AssetRow.tsx` | desktop-only | notes `max-w-[200px] truncate` (L23) is the only explicit cap |
| `NetWorthDisplay.tsx` | **needs work** | L201, L227: two fixed `grid grid-cols-2 gap-4` (Assets/Liabilities and deltas) — never collapses to stack |
| `AssetsSummary.tsx` | safe | single column `space-y-2` (L46) |
| `CurrencyBadge.tsx` | safe | inline-flex pill |
| `CategorySelect.tsx` | safe | `w-full` select with `<optgroup>` |
| `auth/SubmitButton.tsx` | safe | full-width submit, spinner |
| `auth/SignInForm.tsx`, `auth/SignUpForm.tsx` | safe | stacked `space-y-4`; `w-full` inputs |
| `auth/FormField.tsx` | safe | `w-full`; `pl-10` for left icon (L6) |
| `auth/PasswordToggle.tsx` | safe | eye toggle absolute at `right-3` (L13) |
| `auth/ServerError.tsx` | safe | red error pill |

### 2. Responsive posture across the codebase

**No convention established.** Only `Welcome.astro` uses Tailwind responsive classes (`p-4 sm:p-8`, `py-24 sm:py-32 lg:py-40`, `text-5xl sm:text-6xl lg:text-7xl`, `flex-col sm:flex-row`, `grid-cols-1 sm:grid-cols-3` — L27-57). Every other authed surface has **zero** `sm:`/`md:`/`lg:`/`xl:`/`2xl:` viewport classes. The two auth pages (`signin.astro`, `signup.astro`) reach a responsive look incidentally through a centered `max-w-sm` card inside `flex min-h-screen items-center justify-center p-4`.

**Tailwind setup**: v4 loaded via `@tailwindcss/vite` plugin (`astro.config.mjs:6,14`). No `tailwind.config.*` file, no custom breakpoints, no custom containers. Theme tokens are declared in `src/styles/global.css:75-111` using `@theme inline`. The user has full use of stock Tailwind defaults.

**Layout primitives**: zero. `src/lib/utils.ts` exports only `cn()`. No `<Container>`, no `<Section>`, no responsive wrapper. Every page that wants a max-width writes `mx-auto max-w-{sm|md|lg|xl|2xl|3xl} px-4 py-8` inline. This is the de-facto convention to extend.

**Viewport-aware JS**: one use of `matchMedia` in `src/layouts/Layout.astro:25` — `prefers-color-scheme` only, not layout. No `window.innerWidth`, no `useMediaQuery`, no `ResizeObserver`. The pattern is "render once at SSR, no resize handling".

**Padding/gap rhythm (consistent across the codebase)**:
- Page outer: `px-4 py-8` everywhere
- Card bodies: `p-6`/`p-8`
- Form fields: `space-y-4` (auth, AssetForm) or `space-y-6` (Settings)
- Button inner: `px-4 py-2`
- Topbar inner: `px-4 py-2`

The planner can rely on this rhythm; mobile work should preserve it.

**Hard-coded sizes to flag**:
- `NetWorthChart.tsx:118` — `ResponsiveContainer` width `100%`, height fixed `300`
- `Welcome.astro:8,12,16` — cosmic orbs `h-[350px] w-[350px]` (out of scope — Welcome is not authed)
- Banner `padding: 0.75rem 1rem` is in a scoped `<style>` block (`Banner.astro:17`) and won't change with viewport

**Topbar overflow math** (specifically requested by the question): `Topbar.astro:5-6` is `flex items-center justify-between px-4` on a `rounded-xl border ... bg-white/80` strip. Right side has 3 anchors + a `<form>` (4 items total) with `gap-3` (12px). At 360px viewport: 360 − 32 (px-4) = 328px content. A 30-char email ≈ 180px (variable-width font, Lucide etc.); 4 nav items + 3 gaps ≈ 4×55 + 3×12 = 256px. Total ≈ 436px > 328px. **Does not fit at 360px** — the only behavior in current code is for the right-side controls to either wrap awkwardly (no `flex-wrap`), get clipped, or push the email off-canvas.

### 3. Sign-out duplication — both surfaces

Two surfaces only, both POST to the same route:

1. `src/components/Topbar.astro:31-38` — inline `<form method="POST" action="/api/auth/signout">` with a text-link button. Visually identical to the surrounding nav anchors (L13-29): `text-purple-600 transition-colors hover:text-purple-800 hover:underline dark:text-purple-300 dark:hover:text-purple-100`. No icon.
2. `src/pages/dashboard.astro:89-98` — full-width card-style button below all dashboard content, inside `flex justify-end`. Classes: `rounded-lg border border-zinc-300 bg-white/80 px-4 py-2 text-sm text-zinc-700 ... dark:...`. No icon.

The Topbar is rendered on every authed page (dashboard, assets list/new/edit, settings). The dashboard page is the only one with the second surface.

API route: `src/pages/api/auth/signout.ts` (10 lines, POST, `supabase.auth.signOut()` then `redirect("/")`). Idempotent, same-origin, no CSRF token, no Origin check — low-impact, no security concern.

**Recommendation**: delete `dashboard.astro:89-98` outright. The Topbar is the single source of truth on every authed page. No new code, no new component, no new dep, zero risk of the two surfaces drifting. (Alternative considered: keep both, with the dashboard one styled as a card and the Topbar one as a link — rejected because there is no reason for two paths to the same endpoint in a 5-page app.)

### 4. IconButton — current state and recommendation

**Icon library**: `lucide-react ^1.14.0` is the only icon dep (`package.json:31`). Imported in 9 files:
- `auth/SignInForm.tsx:2` (Mail, Lock, LogIn)
- `auth/SignUpForm.tsx:2` (Mail, Lock, UserPlus)
- `auth/FormField.tsx:2` (CircleAlert)
- `auth/PasswordToggle.tsx:1` (Eye, EyeOff) — the closest existing analog of an icon-only button
- `auth/ServerError.tsx:1` (CircleAlert)
- `settings/SettingsForm.tsx:2` (Save)
- `assets/AssetForm.tsx:2` (Plus, Save)
- `assets/AssetRow.tsx:1` (Pencil, Trash2) — **edit/delete actions on the desktop table, candidate for icon-button adoption in S-07**
- `assets/AssetList.tsx:2` (InboxIcon, AlertCircle)
- `assets/CategorySelect.tsx:2` (CircleAlert)

No `Icon` wrapper component exists; icons are inlined at each call site. Canonical pattern: `<LogIn className="size-4" />`. The `buttonVariants` base style in `button.tsx:8` already styles inner SVGs (`[&_svg:not([class*='size-'])]:size-4`).

**Button audit** (`src/components/ui/button.tsx`, 51 lines):
- cva-based, variants: `default` / `destructive` / `outline` / `secondary` / `ghost` / `link`; sizes: `default` / `sm` / `lg` / `icon`.
- `icon` size is `"size-9"` (36×36 square, no padding). The `ghost` variant is `hover:bg-accent hover:text-accent-foreground` — semantically the right primitive for an icon-only trigger.
- **Usage of `Button`**: imported in only 2 files — `auth/SubmitButton.tsx:3`, `assets/AssetForm.tsx:3`. **Neither passes a `variant` or `size` prop.** Both override with custom purple styling (`className="...bg-purple-600..."`). The variant/size API is effectively unused.
- **`size="icon"` / `size: "icon"` / `size={{...icon}}`**: **ZERO hits across `src/`.** Dead code.
- **Raw `<button>` icon-only usages**: `auth/PasswordToggle.tsx:10` (eye toggle inside `FormField`), the two sign-out forms, and `assets/AssetForm.tsx:348` (Cancel — not icon-only). The PasswordToggle is the closest existing analog of an icon-only button and it is hand-rolled (absolutely positioned at `right-3`).

**Recommendation: do NOT add a new `IconButton` component.** The existing `size: "icon"` variant on `Button` already produces a 36×36 ghost button shaped for an icon. A new wrapper would be a pure alias and would add no behavioral value. The real gap is **consumer adoption** — callers haven't used the icon size because (a) most icon-only triggers live in `.astro` files where importing a React `Button` would force island hydration, and (b) nobody has needed an icon-only trigger until this slice.

For the planner, the practical path is to **use `Button` directly** (no new export) for any new icon-only triggers introduced in S-06. The `AssetRow.tsx` edit/delete pair is the highest-leverage adoption site — but that file is desktop-only and in scope for S-07, so S-06 can leave it as a "we should migrate this in S-07" footnote.

If the team later wants a discoverable shorthand, expose `IconButton` as a named re-export in `button.tsx` only — but the underlying primitive is the same.

### 5. Headless UI primitives — what's missing

Verified: no `@radix-ui/react-dropdown-menu`, no `@radix-ui/react-popover`, no `@radix-ui/react-dialog`, no `headlessui`, no `framer-motion`, no `vaul`, no `react-aria` anywhere in `package.json` or `src/`. The only Radix package is `@radix-ui/react-slot ^1.1.2` (used internally by `Button` for `asChild`).

**Implication for S-06**: if the Topbar nav (Dashboard / Assets / Settings / Sign out) is to collapse into a hamburger on narrow viewports, the codebase needs a new dep. `@radix-ui/react-dropdown-menu` is the lightest option — Radix is already partially adopted via `react-slot`, and the package is a single import with no global CSS. This is **a decision the planner must call out explicitly**, not something to paper over with a hand-rolled `details/summary` or `popover` polyfill.

**Cheaper alternative** (no new dep): keep the Topbar nav as-is on desktop, and on `<sm` show only the email + a single hamburger-shaped button that toggles a stacked menu **inside the same Topbar element**. This avoids the dropdown dep by using a small client-side island that just toggles a class. Trade-off: hand-rolled a11y (focus trap, ESC to close, click-outside) — Radix gives this for free.

## Code References

### Authed pages
- `src/pages/dashboard.astro:36-37` — Topbar rendered inside `mx-auto max-w-3xl px-4 py-8`
- `src/pages/dashboard.astro:89-98` — **duplicate sign-out form to delete**
- `src/pages/dashboard/assets/index.astro:34-35` — Topbar + `flex items-center justify-between` header (h1 + "+ Add Asset")
- `src/pages/dashboard/assets/new.astro:16` — `max-w-md` wrapper (too narrow for desktop, fine for mobile)
- `src/pages/dashboard/assets/[id]/edit.astro:36` — same `max-w-md` wrapper
- `src/pages/dashboard/settings.astro:39` — `max-w-2xl` wrapper, cleanest of the authed pages

### Shared components
- `src/components/Topbar.astro:5-39` — `flex items-center justify-between` with **non-wrapping** nav row; biggest mobile hotspot
- `src/components/Topbar.astro:31-38` — Topbar sign-out form (the one to keep)
- `src/components/assets/AssetForm.tsx:124` — `grid grid-cols-2 gap-4` for Amount/Currency (needs collapse)
- `src/components/assets/AssetForm.tsx:193-310` — crypto panel (3 inputs in fixed 2-col layout)
- `src/components/assets/AssetForm.tsx:329` — submit/cancel `flex gap-3` row
- `src/components/assets/NetWorthDisplay.tsx:201,227` — fixed `grid-cols-2` for Assets/Liabilities and deltas
- `src/components/assets/AssetList.tsx:92-112` — raw `<table>` (deferred to S-07)
- `src/components/assets/AssetRow.tsx:1,23` — Pencil/Trash2 imports; `max-w-[200px] truncate` on notes
- `src/components/NetWorthChart.tsx:118` — `ResponsiveContainer` with fixed `height={300}`

### UI primitives
- `src/components/ui/button.tsx:8` — base style includes `[&_svg:not([class*='size-'])]:size-4`
- `src/components/ui/button.tsx:18` — `ghost` variant
- `src/components/ui/button.tsx:25` — `icon` size (`"size-9"`, square, 36×36) — **dead code, zero usages**
- `src/components/auth/PasswordToggle.tsx:10-14` — hand-rolled icon button pattern (closest existing analog)

### Layout / middleware / API
- `src/layouts/Layout.astro:18` — `meta viewport="width=device-width"` (correct)
- `src/layouts/Layout.astro:25` — `matchMedia('(prefers-color-scheme: dark)')` (theme only, not layout)
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`
- `src/pages/api/auth/signout.ts` — 10 lines, idempotent POST → redirect `/`

### Configuration
- `astro.config.mjs:6,14` — `@tailwindcss/vite` plugin; no custom tailwind config
- `src/styles/global.css:75-111` — `@theme inline` token block
- `package.json:31` — `lucide-react ^1.14.0` (only icon dep)
- `package.json` — `@radix-ui/react-slot ^1.1.2` (only Radix dep; no menu/popover/dialog)

## Architecture Insights

1. **Pure-SSR, no JS by default**. Every authed page is an Astro file that renders the Topbar and then mounts a small set of React islands. The mobile refactor can largely stay in Astro markup (Tailwind responsive classes) and avoid paying hydration cost. The exception: the Topbar sign-out form is a `<form method="POST">` with no JS — it just works. A hamburger would be the **first piece of mobile UI that requires real client-side JS** on every authed page, which is a real cost (currently zero on `/dashboard`, `/settings`, `/assets/*`).

2. **The codebase's responsive footprint is currently a single file** (`Welcome.astro`). Whatever convention S-06 introduces will set the precedent for S-07 (asset table reflow) and S-08 (PWA). The cheapest precedent: **mobile-first Tailwind classes added inline** to existing markup, no new wrapper components, no new deps. The most expensive: a `<Container>`/`<Section>` primitive plus a headless menu lib.

3. **The `max-w-3xl / max-w-2xl / max-w-md` split is the only existing layout rhythm.** Mobile work should preserve it (don't tighten everything to `max-w-sm`), because at 1024px+ the desktop layout already works. The risk is a "spaghetti of breakpoint classes" if the planner tries to fix every component individually — better to fix the **two truly broken grids** (`AssetForm`, `NetWorthDisplay`) and the **one overflowing Topbar**, and leave the rest as `px-4 py-8` cards that naturally reflow.

4. **The `Button` component is half-built.** Variants/sizes are declared but no caller uses them. S-06 is a natural moment to either (a) adopt the existing API in new code (icon-only sign-out, icon-only back link, etc.) or (b) accept that the API is over-designed and trim it. The roadmap text already suggested adding an `IconButton` variant; the research finds the variant already exists and is unused, so the right answer is to **adopt, don't add**.

5. **No two sign-out surfaces should exist in a 5-page app.** The simplest correct fix (delete the dashboard copy) is the right one. Don't build a "compact" sign-out for the Topbar and a "full-width" sign-out for the dashboard — that's a design system that needs a reason.

## Open Questions for /10x-plan

1. **Hamburger menu: dep or no dep?** The Topbar at 360px needs to collapse. Options:
   - (A) Add `@radix-ui/react-dropdown-menu` — single small dep, free a11y. Cost: ~10 KB gzip; first hydration on every authed page.
   - (B) Hand-rolled `details/summary` (or a small island that toggles a class) — no dep, no a11y for free. Cost: hand-rolled focus trap, ESC, click-outside.
   - (C) Inline the four links into a stacked column on `<sm` (no menu) — simplest, but the Topbar still overflows if all 4 + email are visible.
   **Recommendation to planner**: (A) is the right call if S-08 (PWA) is on the horizon, since the install-banner / first-authed-visit patterns in S-08 will also need a menu primitive. (B) is the right call if S-08 is far away and S-06 is meant to be a tight, dep-free pass.

2. **Topbar visual treatment on `<sm`**. Even with a hamburger, what replaces the email display? Options: keep the email (truncate), hide the email, swap to a logo/initials. The planner should pick one and the Auth user identity context is already on `Astro.locals.user` (Topbar.astro:2).

3. **`AssetForm.tsx:124` and `NetWorthDisplay.tsx:201,227` grid collapses**. Three options: (A) `grid grid-cols-1 sm:grid-cols-2` — small change, big payoff; (B) full component re-layout (more disruptive); (C) leave as-is and accept 2-col at 360px with tight cells. **(A) is the recommendation** — same visual at ≥sm, stacks on mobile.

4. **Icon-only sign-out in Topbar**. If the planner adopts `Button variant="ghost" size="icon"`, the Topbar (Astro) must be promoted to a React island (or the sign-out must be moved to a separate small island). Cheaper alternative: keep the text-link sign-out, hide the label on mobile with `hidden sm:inline`. **Recommendation: hide-on-mobile** — no new component, no hydration, no visual diff on desktop.

5. **The `max-w-md` wrappers on `assets/new.astro` and `assets/[id]/edit.astro`**. At 360px a `max-w-md` (448px) wrapper is the **page width**, leaving no horizontal gutter. On desktop (≥768px) the 448px content is centered with wide empty sides. This is a desktop UX issue, not a mobile one, but the planner should consider widening to `max-w-lg` or `max-w-xl` to give the form more room on desktop, while leaving the form's internal layout (the `grid-cols-2` collapse) to be the mobile fix.

## Related Research

This is the first research artifact for `mobile-refactor`. Adjacent changes in the foundation that informed the scope:

- `context/foundation/roadmap.md` §S-06 — original scope statement, including the two flagged open questions (sign-out duplication, IconButton variant) and the explicit deferral of `AssetList` reflow to S-07.
- `context/foundation/roadmap.md` §S-07 — the follow-up slice that will inherit the responsive conventions S-06 establishes and tackle the `<table>` reflow.
- `context/foundation/roadmap.md` §S-08 — PWA slice that may need a menu/dropdown primitive for the iOS install banner; its needs are adjacent to S-06's Topbar.
- `context/foundation/lessons.md` §"Public API endpoints need explicit auth decisions" — the only lesson that touches the authed surface area; not directly mobile-relevant.

The five previous changes (`supabase-schema-migrations`, `asset-management`, `dashboard-snapshots-chart`, `crypto-price-fetch`, `dashboard-assets-summary`, `user-settings`) all built the desktop-first UI that S-06 now has to reflow. The closest in spirit is `user-settings` (most recent, just shipped) — the settings form is the cleanest of the authed pages because it doesn't share the `max-w-md` constraint of the asset forms.

## Open Questions

- (None left open by the research itself; the five open questions above are routed to `/10x-plan` for decision.)
