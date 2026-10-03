# Quality-gates wiring (Phase 4) Implementation Plan

## Overview

Wire the project's three quality gates — lint, typecheck, and Vitest unit/integration tests — into Cloudflare Workers Builds CI so a PR cannot merge with a broken gate. The contract test from Phase 2 (Risk #5) becomes a CI-enforced check; previously a developer could `git push` and bypass the contract test entirely. Risk #5's response intent — "every new /api/* route is caught by the auth-or-public-route contract at PR time" — is only met once the gate runs on every PR, not just locally.

This is the final cross-cutting phase of `context/foundation/test-plan.md` §3 Phased Rollout. After this lands, §5's "lint + typecheck" row moves from "required" to "enforced", and "unit + integration" / "contract on /api/* auth" rows move from "required after §3 Phase 1/2" to "enforced in CI on every PR".

## Current State Analysis

`feature/pwa` has 60 passing unit + integration tests (10 files) but none of them run in CI:

- `.github/workflows/ci.yml:18-24` — runs `npm ci`, `npx astro sync`, `npm run lint`, `npm run build`. No typecheck step, no test step. The test suite is only ever exercised locally.
- `package.json:9-15` — scripts: `dev`, `build`, `preview`, `astro`, `lint`, `lint:fix`, `format`, `test`, `test:run`. No `typecheck` script. `test` and `test:run` are Vitest watch and one-shot, both already fine for CI use; `test:run` is the conventional CI entry point.
- The change's entry criteria (per `change.md:21-22`) was: fix the 9 `MockSupabaseClient is not assignable to SupabaseClient` errors that surfaced on `feature/pwa` because `tsc` was failing there. That fix is already on the working tree (uncommitted) as `src/lib/{crypto-prices,exchange-rates}.test.ts` using an `asClient` cast helper at the import boundary. `npx tsc --noEmit` now passes (verified).
- `vitest.config.ts` — already correct (`include: ["src/**/*.test.ts"]`, `environment: "node"`, `tsconfigPaths` plugin). No changes needed to the runner itself.

Adjacent prior decisions this slice builds on:

