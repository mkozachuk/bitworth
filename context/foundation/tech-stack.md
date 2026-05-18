---
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
---

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