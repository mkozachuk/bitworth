---
change_id: pwa-installable
title: Pwa installable
status: implementing
created: 2026-06-03
updated: 2026-06-04
archived_at: null
---

## Notes

Plan written on 2026-06-03. Key decisions:

- PWA library: hand-roll `vite-plugin-pwa@1.3.0` (stable) as a custom Astro integration — avoids `@serwist/astro` preview dep and `@vite-pwa/astro` Astro-5 cap.
- Icon source: 512×512 monogram from existing 32×32 favicon as placeholder; designer-replaceable.
- Install UI: authed routes only; Android in Topbar Radix DropdownMenu, iOS in modal.
- Offline shell: minimal static HTML, no islands, no Supabase calls.
- Update flow: auto-update on next nav (no toast, no reload).
- Install detection: CSS-only `display-mode: standalone` media query.

See `plan.md` for the full 6-phase implementation.
