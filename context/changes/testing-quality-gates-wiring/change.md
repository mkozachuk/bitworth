---
change_id: testing-quality-gates-wiring
title: Quality-gates wiring (CI for lint, typecheck, Vitest)
status: implementing
created: 2026-06-07
updated: 2026-06-07
archived_at: null
---

## Notes

Rollout Phase 4 of `context/foundation/test-plan.md`: "Quality-gates wiring".

Risks covered: #5 (contract enforced in CI).

Test types planned: CI config (lint + typecheck + Vitest unit/integration wired into Cloudflare Workers Builds; local run command documented).

Risk response intent:
- Risk #5: prove that every new /api/* route is caught by the auth-or-public-route contract at PR time (not just on manual review); challenge "we'll remember to add the check" — the test enforces visibility, not banning public routes. Avoid only running the contract test locally — it must be a CI gate.

Entry criteria (resolved 2026-06-07 during /10x-new):
- `npx tsc --noEmit` was failing on `feature/pwa` with 9 `MockSupabaseClient is not assignable to SupabaseClient` errors in `src/lib/crypto-prices.test.ts` (5 sites) and `src/lib/exchange-rates.test.ts` (4 sites). Fixed by adding an `asClient` cast helper at the import boundary of each test file — the factory intentionally exposes a structural `MockSupabaseClient` (auth/from/rpc only), and the test SUTs take the full `SupabaseClient` type. tsc is now green. This fix is in scope for Phase 4 because wiring a known-failing command into CI is worse than no gate.
