---
change_id: net-worth-trajectory
title: Empirical net-worth trajectory — project future net worth and target ETA from real snapshot history
status: implemented
created: 2026-07-19
updated: 2026-07-24
archived_at: null
---

## Notes

Seeded from `context/foundation/roadmap.md` — slice **S-20: Empirical net-worth trajectory** (Stream L, Goals & forecast).

- **Outcome:** project future net worth from the user's real snapshot history and show when they'll hit a target.
- **Depends on:** F-01, S-02 (`computeNetWorth`/`convertAmount` + dashboard host + Recharts).
- **Shape (from roadmap):** pure, unit-tested `src/lib/trajectory.ts` (linear + CAGR fit, `projectForward`, `etaToTarget`) + a dotted projected extension on `NetWorthChart` (reuse Recharts, no new lib); ≥2-snapshot guard; "estimate, not advice" disclaimer.
- Empirical complement to the assumption-based S-09 FIRE projection. Unblocks S-21 (savings-goals reuses `etaToTarget`).
