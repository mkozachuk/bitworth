# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-02 (Phase 1: complete)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the risk wins. Do not promote to e2e because e2e "feels safer." Do not put a vision model on top of a deterministic visual diff that already catches the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team is worried about X, and the failure would surface somewhere in <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what could fail* and *why we believe it's likely* — drawn from documents, interview, and codebase *signal* (churn, structure, test base). It does NOT claim to know which line owns the failure. That knowledge is produced by `/10x-research` during each rollout phase. If the plan and research disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/` and `supabase/`. The scan ran over the last 30 days (18 commits in scope).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by risk = impact × likelihood. Risks are failure scenarios in user / business terms, not test names. The Source column cites the *evidence that surfaced this risk* — never a specific file as "where the failure lives" (that is research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|----------------------------------|
| 1 | Net worth total is wrong — a single asset's currency doesn't convert, a liability is treated as positive, or amounts are summed in raw units — and the user trusts the number for financial decisions. | High | High | interview Q1; interview Q3 hot-spot dir `src/components/assets/` (19 commits/30d); PRD FR-014 |
| 2 | Cross-tenant / authorization leak — user A can read or mutate user B's assets/snapshots via a missing session check or a missing owner check on a handler. | High | Medium | interview Q1; PRD FR-005 (strict account isolation) |
| 3 | Snapshot history integrity — POST creates an orphan parent row when items insert fails, or returns rows in the wrong order, so the trend chart displays values that never existed. | High | Medium | `context/foundation/lessons.md` §1; PRD FR-018; hot-spot dir `src/pages/api/snapshots/` (3 commits/30d) |
| 4 | External API (rates/crypto) failure with broken UI — fetch 4xx/5xx/timeout returns a blank, NaN, or hard crash instead of a cached or documented fallback. | High | Medium | PRD FR-013, FR-020; roadmap §S-03 (rates/crypto just shipped) |
| 5 | Public API route shipped without explicit auth decision — a new `/api/*` route (or a refactor) skips the session check that every other route has; the inconsistency isn't caught until prod. | High | Medium | `context/foundation/lessons.md` §2; PRD FR-005 |
| 6 | Crypto price cache poisoned by upstream 4xx — a non-200 body is written into the cache and read back as authoritative, biasing the net worth number until expiry. | Medium | Medium | roadmap §S-03; supabase migration `20260531223101_crypto_price_cache.sql` adds a cache table |

**Abuse / security lens applied.** Risks #2 and #5 cover authorization/access (ownership-vs-authentication) and the explicit-auth pattern. Risk #4 covers untrusted-input / external-boundary failure. Risk #6 covers data-integrity abuse via a poisoned cache. The product accepts user input and has auth, so these rows are mandatory under the lens.

