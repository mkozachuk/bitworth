# Deployment Plan: BitWorth on Cloudflare Workers

## Context

BitWorth (Astro v6 SSR + React 19 + Supabase) is already configured for Cloudflare Workers — `@astrojs/cloudflare` adapter, `wrangler.jsonc`, `nodejs_compat`. Missing pieces: (1) worker name matching the project, (2) Cloudflare Workers Builds connection (Cloudflare-native CI/CD — no GitHub Actions), (3) env vars configured in Cloudflare. Goal: first production deploy + auto-deploy on push to `master`.

Auto-deploy via **Cloudflare Workers Builds** — Cloudflare's own CI/CD pipeline linked to GitHub. Every push to `master` triggers a build in Cloudflare, then `wrangler deploy`.

---

## Prerequisites

- [X] **P1.** Cloudflare account with Workers & Pages enabled
- [X] **P2.** Supabase project created (free tier is fine) — copy values from `.dev.vars`
- [X] **P3.** Wrangler CLI authenticated

### P3. Authenticate Wrangler CLI

```bash
npx wrangler login
```

This opens a browser tab for OAuth — click **"Allow"**. If headless, use:

```bash
npx wrangler login --browser chromium
```

Verify auth:

```bash
npx wrangler whoami
```

Expected output: shows your Cloudflare account email and account ID.

### P2. Get Supabase env values

1. Go to **database.supabase.com** → your project → **Settings** → **API**
2. Copy:
   - `SUPABASE_URL` → Project URL field
   - `SUPABASE_KEY` → `anon` public key under "Project API keys"

Add these to `.dev.vars` for local testing and to the Cloudflare dashboard in **Step 2c**.

---

## Step 1 — Fix `wrangler.jsonc` and `.env.example` (Agent, automatic)

- [X] **1a.** `wrangler.jsonc` — rename worker to `"name": "bitworth"`
- [X] **1b.** `.env.example` — replace placeholder names with proper ones

### 1a. `wrangler.jsonc` — rename worker

```jsonc
"name": "bitworth"
```

### 1b. `.env.example` — proper placeholder names

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here
```

---

## Step 2 — Connect repo to Cloudflare Workers Builds (User, manual — one-time)

- [X] **2a.** Install Cloudflare Workers & Pages GitHub App + authorize repo
- [X] **2b.** Configure Build Settings (build command, output dir, deploy command)
- [X] **2c.** Add environment variables in Cloudflare dashboard
  - Runtime secrets: `wrangler secret put SUPABASE_URL --name bitworth` + `wrangler secret put SUPABASE_KEY --name bitworth`
  - Build env vars: set in dashboard (required for Workers Builds auto-deploy pipeline) — user done
- [X] **2d.** Enable auto-deploy on master — verified working, pushes to master trigger builds

This step requires a human action via the Cloudflare Dashboard.

### 2a. Install Cloudflare Workers & Pages GitHub App
1. Go to **dash.cloudflare.com** → **Workers & Pages**
2. Click **"Create application"** → **"Deploy your worker"** → **"Import a repository"**
3. Cloudflare redirects to install the GitHub App "Cloudflare Workers and Pages" — authorize it
4. Select the repository `maksymkozachuk/bitworth`
5. Cloudflare auto-detects the Astro framework (autoconfig)

### 2b. Configure Build Settings
In the worker settings (`Settings > Builds`):

| Field | Value |
|---|---|
| **GitHub repository** | `maksymkozachuk/bitworth` |
| **Production branch** | `master` |
| **Build command** | `npm run build` |
| **Build output directory** | (empty — Astro SSR doesn't use a static directory) |
| **Deploy command** | `npx wrangler deploy` |

No `Root directory` needed — project is at repo root.

### 2c. Add environment variables in Cloudflare
In `Settings > Environment Variables` (Builds section):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Value from `.dev.vars` |
| `SUPABASE_KEY` | Value from `.dev.vars` |
| `NODE_VERSION` | `22` |

These vars are injected during the build by Cloudflare Workers Builds — NOT via GitHub secrets.

### 2d. Enable auto-deploy
Make sure **"Automatically deploy new commits"** is on in `Settings > Builds`.

---

## Step 3 — First manual deploy (User, manual — one-time)

- [X] Run `npx wrangler deploy` (no env:production — no production env in wrangler.jsonc)

Before relying on auto-deploy, a manual deploy verifies the configuration:

```bash
npx wrangler deploy --env production
```

Or via Dashboard: go to worker `bitworth` → **Deployments** → **Create deployment** → select commit from `master`.

Check that `wrangler` is authenticated:
```bash
npx wrangler whoami
```

If not: `npx wrangler login`

---

## Step 4 — Verification (User)

- [X] **4a.** Worker `bitworth` appears in **Workers & Pages** with status "Success"
- [X] **4b.** `npx wrangler tail bitworth --status error --format json` shows no errors (started, no errors observed)
- [X] **4c.** Browser: `/auth/signin` loads (HTTP 200), `/dashboard` redirects to signin (HTTP 302)
- [X] **4d.** Push a test commit to `master` — auto-deploy fires within 1-2 min

---

## File Changes

| File | Action |
|---|---|
| `wrangler.jsonc` | Edit: `"name": "bitworth"` |
| `.env.example` | Replace with proper placeholder names |
| `.github/workflows/` | **NO CHANGES** — not using GitHub Actions |

---

## Who Does What

| Step | Who | Type |
|---|---|---|
| Prerequisites (P1–P3) | User | one-time setup |
| Step 1 — fix `wrangler.jsonc` + `.env.example` | Agent | automatic |
| Step 2 — connect repo to Cloudflare Builds | User | manual (1-time) |
| Step 3 — first deploy | User | manual (1-time) |
| Step 4 — verification | User | verification |

---

## Out of Scope

- Changing `astro.config.mjs` — already correct
- Changing `src/middleware.ts` — works correctly
- Setting up GitHub Actions deploy workflow
- Modifying env schema in `astro.config.mjs`
- Installing Wrangler — use `npx wrangler` (no global install needed)
- Creating a Supabase project — assumes it already exists

---

## Workers Builds Free Tier Limits

- **3,000 build minutes/month** — typical `npm run build` + `wrangler deploy` consumes ~1-3 min
- **1 concurrent build** on free tier
- At 10k–100k requests/month with ~1 deploy/day: ~30 build minutes/month — well within limit