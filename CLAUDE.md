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

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
