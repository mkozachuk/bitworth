# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard Rules

- Error shape: always use `{ error: { code: string, message: string, context?: unknown } }`, never `{ error: string }`
- `react-compiler` → error (enforced in all React components)
- `astro/no-set-html-directive` → error
- `@typescript-eslint/no-unused-vars` → error, prefix unused with `_`

## Commands

- `npm run dev` — Start dev server (Astro)
- `npm run build` — Production build
- `npm run preview` — Preview production build
- `npm run lint` — ESLint
- `npm run lint:fix` — ESLint with auto-fix
- `npm run format` — Prettier write
- `npx astro sync` — Generate Supabase types

## Auth Flow

Protected routes are defined in `src/middleware.ts` (`PROTECTED_ROUTES`). All auth logic lives in:
- `src/lib/supabase.ts` — Supabase client factory
- `src/pages/api/auth/` — Server API routes (signin, signup, signout)
- `src/pages/auth/` — Auth pages (signin, signup, confirm-email)

Unauthenticated requests to protected routes redirect to `/auth/signin`.

## Environment Setup

- Required vars: `SUPABASE_URL`, `SUPABASE_KEY`
- **Local dev**: `.env` — local Supabase (run `supabase start` via Docker first); also copy `.env.example` to `.dev.vars` for Wrangler
- **Production**: two-step setup required for Cloudflare Workers Builds auto-deploy:
  1. Runtime secrets: `wrangler secret put SUPABASE_URL --name bitworth` + `wrangler secret put SUPABASE_KEY --name bitworth`
  2. Build env vars: set the same vars in Cloudflare dashboard under `Settings → Environment Variables` (Workers Builds pipeline reads these, not runtime secrets)
- Both `.env` and `.dev.vars` are gitignored — never commit credentials

## Pre-commit Hooks

Husky runs `lint-staged` before every commit:
- `*.{ts,tsx,astro}` → `eslint --fix`
- `*.{json,css,md}` → `prettier --write`

## Tech Stack

- **Framework**: Astro v6 with SSR + React v19 islands
- **Language**: TypeScript v5 (strict)
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite`
- **Auth**: Supabase SSR (`@supabase/ssr`)
- **Deployment**: Cloudflare Workers (via `@astrojs/cloudflare` adapter + Wrangler)

## Code Style

- **2-space indentation** in TypeScript (Prettier `tabWidth: 2`)
- **Print width**: 120 chars
- `no-console` → warn
- `astro/prefer-class-list-directive` → warn

## Subdirectory CLAUDE.md

This project is not a monorepo — no subdirectory CLAUDE.md files needed.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
