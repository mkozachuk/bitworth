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

BitWorth is a privacy-first personal net worth tracker for a solo user, built after-hours in ~3 weeks. The recommended default for `(web-app, js)` is Astro + Supabase + Cloudflare — it ships auth + database + edge deploy out of the box, covering the core MVP loop (email/password auth, asset management, currency conversion, snapshots, charting) without assembly. The stack passes all four agent-friendly gates: TypeScript end-to-end, strong Astro file-based conventions, well-documented across the Astro + Supabase + Cloudflare trio, and popular within the JS family. Auth feature flag is set; payments, realtime, AI, and background jobs are out of scope per the PRD non-goals. Cloudflare Pages is the deployment target with GitHub Actions auto-deploy-on-merge.