**High × High priority.** Risk #1 is the only High × High row and is the natural first target.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|----------------------------------------|------------------------|------------------------|
| #1   | A unit test on the net worth calculation, given a known set of mixed-currency assets + a liability, produces a known total. Plus the dashboard renders the same total the API returns. | Happy-path single currency ⇒ mixed-currency correctness; "amount" as string vs number; liability sign convention; floating-point drift in summed conversions. | Amount unit (raw major vs micro); sign convention; where the conversion lives; what the dashboard display reads. | Unit on the calculation + small integration test on the dashboard render of the total. | Copying the formula from the implementation and asserting it returns itself (oracle problem). Expected total must come from an independent source. |
| #2   | A test where user A, authenticated, requests `/api/assets/<id of B>` and is denied (403/404). Same shape for `/api/snapshots`. | "Session exists ⇒ ownership is OK" — owner_id must be checked explicitly. Middleware auth does not imply handler auth. | How each handler obtains user_id; whether the row's owner_id column is a foreign key; whether SELECT filters by user_id. | Integration test on the handler with a stubbed Supabase user, asserting the WHERE clause includes the caller's user_id. | Mocking auth middleware to always return user A and only varying the URL — does not catch the case where auth is missing entirely. Mock at the request boundary, not the auth boundary. |
| #3   | A test that POST `/api/snapshots` with a valid payload creates parent + items atomically (no orphans), and the list returned to the chart is sorted by the contract's date key, not insertion order. | "First insert succeeded ⇒ second must have" (`lessons.md` §1 says it might not). "DB order = chart order" — sort by date, not id. | What wraps the inserts (transaction, `supabase.rpc`, sequential); what the chart sort key is. | Integration test on the handler with a controlled Supabase stub, asserting both rows present and the order. | Only asserting "200 OK" or asserting the parent row without checking items. The lesson is that items can fail independently. |
| #4   | A test that when rates/crypto fetch returns 4xx/5xx/timeout, the app uses the cached value (or a documented fallback) and the dashboard still renders a number. Plus the cache itself returns something usable when fresh. | "It worked in staging" — failures are timeouts, DNS errors, rate limits, 4xx, 200 with malformed body. | Which env vars; cache table shape; fallback path (cache vs manual vs last-known). | Unit on the fetcher (stubbed `fetch`) + unit on the dashboard display path that the fallback renders. | Only testing the happy path (fetch returns 200, number renders). The risk is the failure path. |
| #5   | A contract test that lists every file under `src/pages/api/` and asserts the session check is present (or an explicit, commented justification). Failing this is a build break. | "Public data, no auth needed" — that decision must be visible. The test enforces visibility, not banning public routes. | What the auth check looks like in this codebase; whether there is a helper; whether `lessons.md` documents the pattern. | Contract/lint test — cheaper than e2e and pins the lesson into a check. | Only testing routes that already have the check — does not prevent the next route from skipping it. |
| #6   | A unit test on the crypto price cache: when the upstream returns 4xx/5xx, the cache either does not write a new entry, or writes one explicitly marked as fallback. When the cache is read, fallback entries are not returned as authoritative. | "We got a response, we cached it" — but 4xx bodies are not prices. "The cache returned something" — but is it authoritative? | Shape of the `crypto_price_cache` row; how staleness/fallback is recorded; who reads the cache and how. | Unit on the cache read/write with controlled responses. | Stubbing the fetch to return a successful price and asserting the cache is populated — does not exercise the failure path that this risk is about. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status moves left-to-right through the values below; the orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|------------------|----------------|------------|--------|----------------|
| 1 | Runner bootstrap + first critical-path unit | Bootstrap Vitest and ship the first unit test on the net worth calculation. | #1 | unit | complete | `context/changes/testing-runner-bootstrap/` |
| 2 | Critical-path API integration | Integration tests on `/api/assets/[id]/` and `/api/snapshots/`, plus the auth-decision contract on `/api/*`. | #2, #3, #5 | integration (handler + Supabase stub) + contract | implementing | `context/changes/testing-critical-path-api-integration/` |
| 3 | External API failure & cache integrity | Unit tests on the rates/crypto fetcher and cache read/write for failure paths. | #4, #6 | unit (with `fetch` stub) + small integration on dashboard fallback render | not started | — |
| 4 | Quality-gates wiring | Wire lint + typecheck + Vitest unit/integration into CI; document local run command. | #5 (contract enforced in CI) | CI config | not started | — |

**Why no AI-native phase.** Risks are all deterministic correctness (data, auth, external API failure). The project has no AI surface, and visual snapshot tests are explicitly out of scope (see §7). Classic-only is the right call here.

**Why 4 phases, not 5.** Phase 4 (gates) is the only cross-cutting infrastructure, and §3 stays inside the 3–5 sweet spot.

**Phase 1 deferral — DOM integration test.** The §2 row #1 risk response guidance calls for "a small integration test on the dashboard render of the total" alongside the unit test. The dashboard ships the total from a `client:load` React island (`src/pages/dashboard.astro:45-68`); the formatted dollar figure only appears after hydration. No DOM testing library, no jsdom, no happy-dom is installed, and installing them expands Phase 1 beyond the test-only contract. The integration test is therefore **deferred to a follow-up phase that installs DOM tooling** (likely `@testing-library/react` + `jsdom` or `happy-dom`). The unit test on `computeNetWorth` is the floor; the dashboard render is the ceiling. A future `/10x-test-plan --refresh` that resurfaces this work must respect the deferral — do not silently drop it.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a `checked:` date so future readers can see which lines need re-verification. Recommendations in this section are grounded in local manifests/configs plus the MCP/tools actually exposed in the current session.

