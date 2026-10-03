import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asSuperuser, asUser, bootDb, migrationFiles } from "./harness";
import { USER_A } from "./fixtures";

describe("migrations on real Postgres (PGlite)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await bootDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("applies every file in supabase/migrations in filename order, then seed.sql", async () => {
    // bootDb throws, naming the file, on the first migration that fails.
    expect(migrationFiles().length).toBeGreaterThan(0);
    const categories = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM asset_categories");
    expect(categories.rows[0].n).toBeGreaterThan(0);
  });

  it("ends with every user-owned table under row level security", async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(8);
    expect(res.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("leaves restore_backup(text, jsonb) callable by authenticated and refused to anon", async () => {
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [USER_A]);
    await asUser(db, USER_A);
    await db.query("SELECT restore_backup('merge', '{}'::jsonb)");
    await asAnon(db);
    await expect(db.query("SELECT restore_backup('merge', '{}'::jsonb)")).rejects.toThrow(/permission denied/);
    await asSuperuser(db);
  });
});
