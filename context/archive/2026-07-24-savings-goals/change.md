---
change_id: savings-goals
title: Custom savings goals with progress cards and a trend-derived ETA
status: archived
created: 2026-07-24
updated: 2026-07-24
archived_at: 2026-07-24T20:42:14Z
---

## Notes

from @context/foundation/roadmap.md — slice **S-21: Custom savings goals**.

Outcome per the roadmap: a new "Goals" area where the user creates named savings
goals — against **total net worth** ("reach €1M") or a **single category**
("Savings Account → €50k emergency fund") — each with a target amount, target
currency, and optional target date. A settings-gated "Goals" card on the
dashboard shows each goal's progress bar (current ÷ target) plus an estimated
completion date from the S-20 trajectory; with no goals entered it shows a
placeholder linking to `/dashboard/goals`.

Prerequisites: `F-01`, `S-01`, `S-02`, `S-05`, `S-20` (`etaToTarget` from
`src/lib/trajectory.ts`). See roadmap §S-21 for the full Unknowns list (goal
denominator, `goals` table + RLS, mixed target currency, off-track ETA,
`show_goals` preference gating, nav + management surface).
