---
change_id: fire-dashboard
title: Settings-gated FIRE-progress card on the dashboard
status: implemented
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

Seeded from `context/foundation/roadmap.md` → slice **S-14: FIRE dashboard card** (change ID `fire-dashboard`).

Outcome: user can turn a "FIRE dashboard" card on/off from settings (on by default); when on, the dashboard shows progress toward financial independence — animated progress bar for % of FIRE number reached, months of runway at zero income, estimated years-to-FI, and the FIRE number itself, all in the display currency. With no FIRE data entered, the card shows a placeholder linking to `/dashboard/fire`.

Prerequisites: F-01 (schema), S-02 (dashboard host + net-worth/rates load), S-05 (settings + `user_preferences` write path), S-09 (FIRE engine `src/lib/fire.ts` + `fire_*` columns). See the roadmap S-14 §Unknowns/§Risk for the planning-time decisions (new `show_fire_dashboard` pref default TRUE, a runway helper, "no FIRE data" = `fire_annual_expenses == null`, guard `RangeError` when `safeWithdrawalRate <= 0`).
