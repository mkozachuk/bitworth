# Mobile Refactor — Plan Brief

> Full plan: `context/changes/mobile-refactor/plan.md`
> Research: `context/changes/mobile-refactor/research.md`

## What & Why

Ship the S-06 mobile-refactor slice: make the dashboard, assets list, and asset forms usable on a phone-sized viewport (~360px) without horizontal scrolling, truncated labels, or wrapped buttons. The roadmap's outcome is "user can complete the core flows (view dashboard, add/edit/delete assets, sign out) on a phone-sized viewport". This is a pure UI refactor that sets the responsive-design precedent for S-07 (asset-list reflow) and S-08 (PWA install banner).

## Starting Point

- The authed surface is small and well-inventoried: 5 Astro pages + 1 shared Topbar + 9 React components (research.md §1).
- Three mobile-fragile hotspots: `Topbar.astro:5-39` (overflows at 360px by ~80px), `AssetForm.tsx:124` (fixed `grid-cols-2`), and `NetWorthDisplay.tsx:201,227` (two fixed `grid-cols-2`).
- `dashboard.astro:89-98` is a duplicate sign-out form below the dashboard content. The Topbar already provides sign-out on every authed page.
- The codebase has no responsive convention — only `Welcome.astro` uses `sm:`/`lg:` classes. Tailwind v4 with stock defaults is in place.
- `Button` already exposes `size: "icon"` (`button.tsx:25`); it is dead code. No new IconButton component is needed.
- The only Radix dep is `@radix-ui/react-slot`; no menu/popover/dialog primitives exist.

## Desired End State

A user on a 360px viewport can complete every core flow (view dashboard, navigate to assets, add/edit an asset, sign out) without horizontal scroll. The dashboard, asset list, asset new/edit, and settings pages render with stacked grids, a truncated email + single menu trigger in the Topbar, and full-width form fields. On desktop ≥1024px, every page renders byte-identically to the pre-S-06 state — no visual regressions.

## Key Decisions Made

| Decision                       | Choice                                                                           | Why (1 sentence)                                                                                                              | Source   |
| ------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| Sign-out duplication           | Delete `dashboard.astro:89-98` outright                                          | Topbar is rendered on every authed page; the second surface is provably redundant and would drift if kept.                   | Research |
| IconButton component           | Do NOT add — adopt existing `Button size="icon"`                                | The variant already exists (`button.tsx:25`) and produces a 36×36 ghost button; the gap is consumer adoption, not a missing API. | Research |
| Topbar collapse on <sm         | Radix dropdown menu (`@radix-ui/react-dropdown-menu`)                           | Battle-tested a11y (focus trap, ESC, click-outside, keyboard nav); sets the precedent S-08 will reuse for the PWA install flow. | Plan     |
| Topbar mobile identity         | Truncate email with `max-w-[140px] truncate`; keep visible                      | Zero new code; user still has at-a-glance identity; works with the Radix menu trigger on the right.                            | Plan     |
| Grid collapse (AssetForm + NetWorthDisplay) | `grid grid-cols-1 sm:grid-cols-2` at the 3 hot lines + `flex flex-col sm:flex-row` on the submit/cancel row | Smallest change with the largest payoff; desktop visual byte-identical at ≥sm; matches the existing `Welcome.astro` pattern. | Plan     |
| Form page width                | `max-w-md` (448px) → `max-w-lg` (512px) on `new.astro` and `edit.astro`          | Gives the form breathing room on ≥md viewports; mobile unchanged because `max-w-lg` still exceeds 360px content area.         | Plan     |
| Verification                   | Manual at 360px + 1280px per phase                                              | No visual diff tooling in the codebase (per `user-settings` plan out-of-scope); surface is small (5 pages) so manual is tractable. | Plan     |
| Phase structure                | 4 phases, 1 commit each                                                          | Clean rollback boundary; Phase 1 is no-visible-diff prep; Phase 2 is the only commit that adds new client-side JS.            | Plan     |

## Scope

**In scope:**

- One new npm dep: `@radix-ui/react-dropdown-menu`
- One new React component: `src/components/TopbarMenu.tsx` (small Radix island)
- Topbar refactor: Radix dropdown for <sm, truncated email, hidden desktop nav on <sm
- Three grid collapses: `AssetForm.tsx:124` (Amount/Currency) + `NetWorthDisplay.tsx:201` (Assets/Liabilities) + `NetWorthDisplay.tsx:227` (deltas)
- Submit/cancel row in `AssetForm.tsx:329`: `flex flex-col sm:flex-row`
- Two form page widths: `new.astro:16` and `edit.astro:36` → `max-w-lg`
- One deletion: `dashboard.astro:89-98` (duplicate sign-out)
- Manual verification at 360px and 1280px per phase

**Out of scope:**

