---
bootstrapped_at: 2026-05-19T22:47:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: bitworth
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```
starter_id: 10x-astro-starter
package_manager: npm
project_name: bitworth
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

## Why this stack

BitWorth is a privacy-first personal net worth tracker for a solo user, built after-hours in ~3 weeks. The recommended default for `(web-app, js)` is Astro + Supabase + Cloudflare — it ships auth + database + edge deploy out of the box, covering the core MVP loop (email/password auth, asset management, currency conversion, snapshots, charting) without assembly. The stack passes all four agent-friendly gates: TypeScript end-to-end, strong Astro file-based conventions, well-documented across the Astro + Supabase + Cloudflare trio, and popular within the JS family. Auth feature flag is set; payments, realtime, AI, and background jobs are out of scope per the PRD non-goals. Cloudflare Pages is the deployment target with GitHub Actions auto-deploy-on-merge.

## Pre-scaffold verification

| Signal      | Value                              | Severity | Notes                                       |
| ----------- | ---------------------------------- | -------- | ------------------------------------------- |
| GitHub repo | przeprogramowani/10x-astro-starter | unknown  | gh not authenticated; pushed_at unavailable |
| npm package | not run                            | —        | git-clone strategy; no create-\* CLI        |

No npm recency check ran — git-clone strategy skips the npm step per pre-scaffold-verification.md.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 22
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold, README.md.scaffold, package.json.scaffold
**.gitignore handling**: append-merged against existing .gitignore lines (de-duped)
**.bootstrap-scaffold cleanup**: deleted

### File move detail

| File                      | Action                               |
| ------------------------- | ------------------------------------ |
| public/                   | moved silently                       |
| src/                      | moved silently                       |
| supabase/                 | moved silently                       |
| astro.config.mjs          | moved silently                       |
| components.json           | moved silently                       |
| eslint.config.js          | moved silently                       |
| package-lock.json         | moved silently                       |
| tsconfig.json             | moved silently                       |
| wrangler.jsonc            | moved silently                       |
| .env.example              | moved silently                       |
| .nvmrc                    | moved silently                       |
| .prettierrc.json          | moved silently                       |
| .github/                  | moved silently                       |
| .husky/                   | moved silently                       |
| .vscode/                  | moved silently                       |
| CLAUDE.md                 | existing wins; CLAUDE.md.scaffold    |
| README.md                 | existing wins; README.md.scaffold    |
| package.json              | existing wins; package.json.scaffold |
| .bootstrap-scaffold/.git/ | deleted before move-up               |

Note: `package.json` did not exist in cwd at scaffold time (cwd had only pre-chain files). It was surfaced as a `.scaffold` sibling for review, then promoted to cwd to enable `npm install`. The CLAUDE.md and README.md .scaffold siblings are genuine pre-existing file conflicts.

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 0 HIGH, 10 MODERATE, 0 LOW, 0 INFO
**Direct vs transitive**: not distinguished by npm audit (metadata.dependencies.direct unavailable in this output format)

#### CRITICAL findings

_(none)_

#### HIGH findings

_(none)_

#### MODERATE findings (10)

| Package                  | Via / Cause              |
| ------------------------ | ------------------------ |
| @astrojs/check           | @astrojs/language-server |
| @astrojs/cloudflare      | @cloudflare/vite-plugin  |
| @astrojs/language-server | volar-service-yaml       |
| @cloudflare/vite-plugin  | miniflare                |
| miniflare                | ws                       |
| volar-service-yaml       | yaml-language-server     |
| wrangler                 | miniflare                |
| ws                       | ws                       |
| yaml                     | yaml                     |
| yaml-language-server     | yaml                     |

All 10 MODERATE findings are **transitive** — they stem from dev-dependency tooling (language servers, type checkers, wrangler dev server) and do not affect the production runtime. Consider reviewing after the MVP is stabilized; they are not acute risk at this stage.

#### LOW / INFO findings

_(none)_

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history — done implicitly; the git-clone strategy deleted the cloned .git/ so your original repo history is preserved.
- Review any `.scaffold` siblings the conflict policy created (`CLAUDE.md.scaffold`, `README.md.scaffold`, `package.json.scaffold`) and decide which version of each file to keep.
- Copy `.env.example` to `.env` (or `.dev.vars` for Cloudflare local dev) and fill in your Supabase credentials.
- Address the 10 MODERATE audit findings per your project's risk tolerance — all are transitive dev-tooling advisories with no production impact.
- Run `npm run dev` to verify the dev server starts.
