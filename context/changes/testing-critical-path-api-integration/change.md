---
change_id: testing-critical-path-api-integration
title: Critical-path API integration tests
status: implemented
created: 2026-06-02
updated: 2026-06-03
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Critical-path API integration".
Risks covered: #2 (cross-tenant/authorization leak on /api/assets and /api/snapshots), #3 (snapshot history integrity — orphan parent/items, wrong sort), #5 (public API route shipped without explicit auth decision).
Test types planned: integration (handler + Supabase stub) + contract test that lists every file under src/pages/api/ and asserts an explicit auth decision.
Risk response intent:
- Risk #2: prove that user A, authenticated, requesting /api/assets/<id of B> is denied (403/404); same shape for /api/snapshots. Challenge "session exists ⇒ ownership is OK" — owner_id must be checked explicitly. Avoid mocking auth middleware to always return user A and only varying the URL — mock at the request boundary.
- Risk #3: prove that POST /api/snapshots with a valid payload creates parent + items atomically (no orphans), and the list returned to the chart is sorted by the contract's date key. Challenge "first insert succeeded ⇒ second must have" and "DB order = chart order". Avoid only asserting "200 OK" or asserting the parent row without checking items.
- Risk #5: prove that every file under src/pages/api/ contains an explicit session check (or an explicit, commented justification). Challenge "public data, no auth needed" — that decision must be visible. Avoid only testing routes that already have the check — the test must scan the directory.
Hot-spot directories that raised these risks (likelihood evidence — NOT anchors): src/pages/api/, src/pages/api/snapshots/, src/components/assets/.
Stack: Vitest ^3.2.6 (per vitest.config.ts); MSW is TBD per §4; no DOM tooling yet.

Reference: context/changes/testing-runner-bootstrap/ has the established change.md/plan.md/research.md shape from Phase 1.
After creating the folder, follow the downstream continuation rule.
