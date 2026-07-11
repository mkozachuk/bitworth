---
change_id: landing-page
title: Dedicated BitWorth landing page replacing the starter placeholder
status: archived
created: 2026-06-16
updated: 2026-07-11
archived_at: 2026-07-11T20:55:40Z
---

## Notes

Seeded from `context/foundation/roadmap.md` → **S-10: Dedicated landing page**.

- **Outcome:** an unauthenticated visitor lands on a dedicated BitWorth marketing page (replacing the "10x Astro Starter" placeholder) that communicates the privacy-first, manual-entry net-worth-tracking value proposition — hero headline + tagline, 3–4 value props (privacy/no bank connections, multi-currency auto-conversion, one-click snapshots, trend charts), a product preview, and clear Sign Up / Sign In CTAs.
- **Prerequisites:** none — public page, no schema/data dependency. Reuses the Tailwind design system and existing `/auth/*` pages.
- **Open questions (from roadmap):**
  - Copy/positioning: lift the vision + wedge from `prd.md` / roadmap §Vision recap — "privacy-first net worth tracker, manual-entry, better than a spreadsheet."
  - Product preview asset: `public/template.png` (1492×470 dashboard mockup) exists; use it as the hero/preview, designer can swap a real screenshot later.
  - Implementation surface: rewrite copy/sections inside `Welcome.astro` in place (keep the cosmic theme) vs. a new component — recommendation is rewrite in place.
- **Risk:** Low — single static public page, no data or auth-flow changes. Main risk is design drift from the cosmic aesthetic; reuse the starfield + blur-orb styling and existing `button.tsx` variants, swap only copy and add value-prop/preview sections.
