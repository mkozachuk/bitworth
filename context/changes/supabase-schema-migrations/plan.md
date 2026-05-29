# Supabase Schema — Implementation Plan

## Overview

Design and migrate the PostgreSQL schema for BitWorth: assets, snapshots, and user preferences. This is the foundation for all downstream features — asset management (S-01), dashboard with charts (S-02), and crypto pricing (S-03). The schema is kept minimal — only what's strictly required for MVP.

## Current State Analysis

The codebase has Supabase auth working end-to-end (signin/signup/signout, middleware protection), but zero business data tables exist. No migration files, no seed data, no generated types. The `supabase/config.toml` references a `seed.sql` that is empty. The Supabase CLI is in `package.json` but no migrations directory exists yet.

Key constraints:
- Server-side Supabase client exists (`src/lib/supabase.ts`), no browser-side client yet
- Astro SSR + Cloudflare Workers — all DB access happens server-side
- User type is raw `@supabase/supabase-js` `User` — no generated DB types
- All currency conversions happen on read (assets store original amounts only)
- Snapshots store itemized data (per-asset converted values) with a base currency

## Desired End State

- `supabase/migrations/00001_initial_schema.sql` creates 5 tables: `user_preferences`, `asset_categories`, `assets`, `snapshots`, `snapshot_items`, and `exchange_rate_cache`
- All tables have Row Level Security policies enforcing `auth.uid() = user_id` — strict account isolation per NFR §data-privacy
- 13 asset categories are seeded from `supabase/seed.sql`
- `src/lib/database.types.ts` contains generated TypeScript types for all tables
- `src/lib/supabase-browser.ts` exports a browser-side Supabase client factory for React dashboard components

### Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Exchange rate API | frankfurter.app | Free, no key, works immediately |
| Crypto price API | CoinGecko | Free, no key, good BTC/ETH/alts coverage |
| Type generation | `supabase gen types typescript` | Catch mismatches at compile time |
| Schema management | SQL migrations in `supabase/migrations/` | Version-controlled, idempotent, CI-friendly |
| Snapshot storage | Computed at read time + base currency snapshot | Preserves historical values in USD regardless of future currency changes |
| Asset amounts | Original amount only, compute display at read | No stale rates in DB, single source of truth |
| Auto-snapshot trigger | First-login-of-month | Aligns with Alex's actual monthly usage pattern |
| Numeric precision | NUMERIC(18,2) | Natural for financial display, familiar SQL pattern |
| Asset categories | 13 hardcoded values | Matches PRD exactly, no over-engineering |
| Snapshot items | Full itemized (per-asset converted values) | Full historical fidelity for chart drill-down |

### Key Discoveries

- `src/lib/supabase.ts` — server-only client; Phase 3 creates a browser client
- `supabase/seed.sql` — exists but is empty; we'll write category seeds here
- No `supabase/migrations/` directory exists yet; we create it from scratch
- Cloudflare Workers compatibility is confirmed — `nodejs_compat` flag set in `wrangler.jsonc`
- Auth email confirmation is disabled in `config.toml` — users get immediate access

## What We're NOT Doing

- No demo mode (nice-to-have, parked)
- No FIRE calculator (non-goal)
- No custom/ extensible categories (out of scope for MVP)
- No bank/broker integrations (non-goal)
- No data export (PDF/CSV) (non-goal)
- No app-shell layout or dashboard UI (those come in S-01 and S-02)
- No exchange rate fetch logic yet (comes in S-01)
- No crypto price fetch logic yet (comes in S-03)
- No auto-snapshot trigger logic (first-login-of-month implemented in S-02)

## Implementation Approach

Design a minimal relational schema with 5 core tables. Use PostgreSQL with Row Level Security (RLS) on every table — `auth.uid() = user_id` is the single access control rule. Store original amounts in assets; compute conversions at read time using cached exchange rates. Store itemized snapshot items to preserve per-asset history. Seed the 13 required asset categories. Generate TypeScript types from the schema for compile-time safety.

## Phase 1: Schema Design & SQL Migrations

### Overview

Create the complete SQL migration: 5 tables with columns, indexes, constraints, RLS policies, and triggers.

### Changes Required

#### 1. Initial schema migration

**File**: `supabase/migrations/00001_initial_schema.sql`

**Intent**: Create the complete database schema — 5 tables (user_preferences, asset_categories, assets, snapshots, snapshot_items, exchange_rate_cache) — with indexes for performance, NOT NULL + CHECK constraints for data integrity, and RLS policies enforcing strict account isolation.

**Contract**: The migration creates these tables and constraints:

