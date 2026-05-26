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

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Roadmap (lesson focus)** | |
| `/10x-roadmap` | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed** | |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready. |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
