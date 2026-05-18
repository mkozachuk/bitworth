---
bootstrapped_at: 2026-05-18T23:03:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: bitworth
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
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

Solo developer building a web-based net worth tracker in 3 weeks (after-hours only) with auth,
currency conversion, and snapshot history. The recommended default for `(web-app, js)` — Astro +
React + TypeScript + Supabase + Cloudflare — covers all three core requirements: Supabase handles
authentication and PostgreSQL data storage with Row Level Security (matching the flat user model
and privacy requirement), TypeScript across Astro and Supabase gives explicit types end-to-end, and
Cloudflare Pages deployment is the starter's default. The `first-class` bootstrapper confidence
means the stack is registered with a valid CLI but hasn't been battle-tested end-to-end yet —
mostly-smooth scaffolding with occasional manual steps to expect. Auth is detected from PRD FRs
(FR-001, FR-002); no payments, realtime, AI, or background jobs are in scope per PRD non-goals.

## Pre-scaffold verification

| Signal             | Value                              | Severity | Notes                              |
| ------------------ | ---------------------------------- | -------- | ---------------------------------- |
| GitHub repo        | przeprogramowani/10x-astro-starter | not run  | gh not authenticated; skipped     |

Note: npm recency check was skipped because the cmd_template is `git clone` (not `npm create-*`).

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 35
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: append-merged (existing `.idea/` preserved; starter's patterns appended with separator comment)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 2 CRITICAL/2 HIGH/0 MODERATE/0 LOW direct of total 0/1/10/0 (via `isDirect` flag on each finding)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** v5.6.3–5.8.0 (via Astro)
  - Advisory GHSA-77vg-94rm-hx3p: Svelte devalue: DoS via sparse array deserialization
  - CVSS 7.5 (HIGH)
  - Fix available: upgrade devalue to fixed version
  - `isDirect: false` — transitive, pulled in by Astro's server-side rendering

#### MODERATE findings

| Package | Range | Via | Fix Available |
| ------- | ----- | --- | ------------- |
| @astrojs/check | >=0.9.3 | @astrojs/language-server | v0.9.2 |
| @astrojs/cloudflare | >=12.2.4 | @cloudflare/vite-plugin, wrangler | v12.6.13 |
| @astrojs/language-server | >=2.14.0 | volar-service-yaml | (fix via @astrojs/check) |
| @cloudflare/vite-plugin | <=0.0.0-fff677e35 \|\| >=0.0.7 | miniflare, wrangler, ws | (fix via @astrojs/cloudflare) |
| miniflare | <=0.0.0-fff677e35 \|\| >=3.20250204.0 | ws | (fix via wrangler) |
| volar-service-yaml | <=0.0.70 | yaml-language-server | (fix via @astrojs/check) |
| wrangler | <=0.0.0-kickoff-demo \|\| >=3.108.0 | miniflare | v3.107.3 |
| ws | 8.0.0–8.20.0 | Uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx) | (fix via wrangler) |
| yaml | 2.0.0–2.8.2 | Stack Overflow via deeply nested YAML (GHSA-48c2-rrv3-qjmp) | (fix via @astrojs/check) |
| yaml-language-server | 1.11.1–1.22.x | yaml | (fix via @astrojs/check) |

## Hints recorded but not acted on

| Hint                       | Value                              |
| -------------------------- | ---------------------------------- |
| bootstrapper_confidence    | first-class                        |
| quality_override           | false                              |
| path_taken                 | standard                           |
| self_check_answers         | null                               |
| team_size                  | solo                               |
| deployment_target          | cloudflare-pages                   |
| ci_provider                | github-actions                     |
| ci_default_flow            | auto-deploy-on-merge               |
| has_auth                   | true                               |
| has_payments               | false                              |
| has_realtime               | false                              |
| has_ai                     | false                              |
| has_background_jobs        | false                              |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