```sql
-- user_preferences (1:1 with auth.users)
-- Stores display_currency preference. Created via trigger on auth.users insertion.
CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (display_currency IN ('PLN', 'USD', 'EUR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- asset_categories (seeded, immutable after initial seed)
CREATE TABLE asset_categories (
  id TEXT PRIMARY KEY,  -- e.g. 'checking_account'
  name TEXT NOT NULL,   -- e.g. 'Checking Account'
  icon TEXT,            -- Lucide icon name
  is_liability BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- assets
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES asset_categories(id),
  name TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('PLN', 'USD', 'EUR')),
  crypto_symbol TEXT,  -- e.g. 'BTC', 'ETH'. NULL for non-crypto assets.
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- snapshots
CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_net_worth NUMERIC(18, 2) NOT NULL,
  display_currency TEXT NOT NULL CHECK (display_currency IN ('PLN', 'USD', 'EUR')),
  base_currency TEXT NOT NULL DEFAULT 'USD',  -- currency of stored total_net_worth
  source TEXT NOT NULL CHECK (source IN ('manual', 'auto')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- snapshot_items (itemized asset values at snapshot time)
CREATE TABLE snapshot_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES asset_categories(id),
  name TEXT NOT NULL,
  original_amount NUMERIC(18, 2) NOT NULL,
  original_currency TEXT NOT NULL,
  converted_amount NUMERIC(18, 2) NOT NULL,  -- in display_currency
  display_currency TEXT NOT NULL,
  exchange_rate_usd NUMERIC(20, 10),  -- rate used (USD base for conversion)
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- exchange_rate_cache
CREATE TABLE exchange_rate_cache (
  base_currency TEXT NOT NULL,  -- e.g. 'EUR'
  target_currency TEXT NOT NULL,  -- e.g. 'PLN'
  rate NUMERIC(20, 10) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_currency, target_currency)
);

-- Indexes for common query patterns:
CREATE INDEX idx_assets_user_id ON assets(user_id);
CREATE INDEX idx_assets_user_category ON assets(user_id, category_id);
CREATE INDEX idx_snapshots_user_id ON snapshots(user_id);
CREATE INDEX idx_snapshots_user_created ON snapshots(user_id, created_at DESC);
CREATE INDEX idx_snapshot_items_snapshot_id ON snapshot_items(snapshot_id);

-- RLS on all tables (auth.uid() = user_id pattern)
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rate_cache ENABLE ROW LEVEL SECURITY;

-- Policies: users can only access their own rows
-- For exchange_rate_cache: public read (no user_id), write via service role
CREATE POLICY "Users own their preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their assets" ON assets
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their snapshots" ON snapshots
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their snapshot items" ON snapshot_items
  FOR ALL USING (
    snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid())
  );

-- Exchange rate cache: public read, service role only writes
CREATE POLICY "Anyone can read exchange rates" ON exchange_rate_cache
  FOR SELECT USING (true);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assets_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_prefs_updated_at BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: create user_preferences on auth.users insert
CREATE OR REPLACE FUNCTION on_auth_user_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_preferences (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_users_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION on_auth_user_created();
```

### Success Criteria

#### Automated

- `supabase db push` applies migration without error on local instance
- `supabase db check` passes (or equivalent validation)
- No migration syntax errors

#### Manual

- Tables visible in Supabase dashboard SQL editor
- RLS policies visible and set to active on all 5 tables

---

## Phase 2: Seed Data & Verification

### Overview

Write the seed SQL with 13 asset categories and run it against the local Supabase instance.

### Changes Required

#### 1. Category seed data

**File**: `supabase/seed.sql`

**Intent**: Insert the 13 required asset categories from FR-009 with display order, icons, and liability flag.

**Contract**:
```sql
-- 13 categories from FR-009, in display order
INSERT INTO asset_categories (id, name, icon, is_liability, display_order) VALUES
  ('checking_account', 'Checking Account', 'wallet', false, 1),
  ('savings_account', 'Savings Account', 'piggy-bank', false, 2),
  ('business_fop', 'Business/FOP Account', 'briefcase', false, 3),
  ('cash_on_hand', 'Cash on Hand', 'banknote', false, 4),
  ('stocks', 'Stocks', 'trending-up', false, 5),
  ('investment_funds', 'Investment Funds', 'bar-chart-2', false, 6),
  ('bonds', 'Bonds', 'shield', false, 7),
  ('crypto', 'Crypto', 'bitcoin', false, 8),
  ('precious_metals', 'Precious Metals', 'gem', false, 9),
  ('real_estate', 'Real Estate', 'home', false, 10),
  ('vehicles_valuables', 'Vehicles & Valuables', 'car', false, 11),
  ('loans_credit', 'Loans & Credit', 'credit-card', true, 12),
  ('p2p_loans', 'P2P/Loans Given', 'hand-coins', false, 13);
```

#### 2. Run seed

**Command**: `supabase db reset` (applies migration + seed in one step, which is the standard Supabase workflow)

**Intent**: Reset the local database — drop existing schema, run all migrations in order, apply seed data.

### Success Criteria

#### Automated

- `supabase db reset` completes without error

#### Manual

- All 13 rows appear in `asset_categories` table
- Category IDs match expected values (e.g., `checking_account`, `crypto`)
- `is_liability` flag is `true` only for `loans_credit`

---

## Phase 3: Type Generation & Browser Client

### Overview

Generate TypeScript types from the live schema and create a browser-side Supabase client factory for React dashboard components.