| Layer                | Tool                       | Version | Notes |
|----------------------|----------------------------|---------|-------|
| unit + integration   | Vitest                     | ^3.2.6  | Installed by §3 Phase 1. Config at `vitest.config.ts`; `npm run test:run` (one-shot) and `npm run test` (watch). ESM-native, Vite-first, no DOM tooling yet. |
| API mocking          | MSW (Mock Service Worker)  | TBD     | None yet — see Phase 1/2. Mock the network edge only; never mock internal modules. |
| e2e                  | Playwright                 | TBD     | None yet. No Playwright MCP in current session — defer until a rollout phase needs the full deployed shape. |
| accessibility        | axe-core                   | TBD     | None yet. Optional; only if a UI rollout phase surfaces a regression class. |
| (optional) AI-native | none                       | n/a     | No AI-native layer in this rollout. |

**Stack grounding tools (current session):**
- Docs: Context7 MCP — Astro / Supabase / Vitest / React docs reachable. checked: 2026-06-01
- Search: Exa.ai + WebSearch — for current tool status. checked: 2026-06-01
- Runtime/browser: not available in current session — Playwright MCP not present. checked: 2026-06-01
- Provider/platform: Linear MCP — issue tracking, not used in this guide. checked: 2026-06-01

## 5. Quality Gates

The full set of gates that must pass before a change reaches production. "Required for §3 Phase <N>" means the gate is enforced once that rollout phase lands; before that, the gate is `planned`.

| Gate                          | Where              | Required?                   | Catches                                       |
|-------------------------------|--------------------|------------------------------|-----------------------------------------------|
| lint + typecheck              | local + CI         | required                     | syntactic / type drift                        |
| unit + integration            | local + CI         | required after §3 Phase 1    | logic regressions                             |
| contract on `/api/*` auth     | local + CI         | required after §3 Phase 2    | new routes shipping without an explicit auth decision |
| e2e on critical flows         | CI on PR           | planned                      | broken critical user paths (deferred — no Playwright MCP in session) |
| post-edit hook                | local (agent loop) | recommended                  | regressions at edit time                      |
| visual diff (deterministic)   | CI on PR           | not used                     | — (out of scope per §7)                       |
| multimodal visual review      | CI on PR           | not used                     | — (no AI-native phase in this rollout)        |
| pre-prod smoke                | between merge + prod | not used                   | — (no staging environment in the baseline)     |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the relevant rollout phase ships; before that, the sub-section reads "TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Location**: co-located with the module under test, in `src/lib/` (or the module's directory if outside `src/lib/`). One test file per source file.
- **Naming**: `<module>.test.ts` next to `<module>.ts`. Vitest discovery is `src/**/*.test.ts` (see `vitest.config.ts`).
- **Reference test**: `src/lib/net-worth.test.ts` — the net worth calculation's three-case pattern (see §6.5 for the domain-specific flavour).
- **Run locally**: `npm run test:run` (one-shot, exits non-zero on failure) or `npm run test` (watch mode, re-runs on file save). No env vars required for pure-TS tests.

### 6.2 Adding an integration test

- **Location**: co-located with the handler under test. Test file is `<handler-path>/index.test.ts` (e.g., `src/pages/api/assets/index.test.ts`). The contract test is the exception: `src/pages/api/api-auth-contract.test.ts` lives at the surface under audit, not next to a single handler.
- **Mocking policy**: Mock at the request boundary. Pass a real `Request` to the handler; the handler's own `supabase.auth.getUser()` runs against the request; the mock for `createClient` returns a client whose `auth.getUser()` returns `{user: null}` when the `Cookie` header is missing. Varying only the URL while keeping the auth boundary mocked to "always user A" passes for both the bug and the fix — it proves nothing.
- **Documented exception**: `getRates` from `@/lib/exchange-rates` is mocked via `vi.mock("@/lib/exchange-rates", ...)` in the snapshot POST test because the helper is in-process. The "never mock internal modules" rule bends here for one helper; MSW setup is heavier than the problem.
- **`vi.mock("@/lib/supabase", ...)` is per-file boilerplate** because `src/lib/supabase.ts` imports from `astro:env/server`, which is a virtual module that does not resolve under Vitest. The shared factory lives at `src/test-utils/supabase-mock.ts`.
- **Reference test**: `src/pages/api/snapshots/index.test.ts` — the 6-scenario snapshot POST pattern.
- **Run locally**: `npm run test:run` (one-shot) or `npm run test` (watch). No env vars required.

### 6.3 Adding an e2e test

- TBD — deferred. No Playwright MCP in current session; revisit on the next e2e rollout phase.

