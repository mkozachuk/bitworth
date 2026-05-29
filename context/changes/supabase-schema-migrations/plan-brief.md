# Supabase Schema — Plan Brief

> Full plan: `context/changes/supabase-schema-migrations/plan.md`

## What & Why

Design and migrate the PostgreSQL schema for BitWorth — the foundation that all downstream features (asset management, dashboard with charts, crypto pricing) depend on. The schema must support multi-currency assets, itemized net worth snapshots, user preferences, and a cache for exchange rates — all with strict account isolation enforced via Row Level Security.

## Starting Point

Supabase auth is fully working (signin/signup/signout, middleware protection on `/dashboard`), but zero business data tables exist. No migration files, no seed data, no generated types. The `supabase/seed.sql` is referenced but empty. Server-side Supabase client exists; browser-side client does not.

## Desired End State

Five core tables (`user_preferences`, `asset_categories`, `assets`, `snapshots`, `snapshot_items`, `exchange_rate_cache`) created via SQL migration, seeded with 13 asset categories, secured with RLS policies. TypeScript types generated from the schema. Browser-side Supabase client factory available for React dashboard components.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Exchange rate API | frankfurter.app | Free, no key, works immediately |
| Crypto price API | CoinGecko | Free, no key, good BTC/ETH/alts coverage |
| Type generation | `supabase gen types typescript` | Compile-time safety on DB operations |
| Schema management | SQL migrations | Version-controlled, idempotent, CI-friendly |
| Snapshot storage | Itemized + base currency | Preserves full historical fidelity per asset, regardless of future currency changes |
| Asset amounts | Original amount only | No stale rates in DB; conversions computed at read time |
| Auto-snapshot trigger | First-login-of-month | Aligns with Alex's monthly usage pattern |
| Numeric precision | NUMERIC(18,2) | Natural for financial data, avoids floating-point errors |
| Asset categories | 13 hardcoded | Matches PRD exactly |
| Snapshot items | Full itemized | Enables chart drill-down per category |

## Scope

**In scope:** Schema design, SQL migration files, seed data, RLS policies, type generation, browser Supabase client.

**Out of scope:** App-shell layout, dashboard UI, exchange rate fetch logic, crypto price fetch logic, auto-snapshot trigger (all come in later slices).

## Architecture / Approach

Five-table relational schema with RLS enforcing account isolation. Assets store original amounts in original currency; conversions computed at read time from cached exchange rates. Snapshots store itemized per-asset converted values so chart tooltips can show category breakdown at any historical point. A database trigger auto-creates `user_preferences` row on new user signup. Categories seeded from `supabase/seed.sql`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema Design & SQL Migrations | 5 tables, indexes, RLS policies, triggers | Schema is the single failure point — keep minimal |
| 2. Seed Data & Verification | 13 categories seeded, migration verified | Migration order must be correct for trigger dependencies |
| 3. Type Generation & Browser Client | TS types + browser Supabase client | anon key in browser bundle must have RLS |

**Prerequisites:** Local Supabase running (`supabase start`), valid project ref for type generation.
**Estimated effort:** ~1-2 sessions across 3 phases.