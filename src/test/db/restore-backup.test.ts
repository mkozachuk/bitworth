import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  CURRENT_SCHEMA_VERSION,
  prepareImport,
  serialize,
  validateEnvelope,
  type BackupData,
  type BackupEnvelope,
  type PreparedBackup,
} from "@/lib/backup";
import { asSuperuser, asUser, bootDb } from "./harness";
import { USER_A, USER_B, fetchBackupInput, seedUser, userFingerprint } from "./fixtures";

// The whole backup path on real Postgres: rows → what the export route fetches
// → serialize → JSON file → validateEnvelope → prepareImport → restore_backup.

type Row = Record<string, unknown>;

async function categoryIds(db: PGlite): Promise<Set<string>> {
  const res = await db.query<{ id: string }>("SELECT id FROM asset_categories");
  return new Set(res.rows.map((r) => r.id));
}

async function exportFile(db: PGlite, user: string): Promise<BackupEnvelope> {
  await asUser(db, user);
  const input = await fetchBackupInput(db, user);
  await asSuperuser(db);
  // Through JSON text, as the file on disk is.
  return JSON.parse(JSON.stringify(serialize(input, "2026-03-01T00:00:00.000Z"))) as BackupEnvelope;
}

async function importFile(db: PGlite, user: string, mode: "replace" | "merge", file: unknown): Promise<void> {
  const validated = validateEnvelope(file, await categoryIds(db));
  if (!validated.ok) throw new Error(`validateEnvelope: ${validated.code} ${validated.message}`);
  await restore(db, user, mode, prepareImport(validated.data, () => randomUUID()).payload);
}

async function restore(db: PGlite, user: string, mode: string, payload: PreparedBackup | Row): Promise<void> {
  await asUser(db, user);
  try {
    await db.query("SELECT restore_backup($1, $2::jsonb)", [mode, JSON.stringify(payload)]);
  } finally {
    await asSuperuser(db);
  }
}

/**
 * The backup with every surrogate key replaced by the natural key it stands
 * for (asset/tag/card name, snapshot created_at), and ownership dropped:
 * import regenerates ids by design, so equality is on everything else.
 */
function canonical(data: BackupData): Record<string, Row[]> {
  const byId = (rows: Row[], key: string) => new Map(rows.map((r) => [r.id as string, String(r[key])]));
  const asset = byId(data.assets, "name");
  const tag = byId(data.tags, "name");
  const snapshot = byId(data.snapshots, "created_at");
  const card = byId(data.allocation_cards, "name");
  const strip = (row: Row, drop: string[]) =>
    Object.fromEntries(Object.entries(row).filter(([k]) => !drop.includes(k)));
  const sorted = (rows: Row[]) => rows.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  const rows = (table: keyof BackupData) => data[table] as unknown as Row[];
  return {
    // updated_at: the restore upserts this row and the BEFORE UPDATE trigger
    // user_prefs_updated_at stamps now() over the file's value (see report).
    user_preferences: sorted(rows("user_preferences").map((r) => strip(r, ["user_id", "updated_at"]))),
    assets: sorted(rows("assets").map((r) => strip(r, ["id", "user_id"]))),
    tags: sorted(rows("tags").map((r) => strip(r, ["id", "user_id"]))),
    asset_tags: sorted(
      rows("asset_tags").map((r) => ({
        ...strip(r, ["user_id", "asset_id", "tag_id"]),
        asset: asset.get(r.asset_id as string),
        tag: tag.get(r.tag_id as string),
      })),
    ),
    snapshots: sorted(rows("snapshots").map((r) => strip(r, ["id", "user_id"]))),
    snapshot_items: sorted(
      rows("snapshot_items").map((r) => ({
        ...strip(r, ["id", "snapshot_id", "tag_ids"]),
        snapshot: snapshot.get(r.snapshot_id as string),
        tags: Array.isArray(r.tag_ids) ? (r.tag_ids as string[]).map((t) => tag.get(t) ?? `dangling:${t}`) : r.tag_ids,
      })),
    ),
    goals: sorted(rows("goals").map((r) => strip(r, ["id", "user_id"]))),
    allocation_cards: sorted(rows("allocation_cards").map((r) => strip(r, ["id", "user_id"]))),
    allocation_targets: sorted(
      rows("allocation_targets").map((r) => ({
        ...strip(r, ["id", "user_id", "asset_id", "card_id"]),
        asset: asset.get(r.asset_id as string),
        card: card.get(r.card_id as string),
      })),
    ),
  };
}

