---
project: bitworth
researched_at: 2026-05-19
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro v6 (SSR + React 19 islands)
  runtime: Cloudflare Workers (workerd)
  database: Supabase (Postgres via @supabase/ssr)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The tech stack is already built for Cloudflare via `@astrojs/cloudflare` adapter v13+. Astro v6 + React 19 + TypeScript 5 + Supabase SSR all run natively on the Workers runtime. The free tier covers 10k–100k requests/month at $0 cost. The developer already has Cloudflare familiarity. This is the lowest-friction path to production — no adapter swap, no new tooling to learn, and the MCP server ecosystem (17 remote servers, all publicly available) provides rich agent operability. Q1 (no persistent connections), Q2 (minimize cost), Q4 (single region), and Q5 (external providers fine) all align with the Workers model.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | **Pass** | **Pass** | **Pass** | **Pass** | **Pass** | **5/5** |
| **Vercel** | **Pass** | **Pass** | **Pass** | **Pass** | **Partial** (MCP beta) | **4.5/5** |
| Netlify | **Pass** | **Pass** | **Pass** | **Pass** | **Pass** | **5/5** |
| Fly.io | **Pass** | **Pass** | **Pass** | **Pass** | **Pass** | **5/5** |
| Railway | **Pass** | **Pass** | **Partial** (no llms.txt) | **Partial** (no rollback command) | **Pass** | **4/5** |
| Render | **Pass** | **Pass** | **Pass** | **Pass** | **Pass** | **5/5** |

**Hard filters applied:** Q1 (no persistent connections required) — no hard blockers. All six platforms remain eligible. Q2 (minimize cost) penalizes platforms with non-zero baseline costs (Railway $5/mo minimum, Fly.io no permanent free tier). Q3 (existing Cloudflare familiarity) breaks a tie between Cloudflare and Vercel — the Cloudflare familiarity eliminates the Vercel option's DX advantage. Q5 (external providers fine) neutralizes the co-location advantage of Netlify, Railway, and Render.

**Soft weights applied:** Cost minimization (Q2) pushes Cloudflare and Vercel to the top (both have generous free tiers). Existing familiarity (Q3) is decisive — the developer already knows Cloudflare, making the learning-curve cost of all alternatives non-zero.

### Why Cloudflare Workers wins

- Tech stack is already `@astrojs/cloudflare` — no adapter migration needed.
- Free tier: 100k requests/day, unlimited static assets, 5 GB D1, 10 GB R2, 200k log events/day (3-day retention). At 10k–100k monthly requests, cost is **$0**.
- `wrangler` CLI covers every operation: deploy, rollback, secrets, log tailing, version management. Fully non-interactive.
- 17 remote MCP servers (Workers Bindings, Workers Build Insights, Workers Observability, Docs, API). First-class agent integration.
- `llms.txt` at `developers.cloudflare.com/workers/llms.txt` — explicitly designed for AI agent consumption.
- Supabase (external provider, per Q5) handles database, auth, and realtime — no co-location needed.

### Why Vercel is the runner-up

- `@astrojs/vercel` adapter is production-ready (v10.0.7). Astro SSR fully supported on serverless.
- Strong docs (`llms.txt` at `vercel.com/docs/llms.txt`), structured CLI output, stable deploy API.
- MCP server exists but is **beta** (as of 2026-02-12) — not a reliable agent automation surface yet.
- Free tier: 1M serverless invocations/month on Hobby. At 10k–100k requests, cost is also $0.
- **Disqualifier for this project**: requires switching from `@astrojs/cloudflare` to `@astrojs/vercel` — a meaningful migration that adds risk for zero gain since the developer already knows Cloudflare.

### Why Netlify is third

- `@astrojs/netlify` adapter is stable, MCP server is GA, docs are excellent.
- Serverless-only model — no persistent processes, which is acceptable given Q1 (no persistent connections needed).
- Credit-based pricing since Sep 2025. Free tier (300 credits/month) could run $0–$5/mo at MVP traffic. Not free like Cloudflare's free tier.
- Cloudflare Pages is dead (removed in `@astrojs/cloudflare` v13), but the developer already chose Cloudflare — this reinforces rather than changes the decision.

### Why Railway and Render score lower

- Railway: No `llms.txt` docs (Partial), no documented rollback command (Partial), WebSocket timeout at ~50 minutes (less relevant given Q1 but noted).
- Render: Strong contender. Persistent containers, GA MCP server, Astro SSR template, $0 free tier. Scores 5/5. Disadvantaged by Q3 (no existing familiarity) — the developer would need to learn the Render CLI and deploy workflow from scratch. Cloudflare has a lower effective cost here due to familiarity leverage.

