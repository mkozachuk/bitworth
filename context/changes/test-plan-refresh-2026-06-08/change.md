---
change_id: test-plan-refresh-2026-06-08
title: Test plan refresh 2026-06-08 add DOM hydration and Playwright e2e phase 5
status: implemented
created: 2026-06-08
updated: 2026-06-08

archived_at: null
---

## Notes

Open a change folder for the 2026-06-08 refresh of context/foundation/test-plan.md. The 2026-06-01 snapshot is now stale on three items and the user has accepted the brief above.

# Refresh brief (verbatim from /10x-test-plan --refresh)

## What is in the guide today (2026-06-01)
All 4 rollout phases complete. §2 carries 6 risks. §4 lists Playwright as TBD; §5 marks e2e as planned. Phase 1 deferred a DOM integration test on the dashboard total to "a follow-up phase that installs DOM tooling" (recorded in §3 paragraph after the table).

## What is stale
- Phase 1 deferral is now 7 days old; dashboard.astro is the single most-changed file in 30d (12 commits) and NetWorthDisplay.tsx is 9 commits/30d.
- Two lessons are explicitly marked Open with no test: lessons.md §6 (missing (snapshot_id, asset_id) unique constraint) and §7 (empty-assets snapshot POST still creates a parent row). Both map back to existing Risk #3.
- vite-tsconfig-paths lesson entry (lessons.md §4) has the tool installed and used by every test, but the Rule: and Applies to: lines are empty.

## What is missing
- A Playwright e2e phase that the user asked for in Phase 2 interview Q2 ("some e2e with playwright needed").
- A DOM/hydration test on the dashboard total that Risk #1 response guidance calls for and Phase 1 deferred.
- A test for the two OPEN lessons (both surface through the dashboard chart, so a single Playwright run of the empty-assets snapshot path catches the chart-rendering half).

## What is NOT changing
- §1 strategy (3 principles) — frozen.
- §2 risk map — no row is overturned. §2 edits require explicit user direction; the refresh surfaces the change in §3 and §6, not §2.
- §4 stack — Playwright moves from TBD to "installed by Phase 5"; the rest is stable.
- §5 quality gates — e2e gate moves from planned to enforced (CI gate — Phase 5).
- §7 negative space — Supabase generated types remain the only documented exclusion.

## Proposed refresh action — single Phase 5 row in §3 + §6.3 + §6.7 + lessons.md §4 fix

| # | Phase name | Goal | Risks covered | Test types | Status | Change folder |
|---|------------|------|----------------|------------|--------|----------------|
| 5 | DOM hydration & e2e on critical UI | Install Playwright; ship a DOM test that the post-hydration dashboard total matches the API; add a single e2e covering the empty-assets snapshot path to close OPEN lessons §6 and §7. | #1 (DOM half), #3 (chart-rendering half) | DOM (jsdom or happy-dom) + Playwright e2e | not started | test-plan-refresh-2026-06-08 |

The plan's final sub-phase in Phase 5 will:
- update §3 status (not started → ... → complete),
- update §5 row "e2e on critical flows" from planned to enforced (CI gate — Phase 5),
- fill in §6.3 (Adding an e2e test) and add §6.7 (Adding a DOM/hydration test for the dashboard total),
- fill in the empty Rule: / Applies to: body of lessons.md §4 (vite-tsconfig-paths).

It will NOT rewrite §1 or §2 without explicit user direction.

## Why a single Phase 5 (not 2 or 3)
The user asked for e2e in Q2, Q1/Q3/Q4 all converged on the same DOM surface, and the OPEN lessons are reachable through the same empty-snapshot e2e. Splitting DOM-vs-e2e would create two phases that test the same deploy shape and run on the same Playwright install.

## What would prove protection (response intent, not anchors)
- Risk #1 DOM half: a Playwright test that loads /dashboard, waits for the React island to hydrate, and asserts the visible total equals the value the /api/snapshots GET returns. Hydration timing is the regression; the unit test on the formula does not catch it.
- Risk #3 chart half: the same e2e run, plus a "Save snapshot on an empty account" scenario, asserts the chart does not show a zero point OR does show one with a product-acknowledged marker (whichever the product question resolves to).
- Lessons §6/§7: the empty-snapshot e2e exercises the chart-rendering path the OPEN lessons flag.

## Out of scope (not added)
- Visual regression / Argos / Lost Pixel (§7 documents "no visual diff in this rollout").
- New abuse/security risks (Q1–Q4 surfaced no new class; §2 already covers them).
- AI-native layer (project has no AI surface, §3 documents that).
- RLS WITH CHECK migration (already shipped per lessons.md §5 Closed:).

# Source evidence (NOT anchors — these are the sources the brief above is built on)
- Interview answers (Phase 2 of this refresh):
  - Q1: "all of this" (hydration mismatch + snapshot duplicates + SW stale)
  - Q2: "all good but some e2e with playwright needed" — explicit Playwright ask
  - Q3: "NetWorthDisplay React island" (9 commits/30d)
  - Q4: "DOM / hydration: dashboard renders the right number"
- Hot-spot scan (last 30d, scope src/ + supabase/): 43 commits in scope. Top hot-spot dirs: src/components/assets/ (35), src/pages/api/ (33), src/pages/dashboard/ (17), src/components/auth/ (11). Top hot-spot files: src/pages/dashboard.astro (12), src/components/assets/NetWorthDisplay.tsx (9).
- Lessons file: 8 entries, 2 marked Open (§6 unique-constraint, §7 empty-assets) and 1 with an empty rule body (§4 vite-tsconfig-paths).
- Roadmap: S-08 pwa-installable shipped 2026-06-04 (post the 2026-06-01 guide snapshot). The new surface adds no API routes, so the contract test still walks the same /api/ tree. Not a §2 reason, but the timestamp is the freshness trigger.
- §3 deferral paragraph: Phase 1's "small integration test on the dashboard render of the total" is the explicit home for the work Phase 5 will pick up.

# Hard rules for the downstream chain
- Phase 5 must be a SINGLE rollout phase in §3 (not split into 2 or 3).
- §1 strategy and §2 risk map are NOT touched (per the user-accepted brief; user has not authorised those edits).
- The plan.md must explicitly cite this refresh intent block as the source for Phase 5's scope, so the chain does not invent a new top risk.
- The plan's final sub-phase must update §3, §5, §6.3, §6.7, and lessons.md §4 in one pass. Do not partial-update.
- Test independence + cleanup rule from CLAUDE.md applies: each Playwright test gets a unique id (timestamp suffix) and its own setup/action/assertion/cleanup.

# Stack grounding (from the existing guide, current session 2026-06-08)
- Docs: Context7 MCP reachable. Check: 2026-06-08.
- Search: Exa.ai + WebSearch reachable. Check: 2026-06-08.
- Runtime/browser: Playwright MCP not present in current session. Check: 2026-06-08.
- Provider/platform: Linear MCP reachable. Check: 2026-06-08.

After creating the folder, follow the downstream continuation rule. Do not re-run /10x-test-plan unless a downstream stage surfaces a correction to the test plan or Phase 5 completes.