describe("restore_backup on real Postgres", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await bootDb();
    await seedUser(db, USER_A, "Alpha");
    await seedUser(db, USER_B, "Bravo");
  });
  afterEach(async () => {
    await db.close();
  });

  it("round-trips a full backup in replace mode: restored rows equal the backup", async () => {
    const backup = await exportFile(db, USER_A);
    // Non-vacuous: every table and every nullable column the clause names is populated.
    const counts = Object.fromEntries(Object.entries(backup.data).map(([t, r]) => [t, (r as unknown[]).length]));
    expect(counts).toEqual({
      user_preferences: 1,
      assets: 3,
      snapshots: 2,
      snapshot_items: 5,
      goals: 2,
      allocation_cards: 1,
      allocation_targets: 2,
      tags: 2,
      asset_tags: 3,
    });
    const byDate = [...backup.data.snapshots].sort((x, y) => x.created_at.localeCompare(y.created_at));
    expect(byDate.map((s) => [s.income, s.net_contribution])).toEqual([
      [null, null],
      [4200, -250],
    ]);
    expect(backup.data.snapshot_items.map((i) => i.tag_ids?.length ?? null).sort()).toEqual([0, 1, 2, null, null]);

    // Make the restore observable: change the live rows first, so equality
    // afterwards can only come from the file.
    await db.query("UPDATE assets SET amount = 1, name = name || ' (edited)' WHERE user_id = $1", [USER_A]);
    await db.query("DELETE FROM tags WHERE user_id = $1 AND name = 'Crypto'", [USER_A]);
    await db.query("UPDATE snapshots SET income = 1 WHERE user_id = $1", [USER_A]);
    await db.query("DELETE FROM goals WHERE user_id = $1", [USER_A]);
    await db.query("UPDATE user_preferences SET theme = 'light', fire_current_age = 99 WHERE user_id = $1", [USER_A]);

    await importFile(db, USER_A, "replace", backup);

    const after = await exportFile(db, USER_A);
    expect(canonical(after.data)).toEqual(canonical(backup.data));
    // Ids were regenerated, so the equality above is not a no-op.
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    expect(ids(after.data.assets)).not.toEqual(expect.arrayContaining(ids(backup.data.assets)));
  });

  it("restoring user A (replace, then merge) leaves user B's rows untouched: counts and checksums", async () => {
    const before = await userFingerprint(db, USER_B);
    expect(before.assets.startsWith("3:")).toBe(true);
    expect(before.snapshot_items.startsWith("5:")).toBe(true);

    const backup = await exportFile(db, USER_A);
    await importFile(db, USER_A, "replace", backup);
    expect(await userFingerprint(db, USER_B)).toEqual(before);
    await importFile(db, USER_A, "merge", backup);
    expect(await userFingerprint(db, USER_B)).toEqual(before);

    // And user A's restore did run: merge appended a second copy of its assets.
    const a = await userFingerprint(db, USER_A);
    expect(a.assets.startsWith("6:")).toBe(true);
  });

  it("an empty replace for user A clears only user A", async () => {
    const before = await userFingerprint(db, USER_B);
    await restore(db, USER_A, "replace", { user_preferences: [] });
    const a = await userFingerprint(db, USER_A);
    for (const table of ["assets", "snapshots", "snapshot_items", "goals", "allocation_cards", "tags", "asset_tags"]) {
      expect(a[table], table).toBe("0:-");
    }
    expect(await userFingerprint(db, USER_B)).toEqual(before);
  });
});