### Why Fly.io is dropped

- Scores 5/5 on criteria. The decisive factor is Q2 (minimize cost) + Q3 (existing Cloudflare familiarity): Fly.io has no permanent free tier (ended Jul 2024), requires learning `flyctl`, and the tech stack is already Cloudflare-native. No reason to migrate.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The `workerd` runtime is not Node.js.** `@astrojs/cloudflare` v13 removed `Astro.locals.runtime` — runtime access now requires direct imports from `cloudflare:workers`. Any code that relies on Node.js APIs (fs, path, crypto.NodeJS built-ins) must be rewritten or bundled via the `nodejs_compat` flag. Supabase's `@supabase/ssr` package uses standard fetch — it works, but any middleware or server-side utility that touches Node APIs needs auditing.
2. **Free tier CPU limit is 10ms/invocation.** Astro SSR at 10ms CPU per request is achievable for simple pages, but a snapshot-heavy dashboard with multiple currency lookups could push above that threshold. The app needs to stay under 10ms CPU per invocation on the free tier, or the $5/mo paid plan is required — which breaks the zero-cost goal.
3. **`--assets` flag is beta.** The `wrangler deploy --assets` flag (for serving static assets from Workers) is in beta as of May 2026. If it changes or breaks, the deployment workflow needs updating. Static assets work fine without it via Workers' built-in static file serving, but the beta flag signals potential instability.
4. **Workers KV eventual consistency is up to 60 seconds.** If the app ever stores session data or user preferences in Workers KV, writes propagate globally in up to 60 seconds. For auth tokens this is usually fine (Supabase handles auth), but any caching strategy built on Workers KV must account for stale reads.
5. **Cloudflare Pages is deprecated for SSR.** v13 of the adapter removed Pages support entirely. If the developer ever tries to deploy via a Pages-oriented workflow (GUI, Git integration via Pages), it will fail silently or error. All deployment must go through `wrangler` — the GUI is not a valid path for this project.

### Pre-Mortem — How This Could Fail

