# Dedicated BitWorth Landing Page Implementation Plan

## Overview

Replace the "10x Astro Starter" placeholder homepage with a dedicated BitWorth marketing page that communicates the privacy-first, manual-entry net-worth value proposition. The page is rewritten in place inside `src/components/Welcome.astro` (rendered by `src/pages/index.astro`), preserving the established cosmic aesthetic (starfield, blur-orbs, glassmorphism, gradient headings) while swapping all copy and adding new sections: an inline CSS "dashboard preview" mock, a 4-card value-prop grid, and a closing CTA band.

## Current State Analysis

- `src/pages/index.astro` renders a single component, `src/components/Welcome.astro` — there is no separate page logic to touch.
- `src/components/Welcome.astro:1-132` is a static `.astro` file (no React islands) with:
  - A cosmic shell: `bg-cosmic-light dark:bg-cosmic`, three blur-orbs (`Welcome.astro:7-18`), and a CSS starfield (`Welcome.astro:21-25`).
  - A `<Topbar />` import (`Welcome.astro:2,28`).
  - A hero with gradient headline "10x Astro Starter", a tagline, and two CTA `<a>` links to `/auth/signin` (solid purple) and `/auth/signup` (bordered) (`Welcome.astro:30-54`).
  - A 3-card feature grid with inline SVG icons describing starter features (`Welcome.astro:56-130`).
- The design system is established in `src/styles/global.css`: `bg-cosmic`/`bg-cosmic-light` utilities, OKLCH theme tokens, glassmorphism card pattern (`backdrop-blur-xl`, `bg-white/80 dark:bg-white/5`, `border border-zinc-200 dark:border-white/10`).
- `public/template.png` is **NOT** a dashboard mockup — it is a starter banner reading "10x-astro-starter" with a rocket. It must not be used as the product preview (it would re-introduce the starter branding this change removes).
- `src/layouts/Layout.astro` already sets the correct app meta: title "BitWorth", description "Privacy-first net worth tracker". No layout change needed.
- Auth routes `/auth/signin` and `/auth/signup` exist and work; CTAs continue to point at them.
- Demo mode (PRD US-02 / FR-002) is a nice-to-have and is **not built** — no `/demo` route or demo data exists. CTAs are Sign Up / Sign In only.

### Key Discoveries:

- Rewrite-in-place is the right surface — `index.astro` is a one-line render of `Welcome.astro`, so all work lives in one file (`src/components/Welcome.astro`).
- Reuse the exact glassmorphism card recipe already in the file (`Welcome.astro:58-60`) for value-prop cards and the dashboard-mock panel to avoid design drift.
- Hero CTA links are plain styled `<a>` tags (`Welcome.astro:41-52`), not the `button.tsx` component — keep that pattern for consistency; no React island is introduced.
- `Topbar.astro` stays at the top of the page; it already adapts to authenticated vs unauthenticated state.

## Desired End State

An unauthenticated visitor opening `/` sees a BitWorth-branded marketing page on the cosmic theme:
1. Hero: headline "Your net worth, without the spreadsheet", a privacy/manual-entry subline, and Sign Up (primary) + Sign In CTAs.
2. An inline CSS "dashboard preview" panel showing a sample net-worth number, delta chips, and a mini chart — no live data, no external image.
3. A 4-card value-prop grid: privacy / no bank connections, multi-currency auto-conversion, one-click snapshots, trend charts over time.
4. A closing CTA band repeating Sign Up / Sign In after the value props.

Verification: no occurrence of "10x Astro Starter", "Astro Starter", or `template.png` remains in `Welcome.astro`; the page builds (`npm run build`), lints (`npm run lint`), and renders correctly in both light and dark mode.

## What We're NOT Doing

- Not building demo mode or a `/demo` route (PRD nice-to-have, out of scope).
- Not touching `/auth/*` pages, auth flow, middleware, or any data/schema.
- Not using or editing `public/template.png` (stale starter art — a designer can supply a real screenshot later).
- Not introducing React islands — the page stays static `.astro`.
- Not changing `Topbar.astro`, `Layout.astro`, or global styles/theme tokens.
- Not adding new routes or pages — `index.astro` stays a one-line render of `Welcome.astro`.

## Implementation Approach

Edit `src/components/Welcome.astro` only. Keep the cosmic shell (orbs, starfield, `Topbar`) untouched. Replace the hero copy and CTA labels, insert a new CSS dashboard-mock section between the hero and the value props, replace the 3-card starter grid with a 4-card value-prop grid using BitWorth copy and appropriate icons, and append a closing CTA band. Reuse existing Tailwind class recipes so the result is visually consistent and passes `astro/no-set-html-directive` (all markup is static, no `set:html`).

## Phase 1: Hero & Product Preview

### Overview

Rewrite the hero copy and CTAs, and replace the (unused) `template.png` concept with an inline CSS "dashboard preview" panel.

### Changes Required:

#### 1. Hero copy and CTAs

**File**: `src/components/Welcome.astro`

**Intent**: Replace the "10x Astro Starter" headline and starter tagline with BitWorth positioning, and relabel/reprioritize the CTAs so Sign Up is the primary action. Keep the existing gradient-heading and CTA-link styling.

**Contract**: Headline text → "Your net worth, without the spreadsheet" (in the existing `<h1>` gradient block, `Welcome.astro:32-36`). Tagline → a privacy/manual-entry subline (e.g. "Track everything you own — across currencies — in one private number. No bank connections, no formulas."). Primary CTA → Sign Up linking `/auth/signup` (solid purple style, currently used by Sign In at `Welcome.astro:41-46`); secondary CTA → Sign In linking `/auth/signin` (bordered style). Reuse the existing `<a>` class strings; only swap href/label/order.

