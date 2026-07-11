# Dedicated BitWorth Landing Page — Plan Brief

> Full plan: `context/changes/landing-page/plan.md`

## What & Why

Replace the "10x Astro Starter" placeholder homepage with a dedicated BitWorth marketing page that communicates the privacy-first, manual-entry net-worth value proposition. Right now an unauthenticated visitor lands on generic starter copy that says nothing about the product; this is the front door and should sell the wedge: "your net worth, without the spreadsheet."

## Starting Point

`src/pages/index.astro` renders a single static component, `src/components/Welcome.astro`, which carries the cosmic theme (starfield, blur-orbs, glassmorphism cards, gradient hero) but still shows the starter headline, tagline, and a 3-card feature grid describing the boilerplate. The auth CTAs and design system already exist and work.

## Desired End State

A BitWorth-branded landing page on the same cosmic theme: a hero with product positioning and Sign Up/Sign In CTAs, an inline CSS "dashboard preview" panel (sample net-worth number, delta chips, mini chart — no image, no live data), a 4-card value-prop grid, and a closing CTA band. No "10x Astro Starter" text or rocket banner anywhere.

## Key Decisions Made

| Decision              | Choice                                              | Why (1 sentence)                                                              | Source |
| --------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| Implementation surface| Rewrite `Welcome.astro` in place                    | `index.astro` just renders it; keeps the cosmic theme, avoids a new wrapper.  | Frame  |
| Product preview asset | Inline CSS/HTML dashboard mock (NOT `template.png`) | `template.png` is a stale "10x-astro-starter" rocket banner — using it re-adds starter branding. | Plan |
| Value props           | All four (privacy, multi-currency, snapshots, charts)| Cover the full wedge from the PRD vision and persona.                         | Plan   |
| CTAs                  | Sign Up (primary) + Sign In only                    | Demo mode is a nice-to-have and isn't built — no dead links.                  | Plan   |
| Positioning           | "Your net worth, without the spreadsheet"           | Concrete, maps directly to persona Alex's pain point.                         | Plan   |
| Structure             | Hero + preview + 4 value props + closing CTA        | Complete marketing arc while staying on the existing theme.                   | Plan   |

## Scope

**In scope:** Rewriting copy, CTAs, and sections in `src/components/Welcome.astro`; an inline CSS dashboard-preview panel; a 4-card value-prop grid; a closing CTA band.

**Out of scope:** Demo mode / `/demo` route; any auth, middleware, data, or schema change; editing or using `public/template.png`; React islands; changes to `Topbar.astro`, `Layout.astro`, or global styles.

## Architecture / Approach

Single-file edit to `src/components/Welcome.astro`. Keep the cosmic shell (orbs, starfield, `Topbar`) untouched. Swap hero copy/CTAs, insert a CSS preview panel, replace the 3-card starter grid with a 4-card value-prop grid (reusing the existing glassmorphism card + inline-SVG icon recipe), and append a closing CTA band. Stays static `.astro` — no new JS, no image fetch.

## Phases at a Glance

| Phase                      | What it delivers                                          | Key risk                                  |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| 1. Hero & Product Preview  | New hero copy + CTAs, inline CSS dashboard-mock panel     | Mock looks unconvincing / off-brand       |
| 2. Value Props & Closing CTA | 4-card value-prop grid + closing CTA band               | Grid reflow / icon choice at breakpoints  |

**Prerequisites:** None — public page, no data/auth/schema dependency; design system and auth routes already exist.
**Estimated effort:** ~1 session, single file, 2 phases.

## Open Risks & Assumptions

- The CSS dashboard mock is illustrative only; a designer may later swap in a real screenshot — built to be replaceable.
- Main risk is design drift from the cosmic aesthetic — mitigated by reusing the existing card/orb/starfield recipes verbatim.

## Success Criteria (Summary)

- A logged-out visitor at `/` sees a coherent BitWorth marketing page (hero, preview, 4 value props, closing CTA) on the cosmic theme.
- Sign Up / Sign In CTAs route correctly; page renders in both light and dark mode and reflows on mobile.
- No "10x Astro Starter" text or `template.png` rocket banner remains.
