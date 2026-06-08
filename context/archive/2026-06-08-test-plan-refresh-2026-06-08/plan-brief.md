# DOM Hydration & E2E on Critical UI — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-06-08/plan.md`
> Refresh brief: `context/changes/test-plan-refresh-2026-06-08/change.md`

## What & Why

Add Phase 5 to the test plan rollout — install Playwright and happy-dom, ship a DOM hydration test on the NetWorthDisplay React island, and add two Playwright e2e tests covering the dashboard total and the empty-assets snapshot path. Phase 1 deferred the DOM test 7 days ago; two lessons remain OPEN with no test coverage; the user explicitly asked for Playwright e2e in the Phase 2 interview.

## Starting Point

4 rollout phases complete: Vitest runner, API integration tests, external API failure tests, and CI quality gates. 60+ test scenarios across 10 files, all unit/integration. No DOM testing infra (no happy-dom, no RTL). No e2e infra (no Playwright). The dashboard's net worth total only appears after React island hydration — no existing test catches hydration failures.

## Desired End State

The dashboard total is tested at two layers: a fast Vitest DOM test (happy-dom + RTL) catches rendering bugs without a browser, and a Playwright e2e catches hydration mismatches in the production build. The empty-assets snapshot path is verified end-to-end, closing OPEN lessons §6 and §7. CI enforces the e2e gate on every PR. The test-plan document is fully up to date.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| DOM environment | happy-dom | 2-3x faster than jsdom, sufficient for React number rendering, fits §1 "cheapest test" principle. | Plan |
| Empty-assets behavior | Pin current (zero point renders) | Pins observable behavior without blocking on a product decision; the test documents intent, not endorsement. | Plan |
| Playwright webServer | npm run build + preview | Tests the production artifact — catches SSR/hydration mismatches that dev mode hides. | Plan |
| CI shape | Same job, sequential | Simplest setup for 2-3 e2e tests; total CI increase ~30-60s. | Plan |

## Scope

**In scope:**
- Install happy-dom, @testing-library/react, @playwright/test
- Vitest DOM test on NetWorthDisplay (mixed-currency + empty)
- Playwright e2e: dashboard hydration total
- Playwright e2e: empty-assets snapshot → zero-value chart point
- CI gate for e2e
- Test-plan.md updates: §3, §4, §5, §6.3, §6.6, §6.7, §8
- Lessons.md §4 rule body

**Out of scope:**
- Visual regression tooling (Argos, Lost Pixel)
- §1 strategy or §2 risk map changes
- Multi-browser testing (Chromium only)
- MSW or network mocking infrastructure
- AI-native test layer

## Architecture / Approach

Two test layers added: Vitest + happy-dom for fast DOM rendering tests (co-located with components, `*.dom.test.tsx`), and Playwright for full-stack e2e against the production build (in `e2e/`, `*.spec.ts`). Playwright's `webServer` config builds and previews the app, then runs specs in Chromium. Each e2e test creates its own Supabase user (timestamp email) for test independence. CI runs e2e sequentially after unit/integration tests in the same job.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Tooling & Configuration | Deps installed, configs created, scripts wired | Vitest include pattern change could affect existing test discovery |
| 2. DOM Hydration Test | NetWorthDisplay rendering verified in happy-dom | Component may import browser-only APIs that fail in happy-dom |
| 3. Playwright E2E Tests | Dashboard total + empty-snapshot verified in real browser | Auth flow requires local Supabase with auto-confirm |
| 4. CI Gate + Document Sync | E2e enforced in CI, test-plan fully updated | CI needs Supabase secrets for preview server |

**Prerequisites:** Local Supabase running (`supabase start`) for Phases 3-4. Docker available in CI for Playwright browser install.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- E2e tests assume local Supabase auto-confirms signups (default for `supabase start`); cloud Supabase may require email verification
- CI uses cloud Supabase secrets for the preview server — test data cleanup prevents pollution, but concurrent CI runs could theoretically collide
- NetWorthDisplay may import modules that don't resolve in happy-dom — the implementer should mock at the module boundary if needed

## Success Criteria (Summary)

- `npm run test:ci` passes with the new DOM test, `npm run test:e2e` passes with both e2e specs
- CI enforces the e2e gate — a failing e2e blocks the build
- Test-plan.md Phase 5 is marked complete with all cookbook sections filled