### 6.4 Adding a test for a new API endpoint

- **Test type**: integration (preferred). The contract test from §3 Phase 2 is the floor; per-handler integration tests stack on top.
- **Pattern**:
  - **Floor**: `src/pages/api/api-auth-contract.test.ts` — every new route gets caught by the directory walk. The test requires either `supabase.auth.getUser()` (the canonical auth check) or a public-route comment matching `/\/\*?[\s\S]*?(intentionally (unauthenticated|public)|public route|explicit design decision)/i`. `auth/` endpoints are exempt from the auth-or-comment rule but must still call `createClient` (positive assertion).
  - **Ceiling**: per-handler integration test in `<handler-path>/index.test.ts`, using `src/test-utils/supabase-mock.ts`. The mock factory records every chainable method call into `recorded` (and per-builder `__recorded`) for assertions like "did the handler filter by user_id".
- **Reference test**: `src/pages/api/api-auth-contract.test.ts` (contract floor); `src/pages/api/snapshots/index.test.ts` (per-handler ceiling).
- **When to add e2e instead**: only if the endpoint's failure mode requires the full deployed shape (auth + cookie + handler crossing).

### 6.5 Adding a test for the net worth calculation / currency conversion

- **Location**: `src/lib/net-worth.test.ts` (co-located with `src/lib/net-worth.ts`).
- **Naming**: same as §6.1 — `<module>.test.ts` next to `<module>.ts`.
- **Reference test**: `src/lib/net-worth.test.ts` — `describe('computeNetWorth', ...)` with three cases:
  1. **Clean-oracle exact** — mixed-currency conversion with rates and inputs chosen to produce an integer total; assert `toBe(1700)` (no tolerance). Pins the formula against an independent hand-derived value, not a copy of the implementation.
  2. **Floating-point probe** — same fixture shape with non-round rates; assert `toBeCloseTo(value, 6)`. Also serves as a cent-scaling probe — fails if a future maintainer introduces ×100 / ÷100.
  3. **Liability-sign guard** — single-row fixture in two configurations (asset vs liability); assert the asset total is `500`, the liability total is `-500`, and asset total `>` liability total. Pins the sign convention.
- **Run locally**: `npm run test:run` (one-shot) or `npm run test` (watch).
- **Do not assert crypto valuation** — the net worth path does not call `getPrice()`; `quantity` is a display label, not a multiplier. A test for crypto valuation belongs in §3 Phase 3.

### 6.6 Per-rollout-phase notes

**Phase 2 — Critical-path API integration (change: `testing-critical-path-api-integration`).** Shipped 5 per-handler integration tests (Risks #2, #3) plus 1 directory-walking contract test (Risk #5). Shared test seam at `src/test-utils/supabase-mock.ts`. The contract test (`src/pages/api/api-auth-contract.test.ts`) walks `src/pages/api/` recursively and asserts every `.ts` file either calls `supabase.auth.getUser()` or matches the documented public-route regex; `auth/` endpoints are exempt but must call `createClient`. The per-handler tests assert: (a) `.eq("user_id", user.id)` is in the chain for the 5 authenticated handlers; (b) the PUT update payload for `/api/assets/[id]` does NOT contain `user_id` (the structural-property pin for the USING-only RLS gap); (c) the snapshot POST has 6 named scenarios including the lesson §1 worst case (both items insert and compensating delete fail). Documented `vi.mock` exception for `@/lib/exchange-rates` in §6.2. RLS `WITH CHECK` migration shipped under `supabase/migrations/<timestamp>_rls_with_check.sql` to close the USING-only gap at the database layer. **Scope addendum**: `crypto-price.test.ts` ships 3 scenarios (not 2 as the original Phase 2 contract specified) — the third asserts the 400 response when the required `symbol` query parameter is missing. Defensible boundary check; included for completeness.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future contributors should respect these unless the underlying assumption changes.

- **Generated Supabase TypeScript types** in `src/lib/database.types.ts` — the generator is the test, not the project. Re-evaluate if the project starts hand-editing the generated file. (Source: Phase 2 interview Q5.)

(No further exclusions negotiated in this rollout. Q5 yielded one strong answer; the rest of the surface is fair game.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-01
- Stack versions last verified: 2026-06-01
- AI-native tool references last verified: 2026-06-01

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
