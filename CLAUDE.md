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

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