Six months in, the Astro SSR app is running on Cloudflare Workers, but the developer is fighting a recurring problem: certain pages consistently hit the 10ms CPU limit on the free tier. The dashboard, which renders asset charts and pulls Supabase data, takes too long to execute on the workerd runtime. Supabase's server-side auth middleware adds 4–6ms of overhead that compounds with page rendering time. Every month at billing review, the developer toggles between free-tier CPU starvation and the paid plan's 30ms limit, trying to find the threshold. Meanwhile, a `require()` statement from a new dependency slipped through CI (the linter didn't catch it because the file is compiled by Vite, not directly linted) and breaks silently in production — assets load but the exchange rate fetch on the dashboard fails without a clear error. The developer spends a weekend auditing every dependency for CommonJS syntax, becomes more conservative about adding packages, and the app's development velocity slows. The GCP-vs-Cloudflare friction that made Cloudflare the obvious choice at the start has inverted: the runtime quirks that seemed manageable during research are now daily friction.

### Unknown Unknowns

1. **Astro's `output: 'server'` on Workers has a specific cold-start behavior.** Workers cold-start is fast (under 50ms typically), but Astro SSR with Supabase session verification adds a round-trip to Supabase on every request. The auth middleware in `src/middleware.ts` runs server-side — if Supabase is slow to respond, the page load time exceeds the 2-second NFR. The solution is to add caching headers to Supabase's session endpoint, but this isn't documented in the Astro-Cloudflare-Supabase integration guides because it's a niche combination.
2. **`@supabase/ssr` cookie handling on Workers has edge cases.** The `@supabase/ssr` package is designed for Node.js and Cloudflare Workers, but Supabase's cookie verification is async. Workers has a 50ms CPU budget for async operations before they start contending with the main execution thread. At high concurrency, this can cause subtle latency spikes that are hard to reproduce locally with `wrangler dev`.
3. **The `@astrojs/cloudflare` adapter v13 has breaking changes from v12.** If the developer ever needs to look up v12 documentation (Stack Overflow, blog posts, older tutorials), it may be misleading. The adapter removed `Astro.locals.runtime`, `cloudflareModules`, and Pages support — none of these are mentioned in the migration guide. A future agent reading older docs will make incorrect recommendations.
4. **Workers log retention is 3 days on free tier.** If something breaks and the developer doesn't notice within 3 days, there is no log trail. For a personal project maintained after-hours, this means the developer must check production regularly or risk having no debugging data when something goes wrong.
5. **`wrangler deploy` does not guarantee atomic zero-downtime.** Workers deploys are rolling by default (old instances stay live until the new ones are healthy), but for very fast deploys or low-traffic periods, there's a window where the old version serves some requests and the new version serves others. Astro SSR with database migrations should be tested: if a migration runs mid-deploy, old code touching new schema could error out.

## Operational Story

- **Preview deploys**: Every pull request to GitHub triggers a Cloudflare Pages preview deployment (via GitHub Actions). Preview URLs are public by default — they can be protected with Cloudflare Access (zero-trust, per-email invite) if the developer wants auth-gated previews.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` are stored in Cloudflare Workers Secrets via `wrangler secret put`. The Wrangler deploy command picks them up automatically. Rotation: run `wrangler secret put SUPABASE_KEY` with the new value — the next deploy activates it atomically.
- **Rollback**: `wrangler rollback [VERSION_ID]` reverts to a previous Workers version. Typical time-to-revert: under 30 seconds. Note: DB migrations do not roll back automatically — if a migration changed schema, manual DB fix is required.
- **Approval**: The agent may deploy to staging (Workers development environment) unattended. Production deploy requires a human action: either `wrangler deploy --env production` run manually, or a GitHub Actions workflow that gates on a manual approval step.
- **Logs**: `wrangler tail bitworth --status error --format json` streams live logs, filtered to errors. For programmatic log parsing: `wrangler tail bitworth --format json | jq '.exceptions'` to extract stack traces.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| CPU limit exceeded on free tier (10ms/invocation) | Devil's advocate | Medium | Medium | Profile dashboard rendering; cache Supabase session checks; move heavy currency conversion to client-side; consider paid plan ($5/mo) only if needed |
| CommonJS dependencies break at runtime | Devil's advocate | Low | High | Add a Vite plugin rule to error on any unresolved `require()` in the bundle; add a `wrangler dev` smoke test to CI |
| `--assets` flag instability (beta) | Devil's advocate | Low | Low | Use Workers built-in static serving instead of `--assets`; avoid the beta flag |
| Workers KV stale reads (60s propagation) | Devil's advocate | Low | Low | Don't use Workers KV for user-specific state; Supabase handles all state |
| Cloudflare Pages deprecated for SSR | Devil's advocate | Low | Medium | Ensure all deployment goes through `wrangler`, not Pages GUI; add a CI check that Pages-targeted configs fail |
| Supabase auth middleware adds latency on every request | Unknown unknowns | Medium | Medium | Cache Supabase session with short TTL; profile `/dashboard` page under real load before launch |
| `@supabase/ssr` cookie verification async overhead at high concurrency | Unknown unknowns | Low | Low | Test at 10+ concurrent users; note that for a solo user MVP this is unlikely to be a problem |
| v12 docs are misleading for v13 adapter | Unknown unknowns | Medium | Medium | Bookmark the v13 docs: `docs.astro.build/en/guides/integrations-guide/cloudflare/`; write a CLAUDE.md note warning about v12/v13 differences |
| Workers log retention only 3 days on free tier | Unknown unknowns | Medium | Medium | Set a weekly calendar reminder to check production health; subscribe to Cloudflare email alerts for errors |
| Non-atomic deploy window (migration + code deploy) | Unknown unknowns | Low | High | Run DB migrations separately before deploys; use a two-step deployment with migration-step + code-step |

## Getting Started

1. **Install Wrangler** (if not already installed):
   ```bash
   npm install -g wrangler
   ```
   Confirm version: `wrangler --version` (should be 4.x for the latest features).

2. **Add secrets to Workers**:
   ```bash
   wrangler secret put SUPABASE_URL
   # (prompts for value — paste from .dev.vars)
   wrangler secret put SUPABASE_KEY
   # (prompts for value — paste from .dev.vars)
   ```

3. **Deploy to production**:
   ```bash
   wrangler deploy --env production
   ```
   This deploys the current working directory to the `production` Workers environment. The first deploy creates the Worker; subsequent deploys update it in-place with rolling (zero-downtime) replacement.

4. **Verify the deploy**:
   ```bash
   wrangler tail bitworth --status error --format json
   # Then open https://bitworth.pages.dev (or your mapped domain) in a browser
   ```

5. **Set up GitHub Actions auto-deploy** (already configured per `tech-stack.md` CI setup):
   - Create a Cloudflare API token at `dash.cloudflare.com/profile/api-tokens` with "Account:Workers AI:Edit" scope.
   - Add `CLOUDFLARE_API_TOKEN` to GitHub repo secrets.
   - GitHub Actions workflow at `.github/workflows/deploy.yml` already runs `wrangler deploy` on merge to `main`.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions workflow already exists)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare Durable Objects, D1, R2, or other in-platform services (Supabase handles the data layer per Q5)