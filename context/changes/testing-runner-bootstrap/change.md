---
change_id: testing-runner-bootstrap
title: Bootstrap Vitest runner and add first net worth calculation test
status: implementing
created: 2026-06-01
updated: 2026-06-01
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Runner bootstrap + first critical-path unit". Risks covered: #1 (Net worth total is wrong — a single asset's currency doesn't convert, a liability is treated as positive, or amounts are summed in raw units). Test types planned: unit. Risk response intent: Risk #1 — prove that the net worth calculation, given a known set of mixed-currency assets plus a liability, produces a known total; challenge the assumption that happy-path single-currency input implies mixed-currency correctness; avoid copying the formula from the implementation and asserting it returns itself (oracle problem). The phase must also bootstrap the test runner (Vitest) and document the run command locally. After creating the folder, follow the downstream continuation rule.
