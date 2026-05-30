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

## MCP Servers

- **Context7** (`mcp__context7__*`): Fetch current library/framework docs. Always use `resolve-library-id` first, then `query-docs`. Prefer over web search for API syntax, configuration, and version migration.
- **Exa** (`mcp__exa__*`): Web search and fetch for current information, news, facts, and external URLs. Use for anything requiring up-to-date web data beyond library docs.
- **Linear** (`mcp__linear-server__*`): Manage Linear issues, projects, documents, and cycles directly from the CLI.

## Subdirectory CLAUDE.md

This project is not a monorepo — no subdirectory CLAUDE.md files needed.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 4

Prepare for a harder implementation stream with the **research-backed planning chain**:

```
internal research (/10x-research) + external research (exa.ai, Context7) -> /10x-plan -> /10x-implement -> success
```

The lesson focus is distinguishing internal from external research and using evidence to back planning decisions.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Internal research (lesson focus)** | |
| `/10x-research <change-id>` | You need evidence from the existing codebase — patterns, conventions, integration points, or existing implementations. Runs parallel sub-agents over the repo and writes structured findings to `research.md`. |
| **External research (lesson focus)** | |
| exa.ai | You need AI-native web search for library comparisons, best practices, or ecosystem context that the codebase cannot answer. |
| Context7 (`resolve-library-id` → `get-library-docs`) | You need live, current documentation for a specific library or framework. Resolves a library ID first, then fetches relevant doc pages. |
| **Framing spare wheel** | |
| `/10x-frame <change-id>` | The plan won't converge, the plan doesn't deliver expected results, or persistent drift keeps breaking the implementation. Use as an escape hatch on a separate problem (demonstrated on Space Explorers example), not as pre-research ritual. |
| **Planning and execution** | |
| `/10x-plan <change-id>` / `/10x-implement <change-id> phase <n>` | Use the same planning and execution chain from Lesson 2, now with upstream research evidence feeding the plan. |

### Research discipline

- Internal research (`/10x-research`) answers "what does our codebase already do?" — patterns, schemas, conventions, integration points.
- External research (exa.ai, Context7) answers "what should we do?" — library capabilities, API docs, ecosystem best practices.
- Combine both as evidence-backed input to `/10x-plan`. A plan without research evidence on a non-trivial stream is a guess.
- Agent-friendly docs (`llms.txt`, markdown-for-agents, `/md` endpoints) are a quality signal for library selection — libraries that publish agent-readable docs integrate faster.

### `/10x-frame` as spare wheel

Three triggers for reaching for `/10x-frame`:
1. The plan won't converge — research keeps opening more questions instead of narrowing to a contract.
2. The plan doesn't deliver — implementation repeatedly fails to meet success criteria.
3. Persistent drift — the implementation keeps diverging from the plan in ways that suggest the problem was mis-framed.

Demonstrated on a Space Explorers example, not the SRS path. It is an escape hatch, not a mandatory step.

### Paths used by this lesson

- `context/changes/<change-id>/research.md` - internal research output
- `context/changes/<change-id>/frame.md` - framing output when needed
- `context/changes/<change-id>/plan.md` - evidence-backed implementation contract
- `context/foundation/lessons.md` - recurring rules and pitfalls

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