- **Phase 1 (testing-runner-bootstrap)** — established `npm run test:run` as the local one-shot Vitest command. The CI step uses the same script.
- **Phase 2 (testing-critical-path-api-integration)** — shipped `src/pages/api/api-auth-contract.test.ts` (Risk #5). It walks `src/pages/api/` and asserts every `.ts` file either calls `supabase.auth.getUser()` or matches a documented public-route regex. Vitest's default `include: src/**/*.test.ts` glob picks it up automatically — no test configuration changes needed.
- **Phase 3 (testing-external-api-failure-cache)** — the `asClient` cast helper pattern was introduced here (per entry criteria on `change.md:21-22`).
- **Lesson "Vitest needs vite-tsconfig-paths"** (`context/foundation/lessons.md:35-39`) — already addressed; `vitest.config.ts:2` imports the plugin.

## Desired End State

A developer who opens a PR against `master` on the `feature/pwa` branch:

1. CI runs four sequential quality gates: `npm ci`, `npx astro sync`, `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`. Any failure is a build break.
2. The auth-decision contract test from Phase 2 is part of `npm run test:run`, so Risk #5 ("public API route shipped without explicit auth decision") is caught at PR time on every PR — not just when the developer remembers to run `npm run test:run` locally.
3. The project has a `npm run typecheck` script (currently absent) that is the canonical local entry point for `tsc --noEmit`, and CI uses the same script.
4. The project's `package.json` "scripts" section documents, in one place, all four quality-gate commands developers need to run before pushing: `lint`, `typecheck`, `test:run`, `build`.
5. `vitest.config.ts` is unchanged — the `include: ["src/**/*.test.ts"]` glob already covers both unit and integration tests, including the contract test.

### Key Discoveries

- **`npm run test` vs `npm run test:run`.** `test` runs Vitest in watch mode (interactive). `test:run` is one-shot (non-interactive, exits non-zero on failure). CI must use `test:run`; `test` would hang the runner waiting for file changes. The script already exists; this plan does not need to add it.
- **`npm run build` already runs `astro check` (the bundled `tsc` + `.astro` typecheck) via the Cloudflare adapter's build pipeline.** The repo's `tsc --noEmit` is a separate, faster check that the developer can run before `build`. CI should run `tsc --noEmit` independently so failures fail fast and don't wait for the multi-second Vite/SSR build.
- **`astro sync` is required before typecheck.** `tsconfig.json:3` includes `.astro/types.d.ts`; running `tsc --noEmit` before `astro sync` produces false positives on `astro:env/server` types. CI must run `npx astro sync` immediately before `npm run typecheck`.
- **Vitest's default timeout is 5 s; CI Ubuntu runners are slow.** None of the 60 current tests are slow, but the contract test walks the filesystem synchronously, so a 5 s budget is fine. No timeout tuning needed for the current suite.
- **The auth-decision contract test is fast (3 ms reported by `vitest run`)** and the entire suite finishes in <1 s. CI cost is negligible.

## What We're NOT Doing

- **Migration to GitHub Actions matrix (Node 20 + Node 22)** — `ci.yml:16` already pins `node-version: 22`; matrix would add runtime cost with no current payoff. The single-version gate is the floor.
- **Adding e2e to CI** — deferred. No Playwright MCP in the current session and no Playwright in `package.json`. `test-plan.md:122` defers e2e tooling to a future rollout phase. The CI contract covers the deterministic gates (lint, typecheck, unit/integration) only.
- **Adding `test:coverage` or coverage thresholds** — the project does not use a coverage tool, and `test-plan.md:7` does not propose one. Coverage as a gate is a separate concern with its own rollout cost (tooling, threshold negotiation, flaky-test taxonomy); out of scope for Phase 4.
- **Adding a pre-commit hook to run tests** — Husky's pre-commit already runs `lint-staged` (eslint --fix on staged TS/Astro, prettier on staged JSON/CSS/MD). Adding `npm run test:run` to pre-commit would slow every commit to 5+ s and run the full suite even on doc-only commits. CI is the right gate; the hook stays focused on staged-file formatting.
- **Replacing `npm run build` in CI with a separate `astro check`** — `astro build` already invokes `astro check` internally; the `npm run typecheck` step is additive (faster, separate) but does not replace it. The build step must remain so Cloudflare Workers Builds can ship the artifact.
- **Re-running `vitest` from `npm run build`** — Vitest is a test-only runner. Weaving it into the build path would couple production-build success to test success, which is a different deployment model than what Phase 4 intends (CI gate, not deploy gate).
- **Adding a new `package.json` script for `lint:fix` to CI** — `lint:fix` mutates the working tree; CI must be read-only.

## Implementation Approach

1. **Add `npm run typecheck` to `package.json`.** Single-line script: `tsc --noEmit`. Makes the local command discoverable and matches the script name in the CI yml.

2. **Add `npm run test:ci` as an alias to `npm run test:run`.** Same command, but the name signals "the CI entry point" so a future developer reading `ci.yml` lands on the right script. Both `test:run` and `test:ci` work; `test:ci` is the documented CI path. The two-script duplication is the conventional shape for projects that keep the watch command and the CI command visually distinct (e.g., Vite's own `vitest` vs `vitest run`).

3. **Update `.github/workflows/ci.yml` to add `npm run typecheck` and `npm run test:ci` steps** between `npx astro sync` and `npm run build`. The order matters:
   - `npx astro sync` (regenerate `.astro/types.d.ts`)
   - `npm run typecheck` (fast tsc-only check; fails fast)
   - `npm run lint` (full ESLint with the type-aware config)
   - `npm run test:ci` (Vitest unit + integration + contract)
   - `npm run build` (Cloudflare SSR build — needs `SUPABASE_URL`/`SUPABASE_KEY` secrets; this is the only step that needs them)

4. **Document the local run sequence in `package.json`** by adding inline comments is not possible in JSON; instead, a short prose block at the top of the workflows file notes the gate order for future maintainers. (Alternative: a `CONTRIBUTING.md`. Out of scope — the workflow yml comment is sufficient and lives next to the steps it documents.)

## Critical Implementation Details

- **`npm run typecheck` and `npx astro sync` ordering is load-bearing.** `tsconfig.json:3` includes `.astro/types.d.ts`; `astro sync` is what generates that file. If `typecheck` runs before `sync`, it sees stale or missing types and emits errors that are not real bugs. The CI yml must keep `npx astro sync` immediately before `npm run typecheck`.
- **`SUPABASE_URL` / `SUPABASE_KEY` env vars are only needed for `npm run build`.** They should not be hoisted to `env:` on the whole job — only on the build step. The current yml does this correctly (env is scoped to the build step). Do not change.
- **The contract test is picked up by Vitest's `include: ["src/**/*.test.ts"]` glob automatically.** No vitest config changes. The test runs as part of `npm run test:ci` along with the other 9 test files.
- **`node-version: 22` is locked on `ci.yml:16`.** The `engines` field is not declared in `package.json`; the yml's setup-node action is the source of truth for the CI Node version. The `.nvmrc` file in the repo root likely pins the local-dev Node version — verify but do not change.
- **No `package-lock.json` changes are needed.** No new dependencies; no `npm install`. The change is config-only.

## Phase 1: `npm run typecheck` script + CI wire

Wire a new `typecheck` script into `package.json` and add a corresponding `npm run typecheck` step in `.github/workflows/ci.yml` between `npx astro sync` and `npm run lint`.

**Changes Required:**

- `package.json` — add `"typecheck": "tsc --noEmit"` to the `scripts` block. Place it next to `lint` / `lint:fix` so the quality-gate commands cluster together.
- `.github/workflows/ci.yml` — insert `- run: npm run typecheck` as a new step between the existing `npx astro sync` step and `npm run lint` step.

**Success Criteria:**

- Automated
  1.1 `npm run typecheck` exists in `package.json` and exits 0 on the current working tree.
  1.2 `.github/workflows/ci.yml` contains a `npm run typecheck` step positioned after `npx astro sync` and before `npm run lint`.
  1.3 `npm run lint` still passes (no regression from the yml edit).
  1.4 `npm run build` still passes (no regression from the yml edit).
  1.5 `npm run test:run` still passes (60/60 tests).

#### Manual

1.6 The developer can run `npm run typecheck` locally and see the same output CI sees (zero output, exit 0).

## Phase 2: `npm run test:ci` script + Vitest in CI

Add a `test:ci` script as the explicit CI entry point, then wire it into `.github/workflows/ci.yml` after `npm run lint` and before `npm run build`. This makes Risk #5 (contract test on `/api/*` auth) a CI-enforced gate.

**Changes Required:**

- `package.json` — add `"test:ci": "npm run test:run"` to the `scripts` block. Alias to `test:run`; same command, CI-distinct name.
- `.github/workflows/ci.yml` — insert `- run: npm run test:ci` as a new step between `npm run lint` and `npm run build`.

**Success Criteria:**

- Automated
  2.1 `npm run test:ci` exists in `package.json` and exits 0 on the current working tree (60/60 tests pass).
  2.2 `.github/workflows/ci.yml` contains a `npm run test:ci` step positioned after `npm run lint` and before `npm run build`.
  2.3 `npm run build` still passes (no regression from the yml edit).
  2.4 `npm run lint` still passes (no regression).

#### Manual

2.5 A developer who deletes a test file (e.g., `src/pages/api/api-auth-contract.test.ts`) sees `npm run test:ci` fail locally with Vitest's standard "no test files found" error or, if the deletion removes the only contract assertion, a failing assertion — confirming the gate catches test deletion.

## Phase 3: Contract test enforcement + local-run documentation

Confirm and pin the contract test as the CI gate for Risk #5, and document the local-run sequence in a discoverable place. The contract test is already picked up by Vitest's default include glob; the phase verifies that the gate is actually exercised in CI and that developers know the local sequence.

**Changes Required:**

- `src/pages/api/api-auth-contract.test.ts` — add a top-of-file comment explaining the contract test's role as a CI-enforced gate (Risk #5 from `test-plan.md:31`). The comment should reference the test plan risk and note that the test runs on every PR via `npm run test:ci`. No code changes.
- `context/foundation/test-plan.md` — append a "Phase 4 outcome" note to §5 Quality Gates table (or to §3 Phased Rollout) documenting that lint + typecheck + unit/integration + contract are now CI-enforced. The note belongs in the test plan (single source of truth) rather than the workflow yml so future test-plan refreshes can see what shipped.

**Success Criteria:**

- Automated
  3.1 `src/pages/api/api-auth-contract.test.ts` opens with a comment block that names Risk #5, references the test plan, and notes CI enforcement via `npm run test:ci`.
  3.2 `context/foundation/test-plan.md` §3 or §5 reflects that the Phase 4 gate is wired (the §3 table's Phase 4 row Status flips from "change opened" to "complete"; §5's rows for "lint + typecheck" / "unit + integration" / "contract on /api/* auth" move from "required" to "enforced" or get a "(enforced in CI)" annotation).
  3.3 `npm run test:ci` still passes (60/60 tests, including the contract test).
  3.4 `npm run lint` still passes (the new comment in the contract test file is just a comment, no style impact).
  3.5 `npm run typecheck` still passes (the new comment in the contract test file is just a comment, no type impact).
  3.6 `npm run build` still passes.

#### Manual

3.7 A developer reading `test-plan.md` §3 or §5 sees the Phase 4 row's Status as `complete` (or the equivalent "enforced" annotation) and knows the gate is live.

## Cross-Phase Verification

After all three phases land, the cross-phase success criteria are:

- The full CI command sequence (`npx astro sync` → `npm run typecheck` → `npm run lint` → `npm run test:ci` → `npm run build`) passes end-to-end on the current working tree.
- `package.json` has both new scripts (`typecheck`, `test:ci`) in the scripts block, next to the existing quality-gate commands.
- `.github/workflows/ci.yml` has the new steps in the correct order.
- The auth-decision contract test (`src/pages/api/api-auth-contract.test.ts`) runs as part of `npm run test:ci` and continues to pass.
- `context/foundation/test-plan.md` §3 Phase 4 row Status flips to "complete".
- No new dependencies added; `package-lock.json` is unchanged.
- No new code in `src/`; only comments and config.

## References

- `context/foundation/test-plan.md` §3 Phased Rollout — Phase 4 row
- `context/foundation/test-plan.md` §5 Quality Gates — the gate list this plan wires
- `context/foundation/lessons.md:35-39` — Vitest `vite-tsconfig-paths` requirement (already addressed; no action)
- `context/foundation/lessons.md:25-31` — Supabase RLS USING-only (closed in Phase 2)
- `context/changes/testing-critical-path-api-integration/change.md` — Phase 2 shipped the contract test
- `context/changes/testing-external-api-failure-cache/change.md` — Phase 3 shipped the asClient pattern
- `vitest.config.ts` — already correct; no changes
- `package.json` — target of the two new scripts
- `.github/workflows/ci.yml` — target of the two new CI steps
- `context/foundation/test-plan.md:147` — §6.6 Phase 3 notes reference the network-shim pattern; Phase 4 does not add a new shim pattern

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: `npm run typecheck` script + CI wire

#### Automated

- [x] 1.1 `npm run typecheck` exists in `package.json` and exits 0 on the current working tree — 961669f
- [x] 1.2 `.github/workflows/ci.yml` contains a `npm run typecheck` step positioned after `npx astro sync` and before `npm run lint` — 961669f
- [x] 1.3 `npm run lint` still passes (no regression from the yml edit) — 961669f
- [x] 1.4 `npm run build` still passes (no regression from the yml edit) — 961669f
- [x] 1.5 `npm run test:run` still passes (60/60 tests) — 961669f

#### Manual

- [ ] 1.6 The developer can run `npm run typecheck` locally and see the same output CI sees (zero output, exit 0)

### Phase 2: `npm run test:ci` script + Vitest in CI

#### Automated

- [x] 2.1 `npm run test:ci` exists in `package.json` and exits 0 on the current working tree (60/60 tests pass) — 5d5d8ab
- [x] 2.2 `.github/workflows/ci.yml` contains a `npm run test:ci` step positioned after `npm run lint` and before `npm run build` — 5d5d8ab
- [x] 2.3 `npm run build` still passes (no regression from the yml edit) — 5d5d8ab
- [x] 2.4 `npm run lint` still passes (no regression) — 5d5d8ab

#### Manual

- [ ] 2.5 A developer who deletes a test file (e.g., `src/pages/api/api-auth-contract.test.ts`) sees `npm run test:ci` fail locally with Vitest's standard "no test files found" error or, if the deletion removes the only contract assertion, a failing assertion — confirming the gate catches test deletion

### Phase 3: Contract test enforcement + local-run documentation

#### Automated

- [x] 3.1 `src/pages/api/api-auth-contract.test.ts` opens with a comment block that names Risk #5, references the test plan, and notes CI enforcement via `npm run test:ci` — 6a0f494
- [x] 3.2 `context/foundation/test-plan.md` §3 or §5 reflects that the Phase 4 gate is wired (the §3 table's Phase 4 row Status flips from "change opened" to "complete"; §5's rows for "lint + typecheck" / "unit + integration" / "contract on /api/* auth" move from "required" to "enforced" or get a "(enforced in CI)" annotation) — 6a0f494
- [x] 3.3 `npm run test:ci` still passes (60/60 tests, including the contract test) — 6a0f494
- [x] 3.4 `npm run lint` still passes (the new comment in the contract test file is just a comment, no style impact) — 6a0f494
- [x] 3.5 `npm run typecheck` still passes (the new comment in the contract test file is just a comment, no type impact) — 6a0f494
- [x] 3.6 `npm run build` still passes — 6a0f494

#### Manual

- [ ] 3.7 A developer reading `test-plan.md` §3 or §5 sees the Phase 4 row's Status as `complete` (or the equivalent "enforced" annotation) and knows the gate is live