#### 2. Inline CSS dashboard preview

**File**: `src/components/Welcome.astro`

**Intent**: Add a product-preview section below the hero that visually shows what the product produces, built entirely from Tailwind markup (no image, no live data) so it stays on-brand and swappable.

**Contract**: A new section between the hero (`Welcome.astro:54`) and the feature grid. A glassmorphism panel (reuse the card recipe `rounded-xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/5`) containing: a prominent sample net-worth number with display-currency label, two delta chips (vs last month / vs Jan 1, one positive-styled), and a simple mini line/area chart rendered as inline static SVG or styled divs. All values are illustrative sample data, labeled or visually obviously a preview. Centered, `max-w-4xl mx-auto`, responsive.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`
- No starter references remain: `grep -ni "astro starter\|template.png" src/components/Welcome.astro` returns nothing

#### Manual Verification:

- Hero shows the new headline, subline, and Sign Up (primary) + Sign In CTAs; both links navigate to the correct auth pages
- The dashboard-preview panel renders correctly in both light and dark mode and is responsive on mobile
- No layout regression to orbs/starfield/Topbar

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the hero + preview look right in both themes before proceeding to Phase 2.

---

## Phase 2: Value Props & Closing CTA

### Overview

Replace the 3-card starter feature grid with a 4-card BitWorth value-prop grid, and add a closing CTA band.

### Changes Required:

#### 1. Four value-prop cards

**File**: `src/components/Welcome.astro`

**Intent**: Replace the three starter feature cards (`Welcome.astro:56-130`) with four BitWorth value props, reusing the existing card recipe and inline-SVG icon pattern.

**Contract**: A responsive grid (1 col mobile, 2 cols `sm`, 4 cols `lg`) of glassmorphism cards. The four cards:
- **Privacy / no bank connections** — manual entry, your data stays yours.
- **Multi-currency auto-conversion** — PLN/USD/EUR converted to one display currency with live rates.
- **One-click snapshots** — save monthly snapshots without the spreadsheet copy-paste ritual.
- **Trend charts over time** — net-worth line chart with deltas vs last month and Jan 1.

Each card keeps the existing structure: inline SVG icon (`mb-4 text-purple-600 dark:text-purple-300`), `<h3>` title, `<p>` description. Pick an apt icon per card (e.g. lock/shield, currency/refresh, camera/save, chart-line). Update the grid wrapper at `Welcome.astro:57` from `sm:grid-cols-3` to a 4-up responsive layout.

#### 2. Closing CTA band

**File**: `src/components/Welcome.astro`

**Intent**: Add a final call-to-action section after the value-prop grid to capture visitors who scrolled through.

**Contract**: A centered band (optionally inside a glassmorphism panel) with a short headline (e.g. "Start tracking in minutes — it's free and private."), and the same Sign Up (primary) + Sign In CTA links reused from the hero. `max-w-4xl mx-auto`, bottom padding consistent with existing sections.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`
- Four value-prop cards present: grid renders 4 cards (verified in build output / manual)

#### Manual Verification:

- All four value props render with distinct icons and correct copy in both light and dark mode
- Grid reflows correctly: 1 col on mobile, 2 on tablet, 4 on desktop
- Closing CTA band renders and both CTA links navigate correctly
- Overall page reads as a coherent BitWorth marketing page with no starter remnants

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation in both themes and at mobile/desktop widths.

---

## Testing Strategy

### Manual Testing Steps:

1. Run `npm run dev`, open `/` while logged out — confirm hero copy, CTAs, preview panel, 4 value props, and closing CTA all render.
2. Toggle OS dark/light mode (or system preference) — confirm both themes look correct.
3. Resize to mobile width — confirm the value-prop grid reflows and the dashboard preview stays readable.
4. Click Sign Up and Sign In CTAs (hero and closing band) — confirm they route to `/auth/signup` and `/auth/signin`.
5. Confirm no "10x Astro Starter" text or rocket banner appears anywhere on the page.

## Performance Considerations

None of note — the page remains a static `.astro` render with no new JS, no React island, and no external image fetch (the inline CSS/SVG preview removes any image dependency).

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-10 (lines 215-228)
- PRD vision & persona: `context/foundation/prd.md` (Vision & Problem Statement, US-02, FR-001/002)
- Current page: `src/components/Welcome.astro:1-132`
- Card recipe to reuse: `src/components/Welcome.astro:58-60`
- Design tokens: `src/styles/global.css` (`bg-cosmic`/`bg-cosmic-light`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Hero & Product Preview

#### Automated

- [x] 1.1 Build passes: `npm run build`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 No starter references remain in `Welcome.astro`

#### Manual

- [x] 1.4 Hero shows new headline, subline, and Sign Up (primary) + Sign In CTAs routing correctly
- [x] 1.5 Dashboard-preview panel renders in light and dark mode and is responsive
- [x] 1.6 No layout regression to orbs/starfield/Topbar

### Phase 2: Value Props & Closing CTA

#### Automated

- [ ] 2.1 Build passes: `npm run build`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Four value-prop cards render

#### Manual

- [ ] 2.4 Four value props render with distinct icons and copy in both themes
- [ ] 2.5 Grid reflows 1/2/4 cols across mobile/tablet/desktop
- [ ] 2.6 Closing CTA band renders and CTA links route correctly
- [ ] 2.7 Page reads as a coherent BitWorth marketing page, no starter remnants
