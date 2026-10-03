import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asSuperuser, asUser, bootDb } from "./harness";
import { USER_A, USER_B, USER_TABLES, seedUser } from "./fixtures";

describe("row level security on real Postgres", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await bootDb();
    await seedUser(db, USER_A, "Alpha");
    await seedUser(db, USER_B, "Bravo");
  });
  afterAll(async () => {
    await db.close();
  });

  const count = async (sql: string, params: unknown[]) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, params)).rows[0].n;

  it.each(USER_TABLES)("as user A, selecting user B's %s returns 0 rows", async (table) => {
    await asSuperuser(db);
    expect(await count(`SELECT 1 FROM ${table} WHERE user_id = $1`, [USER_B])).toBeGreaterThan(0);
    await asUser(db, USER_A);
    try {
      expect(await count(`SELECT 1 FROM ${table} WHERE user_id = $1`, [USER_B])).toBe(0);
      // Not a dead table: A sees its own rows through the same policy.
      expect(await count(`SELECT 1 FROM ${table} WHERE user_id = $1`, [USER_A])).toBeGreaterThan(0);
    } finally {
      await asSuperuser(db);
    }
  });

  it("as user A, selecting user B's snapshot_items (owned through snapshot_id) returns 0 rows", async () => {
    const sql = "SELECT 1 FROM snapshot_items i JOIN snapshots s ON s.id = i.snapshot_id WHERE s.user_id = $1";
    // The join cannot see B's snapshots; ask by B's snapshot ids, fetched as the superuser.
    const ids = (await db.query<{ id: string }>("SELECT id FROM snapshots WHERE user_id = $1", [USER_B])).rows.map(
      (r) => r.id,
    );
    expect(await count(sql, [USER_B])).toBeGreaterThan(0);
    await asUser(db, USER_A);
    try {
      expect(await count("SELECT 1 FROM snapshot_items WHERE snapshot_id = ANY($1::uuid[])", [ids])).toBe(0);
      expect(await count(sql, [USER_A])).toBeGreaterThan(0);
    } finally {
      await asSuperuser(db);
    }
  });

  it("as user A, writing a row owned by user B is rejected (WITH CHECK)", async () => {
    await asUser(db, USER_A);
    try {
      await expect(
        db.query(
          "INSERT INTO assets (user_id, category_id, name, amount, currency) VALUES ($1, 'cash_on_hand', 'x', 1, 'USD')",
          [USER_B],
        ),
      ).rejects.toThrow(/row-level security/);
      const updated = await db.query("UPDATE assets SET amount = 0 WHERE user_id = $1", [USER_B]);
      expect(updated.affectedRows ?? 0).toBe(0);
    } finally {
      await asSuperuser(db);
    }
  });
});
