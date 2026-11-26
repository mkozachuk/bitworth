import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asSuperuser, asUser, bootDb } from "./harness";
import { USER_A, USER_B, seedUser } from "./fixtures";

// create_snapshot (NB-060): parent + items in one call, idempotent on a
// client_request_id per user, user_id always the caller. Runs on real Postgres
// with RLS on, as the API roles, so it pins what PostgREST would do.

const KEY_1 = "c0ffee00-0000-4000-8000-000000000001";
const KEY_2 = "c0ffee00-0000-4000-8000-000000000002";
const KEY_3 = "c0ffee00-0000-4000-8000-000000000003";
const KEY_4 = "c0ffee00-0000-4000-8000-000000000004";

const SNAPSHOT = { total_net_worth: 1234.5, display_currency: "EUR", base_currency: "USD", source: "manual" };

function item(name: string, order: number, categoryId = "savings_account"): Record<string, unknown> {
  return {
    category_id: categoryId,
    name,
    original_amount: 100 + order,
    original_currency: "EUR",
    converted_amount: 100 + order,
    display_currency: "EUR",
    exchange_rate_usd: 1.08,
    display_order: order,
    tag_ids: order === 0 ? [] : null,
  };
}

interface CallResult {
  snapshot: { id: string; user_id: string; client_request_id: string | null; total_net_worth: number };
  created: boolean;
}

