---
change_id: mobile-refactor
title: Mobile refactor
status: implementing
created: 2026-06-03
updated: 2026-06-03
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- `plan.md` and `plan-brief.md` written 2026-06-03. 4 phases: cleanup+dep, Topbar refactor with Radix dropdown, component grid collapses, form page widths.
- The duplicate sign-out in `dashboard.astro:89-98` is deleted in Phase 1 (resolved by research; confirmed in plan).
- The "add an `IconButton` variant" question from the roadmap is resolved by research: don't add — adopt the existing `Button size="icon"` (currently dead code at `button.tsx:25`).
