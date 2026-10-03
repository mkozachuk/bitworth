import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Real-Postgres harness for the DB tests (`npm run test:db`). PGlite is
// Postgres compiled to WASM, running in-process: no Docker, no network, no
// Supabase project. Each `bootDb()` is a fresh, empty database.

const SUPABASE_DIR = fileURLToPath(new URL("../../../supabase/", import.meta.url));
export const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
const SEED_FILE = join(SUPABASE_DIR, "seed.sql");

// TEST-ONLY Supabase shim. On a real Supabase project these objects come from
// the platform; the migrations reference them, so a bare Postgres needs a
// stand-in before the first migration runs. Kept to what the migrations touch:
//   - the API roles `anon`, `authenticated`, `service_role`;
//   - schema `auth` with `auth.users` (only `id` is referenced, by FKs and
//     the on_auth_users_insert trigger);
//   - `auth.uid()`, which reads the JWT `sub` claim from a GUC, the same
//     definition Supabase ships (legacy `request.jwt.claim.sub` first, then
//     `request.jwt.claims` JSON). Tests set it through `asUser()`;
//   - Supabase's default privileges on schema public: new tables, sequences
//     and functions are granted to the API roles. RLS, not GRANT, is what
//     scopes rows, so the RLS tests only mean something with these grants in
//     place; the migrations' own REVOKEs (restore_backup, reorder_assets) then
//     apply on top, as they do in production.
// Never applied to any real database.
export const SUPABASE_SHIM = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

/** Every `.sql` file in supabase/migrations, in filename (= apply) order. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * A fresh database: shim, then every migration in filename order (no subset,
 * so a new migration is picked up automatically), then `seed.sql` (the
 * asset_categories reference rows), the same order `supabase db reset` uses.
 */
export async function bootDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      await db.close();
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
  }
  await db.exec(readFileSync(SEED_FILE, "utf8"));
  return db;
}

/** Act as a signed-in API user: role `authenticated`, auth.uid() = userId. */
export async function asUser(db: PGlite, userId: string): Promise<void> {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("SET ROLE authenticated");
}

/** Act as an anonymous API caller: role `anon`, no auth.uid(). */
export async function asAnon(db: PGlite): Promise<void> {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.exec("SET ROLE anon");
}

/** Back to the bootstrap superuser (fixtures, assertions across users). */
export async function asSuperuser(db: PGlite): Promise<void> {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}