describe("create_snapshot on real Postgres", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await bootDb();
    await seedUser(db, USER_A, "Alpha");
    await seedUser(db, USER_B, "Bravo");
  });
  afterAll(async () => {
    await db.close();
  });

  async function call(snapshot: Record<string, unknown>, items: unknown[], key: string | null): Promise<CallResult> {
    const res = await db.query<{ r: CallResult }>("SELECT create_snapshot($1::jsonb, $2::jsonb, $3::uuid) AS r", [
      JSON.stringify(snapshot),
      JSON.stringify(items),
      key,
    ]);
    return res.rows[0].r;
  }

  async function counts(user: string, key?: string): Promise<{ parents: number; items: number }> {
    await asSuperuser(db);
    const where = key ? "user_id = $1 AND client_request_id = $2" : "user_id = $1";
    const params = key ? [user, key] : [user];
    const parents = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM snapshots WHERE ${where}`, params);
    const items = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM snapshot_items WHERE snapshot_id IN (SELECT id FROM snapshots WHERE ${where})`,
      params,
    );
    return { parents: parents.rows[0].n, items: items.rows[0].n };
  }

  it("the (user_id, client_request_id) index exists, is unique and partial on non-NULL keys", async () => {
    await asSuperuser(db);
    const res = await db.query<{ indisunique: boolean; pred: string | null; def: string }>(
      `SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid) AS pred, pg_get_indexdef(i.indexrelid) AS def
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'snapshots_user_client_request_id_key'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].indisunique).toBe(true);
    expect(res.rows[0].pred).toMatch(/client_request_id IS NOT NULL/);
    expect(res.rows[0].def).toMatch(/\(user_id, client_request_id\)/);
  });

  it("creates the parent and its items in one call and returns created = true", async () => {
    await asUser(db, USER_A);
    const r = await call(SNAPSHOT, [item("Alpha savings", 0), item("Alpha coins", 1, "crypto")], KEY_1);
    expect(r.created).toBe(true);
    expect(r.snapshot.user_id).toBe(USER_A);
    expect(r.snapshot.client_request_id).toBe(KEY_1);
    expect(r.snapshot.total_net_worth).toBe(1234.5);
    expect(await counts(USER_A, KEY_1)).toEqual({ parents: 1, items: 2 });
    // tag_ids: [] stays "recorded, no tags", NULL stays "not recorded".
    const tags = await db.query<{ name: string; tag_ids: string[] | null }>(
      "SELECT name, tag_ids FROM snapshot_items WHERE snapshot_id = $1 ORDER BY display_order",
      [r.snapshot.id],
    );
    expect(tags.rows.map((t) => [t.name, t.tag_ids])).toEqual([
      ["Alpha savings", []],
      ["Alpha coins", null],
    ]);
  });

  it("a replay with the same key inserts nothing and returns the existing row with created = false", async () => {
    await asUser(db, USER_A);
    const first = await call(SNAPSHOT, [item("Alpha savings", 0)], KEY_2);
    const before = await counts(USER_A);
    await asUser(db, USER_A);
    const again = await call({ ...SNAPSHOT, total_net_worth: 9999 }, [item("x", 0), item("y", 1)], KEY_2);
    expect(again.created).toBe(false);
    expect(again.snapshot.id).toBe(first.snapshot.id);
    expect(again.snapshot.total_net_worth).toBe(1234.5);
    expect(await counts(USER_A)).toEqual(before);
    expect(await counts(USER_A, KEY_2)).toEqual({ parents: 1, items: 1 });
  });

  it("the same key from another user creates a separate snapshot", async () => {
    await asUser(db, USER_A);
    const a = await call(SNAPSHOT, [item("Alpha savings", 0)], KEY_3);
    await asUser(db, USER_B);
    const b = await call(SNAPSHOT, [item("Bravo savings", 0)], KEY_3);
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.snapshot.id).not.toBe(a.snapshot.id);
    expect(b.snapshot.user_id).toBe(USER_B);
    await asSuperuser(db);
    const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM snapshots WHERE client_request_id = $1", [
      KEY_3,
    ]);
    expect(n.rows[0].n).toBe(2);
  });

  it("a NULL key always creates (legacy behaviour)", async () => {
    const before = await counts(USER_A);
    await asUser(db, USER_A);
    const one = await call(SNAPSHOT, [item("Alpha savings", 0)], null);
    await asUser(db, USER_A);
    const two = await call(SNAPSHOT, [item("Alpha savings", 0)], null);
    expect(one.created && two.created).toBe(true);
    expect(two.snapshot.id).not.toBe(one.snapshot.id);
    expect(await counts(USER_A)).toEqual({ parents: before.parents + 2, items: before.items + 2 });
  });

  it("an empty items array creates the parent only", async () => {
    await asUser(db, USER_A);
    const r = await call(SNAPSHOT, [], KEY_4);
    expect(r.created).toBe(true);
    expect(await counts(USER_A, KEY_4)).toEqual({ parents: 1, items: 0 });
  });

  it("a failing item rolls the parent back: zero rows left for that call", async () => {
    const key = "c0ffee00-0000-4000-8000-0000000000f1";
    const before = await counts(USER_A);
    await asUser(db, USER_A);
    // The second item names a category that does not exist: FK violation.
    await expect(call(SNAPSHOT, [item("ok", 0), item("bad", 1, "no_such_category")], key)).rejects.toThrow(
      /foreign key/,
    );
    expect(await counts(USER_A, key)).toEqual({ parents: 0, items: 0 });
    expect(await counts(USER_A)).toEqual(before);
  });

  it("user_id is always the caller, even when the payload names another user", async () => {
    const key = "c0ffee00-0000-4000-8000-0000000000a1";
    await asUser(db, USER_A);
    const r = await call({ ...SNAPSHOT, user_id: USER_B }, [item("Alpha savings", 0)], key);
    expect(r.snapshot.user_id).toBe(USER_A);
    expect(await counts(USER_B, key)).toEqual({ parents: 0, items: 0 });
    expect(await counts(USER_A, key)).toEqual({ parents: 1, items: 1 });
  });

  it("anon cannot execute it (permission denied)", async () => {
    await asAnon(db);
    try {
      await expect(call(SNAPSHOT, [], null)).rejects.toThrow(/permission denied/);
    } finally {
      await asSuperuser(db);
    }
  });

  it("an authenticated role with no auth.uid() is refused", async () => {
    await asSuperuser(db);
    await db.exec("SET ROLE authenticated");
    try {
      await expect(call(SNAPSHOT, [], null)).rejects.toThrow(/no authenticated user/);
    } finally {
      await asSuperuser(db);
    }
  });
});