### Changes Required

#### 1. Type generation

**File**: `src/lib/database.types.ts` (generated by Supabase CLI, written to disk)

**Intent**: Run `supabase gen types typescript --project-ref <ref>` to generate typed row/insert/update types for all 5 tables. Save output to `src/lib/database.types.ts`.

**Command**: `npx supabase gen types typescript --project-id <project-id> > src/lib/database.types.ts`

**Contract**: The generated file contains TypeScript interfaces for each table row, plus `Database` type that combines them. The `src/env.d.ts` App.Locals can be updated to include typed user session.

#### 2. Browser-side Supabase client

**File**: `src/lib/supabase-browser.ts`

**Intent**: Create a browser-side Supabase client factory using `@supabase/ssr`'s `createBrowserClient`. This is needed because the dashboard React components (S-01, S-02) run client-side and need to query the database directly (Supabase handles auth cookies in the browser).

**Contract**: Exports a singleton `createBrowserClient()` that uses the same `SUPABASE_URL` and `SUPABASE_KEY` env vars. The key used here is the **anon/public key** (not the service role), so RLS policies are enforced client-side.

```ts
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (!browserClient && SUPABASE_URL && SUPABASE_KEY) {
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return browserClient;
}
```

Note: The `astro:env/server` import is used for type checking; at runtime the browser build uses the values injected via Vite. Ensure `SUPABASE_KEY` is the **anon key** in the browser bundle (RLS enforces access control server-side).

#### 3. Update App.Locals with typed session

**File**: `src/env.d.ts`

**Intent**: Extend the `App.Locals` type to include a typed session alongside the raw user. This lets server-side code access user+session without importing supabase-js directly.

**Contract**:
```ts
declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}
```
No change needed — the existing type is sufficient. The typed `Database` type from `database.types.ts` is used in individual service files, not in globals.

### Success Criteria

#### Automated

- `npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts` runs without error
- `src/lib/database.types.ts` contains types for all 5 tables (`user_preferences`, `asset_categories`, `assets`, `snapshots`, `snapshot_items`, `exchange_rate_cache`)
- `src/lib/supabase-browser.ts` has no TypeScript errors
- `npm run typecheck` passes

#### Manual

- The generated `Database` type is importable in TypeScript files
- Browser client factory returns a valid Supabase client when called from a React component

---

## Testing Strategy

### Unit Tests

- None for this change — schema and types are declarative artifacts, not runnable logic. Verification is manual (Supabase dashboard) and automated (migration applies, types generate).

### Integration Tests

- `supabase db reset` — the canonical integration test: applies migration + seed from scratch.
- `supabase db push` — verifies migration is compatible with CI pipeline.

### Manual Testing Steps

1. Run `supabase db reset` and confirm all 5 tables are created
2. Query `asset_categories` — confirm all 13 rows exist with correct `is_liability` values
3. Sign in via the app and inspect `user_preferences` — confirm a row exists for the new user (trigger fired)
4. Open Supabase dashboard → Authentication → confirm the trigger created a preferences row
5. Verify RLS by signing in as user A and attempting to query user B's assets (should return empty)
6. Run `npx supabase gen types typescript` — confirm types match the actual schema

---

## Migration Notes

The initial migration is irreversible in the sense that `DROP TABLE` would destroy data. Since this is a greenfield project with no production data, we proceed without a rollback strategy for the initial migration. Future migrations follow standard Supabase migration practices: `supabase/migrations/` files are additive-only, never destructive.

If the migration needs to be revised in development: `supabase db reset` clears the local DB and re-applies all migrations in order.

---

## References

- Schema design: `context/foundation/prd.md` (FR-006-020), `context/foundation/roadmap.md` (F-01)
- Supabase patterns: `src/lib/supabase.ts` (server client), `src/middleware.ts` (auth pattern)
- Cloudflare Workers compat: `wrangler.jsonc` (`nodejs_compat` flag set)
- Auth trigger pattern: Supabase docs on `auth.users` triggers

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema Design & SQL Migrations

#### Automated

- [x] 1.1 Migration applies cleanly: `supabase db push`
- [x] 1.2 No migration syntax errors

#### Manual

- [ ] 1.3 Tables visible in Supabase dashboard with correct structure
- [ ] 1.4 RLS policies active on all 5 tables

### Phase 2: Seed Data & Verification

#### Automated

- [ ] 2.1 `supabase db reset` completes without error

#### Manual

- [ ] 2.2 All 13 categories appear in `asset_categories` table
- [ ] 2.3 `is_liability` flag correct (only `loans_credit` is true)

### Phase 3: Type Generation & Browser Client

#### Automated

- [ ] 3.1 Types generated for all 5 tables: `npx supabase gen types typescript`
- [ ] 3.2 Browser client factory has no TypeScript errors
- [ ] 3.3 `npm run typecheck` passes

#### Manual

- [ ] 3.4 `Database` type is importable in TypeScript files
- [ ] 3.5 Browser client returns valid Supabase client from React components