describe("restore_backup and schemaVersion", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await bootDb();
    await seedUser(db, USER_A, "Alpha");
  });
  afterEach(async () => {
    await db.close();
  });

  it("an old schemaVersion 1 file restores; columns added since land as NULL / their defaults", async () => {
    const v1 = {
      schemaVersion: 1,
      exportedAt: "2026-06-01T00:00:00.000Z",
      app: "bitworth",
      // v1 shape: four tables, none of the keys added later (goals,
      // allocation_*, tags, asset_tags; sort_order, metal_symbol,
      // show_on_chart, net_contribution, income, tag_ids, show_* prefs).
      data: {
        user_preferences: [{ user_id: "old-owner", display_currency: "PLN", theme: "light" }],
        assets: [
          {
            id: "old-asset",
            user_id: "old-owner",
            category_id: "cash_on_hand",
            name: "Wallet",
            amount: 300,
            currency: "PLN",
            crypto_symbol: null,
            notes: null,
            quantity: null,
            created_at: "2026-05-01T10:00:00+00:00",
            updated_at: "2026-05-01T10:00:00+00:00",
          },
        ],
        snapshots: [
          {
            id: "old-snap",
            user_id: "old-owner",
            total_net_worth: 300,
            display_currency: "PLN",
            base_currency: "USD",
            source: "manual",
            note: null,
            created_at: "2026-05-31T10:00:00+00:00",
          },
        ],
        snapshot_items: [
          {
            id: "old-item",
            snapshot_id: "old-snap",
            category_id: "cash_on_hand",
            name: "Wallet",
            original_amount: 300,
            original_currency: "PLN",
            converted_amount: 300,
            display_currency: "PLN",
            exchange_rate_usd: 0.25,
            display_order: 0,
            created_at: "2026-05-31T10:00:00+00:00",
          },
        ],
      },
    };
    await importFile(db, USER_A, "replace", v1);

    const asset = await db.query<Row>(
      "SELECT name, sort_order, show_on_chart, metal_symbol FROM assets WHERE user_id = $1",
      [USER_A],
    );
    expect(asset.rows).toEqual([{ name: "Wallet", sort_order: 0, show_on_chart: false, metal_symbol: null }]);
    const snap = await db.query<Row>("SELECT net_contribution, income FROM snapshots WHERE user_id = $1", [USER_A]);
    expect(snap.rows).toEqual([{ net_contribution: null, income: null }]);
    const item = await db.query<Row>(
      "SELECT tag_ids FROM snapshot_items WHERE snapshot_id IN (SELECT id FROM snapshots WHERE user_id = $1)",
      [USER_A],
    );
    expect(item.rows).toEqual([{ tag_ids: null }]);
    const prefs = await db.query<Row>(
      "SELECT display_currency, theme, show_goals, show_trajectory, fire_safe_withdrawal_rate::text AS swr FROM user_preferences WHERE user_id = $1",
      [USER_A],
    );
    expect(prefs.rows).toEqual([
      { display_currency: "PLN", theme: "light", show_goals: true, show_trajectory: true, swr: "0.0400" },
    ]);
    const empty = await userFingerprint(db, USER_A);
    for (const table of ["goals", "allocation_cards", "allocation_targets", "tags", "asset_tags"]) {
      expect(empty[table], table).toBe("0:-");
    }
  });

  it("a newer (unknown) schemaVersion is refused before restore_backup is reached; the database is unchanged", async () => {
    const before = await userFingerprint(db, USER_A);
    const file = { ...(await exportFile(db, USER_A)), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    const validated = validateEnvelope(file, await categoryIds(db));
    expect(validated.ok).toBe(false);
    expect(validated.ok ? null : validated.code).toBe("UNSUPPORTED_VERSION");
    expect(await userFingerprint(db, USER_A)).toEqual(before);
  });

  it("restore_backup itself reads no version: unknown top-level and column keys are ignored", async () => {
    const backup = await exportFile(db, USER_A);
    const validated = validateEnvelope(backup, await categoryIds(db));
    if (!validated.ok) throw new Error(validated.code);
    const payload = prepareImport(validated.data, () => randomUUID()).payload;
    const decorated = {
      ...payload,
      schemaVersion: 99,
      some_future_table: [{ x: 1 }],
      assets: payload.assets.map((a) => ({ ...a, some_future_column: "x" })),
    };
    await restore(db, USER_A, "replace", decorated);
    const after = await exportFile(db, USER_A);
    expect(canonical(after.data)).toEqual(canonical(backup.data));
  });
});
