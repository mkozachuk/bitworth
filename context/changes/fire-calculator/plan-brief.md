# FIRE Calculator (S-09) — Plan Brief

> Full plan: `context/changes/fire-calculator/plan.md`
> Research: `context/changes/fire-calculator/research.md`

## What & Why

A savings-rate-driven FIRE / retirement calculator at `/dashboard/fire` (roadmap slice S-09). The user enters age, income, expenses, expected return, inflation, and a withdrawal rate; the tool derives their savings rate, projects their portfolio forward from their **current net worth**, and surfaces a **retirement age**, years-to-FI, FIRE number, and Coast/Barista milestones — with a live-updating chart. It exists to let users see "how soon can I retire, and what moves the needle" using the assets they already track in Bitworth.

## Starting Point

Every dependency already exists: `computeNetWorth()` (its first production caller), `getRates()`, the `user_preferences` add-a-column pattern (`theme` precedent), the `PUT /api/user-preferences` handler, the `NetWorthChart` Recharts component, and the Vitest house style. No new libraries. The feature itself — math, persistence, page, form, chart — is all net-new.

## Desired End State

An authed user opens `/dashboard/fire`, sees the calculator pre-seeded from their net worth, and watches their projected retirement age, savings rate, and FIRE milestones update **live** as they edit inputs (client-side, via the same pure `fire.ts`). A Save button persists their inputs. All figures are in their display currency, in today's purchasing power, with a visible "estimate, not advice" disclaimer.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Input model | Income & expenses → savings rate derived | Matches the playingwithfire.co reference; savings-rate framing is the core insight | Plan |
| Output headline | Retirement age (+ years-to-FI) | More motivating than a bare duration; needs a current-age input | Plan |
| Returns/inflation | Nominal return + inflation → convert to one **real** return, project in today's dollars | Familiar inputs but a single convention, dodging the nominal/real mixing bug the roadmap flags | Plan |
| Compounding | Annual, end-of-year savings (ordinary annuity) | Simplest-correct; clean integer retirement-age math and trivial test oracle | Plan |
| Starting principal | Prefill from net worth, editable override | Keeps the "assets as starting point" wedge while allowing what-ifs | Plan |
| Extra layers | Savings-rate display + Coast/Barista FIRE; **no** growth rates or one-off events | High insight-per-line, reuses the same math; growth/events deferred to v2 | Plan |
| Coast retirement age | User input, default 65 | Lets users model different coast targets without forcing it | Plan |
| Persistence | `fire_*` columns on `user_preferences` + sanity bounds + inline disclaimer | Inherits RLS/triggers/auto-create; mirrors the `theme` migration; single-scenario fits v1 | Research → Plan |

## Scope

**In scope:** pure `fire.ts` math + tests; migration adding `fire_*` columns + regen types + extended preferences API; `/dashboard/fire` SSR page; interactive form/results island with live recompute; projection chart; nav link; disclaimer + range validation.

**Out of scope:** income/expense growth rates, one-off cash-flow events, Monte Carlo/variable returns, withdrawal-phase drawdown, multi-person/pensions/Social Security, multiple saved scenarios, a shared `formatCurrency` helper, E2E tests (follow-up via `/10x-e2e`).

## Architecture / Approach

Bottom-up, math-first (roadmap mandate). `fire.ts` is pure TS, so it runs on **both** the server (initial SSR seed) and the client (every keystroke) — one source of projection truth. The page seeds the starting principal via `computeNetWorth` + `getRates`, loads persisted inputs, and hands them to a React island that recomputes through `fire.ts` and feeds both the results panel and the cloned `NetWorthChart`. Save issues a partial `PUT` to the existing preferences endpoint.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Math lib | Pure, table-tested `fire.ts` (real-return, projection, milestones) | Off-by-one on compounding / nominal-real mixing — the central correctness hazard |
| 2. Persistence | Migration + regen types + extended API with range validation | Stale `database.types.ts` fails CI; getting RLS/defaults right |
| 3. Page + form | `/dashboard/fire`, seeded principal, live-recompute island, disclaimer | react-compiler compliance; live-recompute UX |
| 4. Chart | Cloned projection chart wired to live recompute | Empty / never-reaches-FI rendering; light/dark + mobile legibility |

**Prerequisites:** S-01, S-02, S-05 (all done). Local Supabase running for the migration. Net worth assets present to seed a meaningful principal.
**Estimated effort:** ~2–3 sessions across the four phases; Phase 1 is the highest-value, highest-risk and should be fully green before any UI.

## Open Risks & Assumptions

- Single-expenses-field assumption: current expenses double as retirement-target spend (no separate retirement-spend input in v1).
- Real-terms projection means chart values are "today's money" — must be clearly labelled or users will read them as nominal.
- Barista FIRE depends on an optional part-time-income input; when unset it collapses to the full FIRE number.

## Success Criteria (Summary)

- A user can open `/dashboard/fire`, see a projection seeded from their net worth, and get a correct retirement age that matches a hand/spreadsheet check.
- Editing inputs updates results and chart live; Save persists across reloads.
- The math is pinned by table-driven tests (FIRE number, projection crossing, unreachable, Coast/Barista) and the whole suite + typecheck + lint + build are green.