- `AssetList` table-to-card reflow (S-07)
- PWA / install banner (S-08)
- New `IconButton` component (existing variant is the primitive)
- Visual diff tooling / Playwright / Storybook
- Other responsive surfaces (auth pages, landing page)
- Back-link icon-only treatment (fits at 360px)
- DOM integration tests on the dashboard render (test-plan §3 Phase 1 deferral)
- API, schema, or business-logic changes

## Architecture / Approach

```
              Astro (SSR)                                    React Island
       ┌──────────────────────┐                       ┌──────────────────────┐
       │  Topbar.astro        │                       │  TopbarMenu.tsx      │
       │  ─ truncated email   │                       │  ─ Radix Dropdown    │
       │  ─ ≥sm nav (hidden   │  ◀── client:load ──▶  │  ─ Menu trigger      │
       │    on <sm)           │                       │  ─ 4 menu items      │
       │  ─ ≥sm sign-out      │                       │  ─ Sign out <form>   │
       │    (hidden on <sm)   │                       │    (no JS POST)      │
       │  ─ <sm <TopbarMenu>  │                       │                      │
       └──────────────────────┘                       └──────────────────────┘

       AssetForm.tsx ─── grid-cols-1 sm:grid-cols-2 (Amount/Currency, submit/cancel row)
       NetWorthDisplay.tsx ─── grid-cols-1 sm:grid-cols-2 (Assets/Liab, deltas)
       new.astro / edit.astro ─── max-w-md → max-w-lg
```

Hydration boundary: only the mobile menu trigger + Radix dropdown is a React island. The rest of the Topbar (email, desktop nav, desktop sign-out form) stays pure Astro. The Sign out item inside the Radix menu is a `<form method="POST" action="/api/auth/signout">` so submission is a no-JS form post — same pattern as the existing Topbar sign-out, no new endpoint, no JS-based mutation.

## Phases at a Glance

| Phase     | What it delivers                                                                                              | Key risk                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1         | Delete duplicate sign-out + add Radix dropdown dep. No visible diff.                                          | None — pure prep.                                                                       |
| 2         | `TopbarMenu` island + Topbar refactor (Radix dropdown on <sm, truncated email, hidden desktop nav on <sm).    | First hydration on the Topbar; new client-side JS on every authed page (~12 KB gz).      |
| 3         | Three `grid-cols-1 sm:grid-cols-2` collapses + submit/cancel row stack.                                       | Visual regression on ≥sm if a class edit is wrong; mitigated by byte-identical ≥sm check. |
| 4         | `max-w-md` → `max-w-lg` on `new.astro` and `edit.astro`.                                                       | Trivial; primary risk is forgetting to update both files.                                |

**Prerequisites:** F-01 (Supabase schema), S-01 (asset CRUD), S-02 (dashboard with chart), S-04 (assets summary). All done.

**Estimated effort:** 2–3 sessions across 4 phases. Phase 2 is the largest (new component + Topbar refactor + new dep); Phases 1, 3, 4 are small.

## Open Risks & Assumptions

- **Hydration cost on authed pages**: Phase 2 introduces the first React island on the Topbar. The island is hidden on ≥sm via CSS but the JS is still downloaded. Estimated ~12 KB gzip (Radix dropdown + the island). Acceptable for S-06; S-08 may revisit with `@serwist/astro` SW caching.
- **Radix dropdown as S-08 precedent**: S-08 (PWA installable) may need a menu primitive for the iOS install banner. We are betting on `@radix-ui/react-dropdown-menu` being the right primitive for both. If S-08 needs a different primitive (e.g. `react-aria` `useMenu`, or a popover), this dep is one-off. Mitigation: the dropdown is the lightest Radix package; even if S-08 adds another, the total Radix footprint stays small.
- **Crypto panel in AssetForm**: research.md §1 notes the crypto panel (`AssetForm.tsx:193-310`) "is also a fixed 2-col block", but reading the file shows the panel is `space-y-4` with three single-column children — there is no horizontal `grid-cols-2` to collapse. The plan includes a verification step (3.2) and "no code change expected" note. If a grid does exist at an inner level, the same `grid-cols-1 sm:grid-cols-2` pattern applies.
- **`npx astro check` may flag the new `TopbarMenu` island type**: the `Astro.locals.user` shape is read at the call site and passed as a prop. The TypeScript shape for `Astro.locals.user` is in `src/env.d.ts` (or similar); the implementer should verify the prop type matches.

## Success Criteria (Summary)

- A user on a 360px viewport can complete every authed flow (view dashboard, navigate to assets, add/edit an asset, sign out) without horizontal scroll.
- A user on a 1280px viewport sees no visual diff from the pre-S-06 state (verified manually per phase).
- The duplicate sign-out form in `dashboard.astro` is gone; the Topbar is the single source of truth.
- `npm run lint` and `npm run build` pass on every commit.
