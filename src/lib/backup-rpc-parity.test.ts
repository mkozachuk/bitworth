import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSETS_COLUMNS,
  GOALS_COLUMNS,
  SNAPSHOTS_COLUMNS,
  SNAPSHOT_ITEMS_COLUMNS,
  USER_PREFERENCES_COLUMNS,
} from "@/lib/backup";

// Parity guard between the two halves of the backup round-trip.
//
// `backup.ts` owns the EXPORT whitelists; the `restore_backup` RPC owns the
// IMPORT column lists. Nothing links them, and the failure is silent: a column
// added to the export but missed in the RPC writes to the backup file and is
// then discarded on the way back in. That has shipped three times already
// (show_fire_dashboard/show_drift_alerts, metal_symbol, show_trajectory), each
// time fixed by a follow-up migration. This test turns the fourth occurrence
// into a red run instead of quiet data loss.
//
// It parses the newest migration that redeclares the function, so it tracks the
// live definition without needing a database.

const MIGRATIONS_DIR = new URL("../../supabase/migrations/", import.meta.url);

// Columns the RPC deliberately omits: `prepareForImport` strips these parent ids
// and the function regenerates or remaps them. Everything else must match.
const INTENTIONALLY_OMITTED: Record<string, readonly string[]> = {
  user_preferences: [],
  assets: ["id"],
  snapshots: [],
  snapshot_items: ["id"],
  goals: ["id"],
};

function latestRestoreBackupMigration(): { name: string; sql: string } {
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .reverse();

  for (const name of names) {
    const sql = readFileSync(new URL(name, MIGRATIONS_DIR), "utf8");
    if (sql.includes("CREATE OR REPLACE FUNCTION restore_backup")) return { name, sql };
  }
  throw new Error("no migration declaring restore_backup found");
}

// `INSERT INTO <table> (\n a,\n b\n )\n SELECT` — the column list holds no
// parentheses of its own, so a non-greedy run of non-`)` characters is enough.
function insertColumnLists(sql: string): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  const pattern = /INSERT INTO (\w+) \(([^)]*)\)\s*SELECT/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    lists[match[1]] = match[2]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  }
  return lists;
}

// The `col = EXCLUDED.col` assignments in the user_preferences upsert.
function conflictUpdateColumns(sql: string): string[] {
  const block = /ON CONFLICT \(user_id\) DO UPDATE SET([\s\S]*?);/.exec(sql);
  if (!block) throw new Error("no ON CONFLICT DO UPDATE SET block found");
  return [...block[1].matchAll(/(\w+) = EXCLUDED\.\w+/g)].map((m) => m[1]);
}

const { name: migrationName, sql } = latestRestoreBackupMigration();
const inserts = insertColumnLists(sql);

const TABLES = [
  ["user_preferences", USER_PREFERENCES_COLUMNS],
  ["assets", ASSETS_COLUMNS],
  ["snapshots", SNAPSHOTS_COLUMNS],
  ["snapshot_items", SNAPSHOT_ITEMS_COLUMNS],
  ["goals", GOALS_COLUMNS],
] as const;

describe(`restore_backup import parity (${migrationName})`, () => {
  it.each(TABLES)("%s: every exported column is imported", (table, exported) => {
    const expected = exported.filter((c) => !INTENTIONALLY_OMITTED[table].includes(c));
    expect(inserts[table]).toBeDefined();
    expect([...inserts[table]].sort()).toEqual([...expected].sort());
  });

  it("user_preferences: the upsert branch updates every column it inserts", () => {
    // A column present in the INSERT list but absent here restores correctly on
    // a fresh row and silently keeps the stale value on an existing one — the
    // exact shape of the show_trajectory bug, since the prefs row always exists.
    const inserted = inserts.user_preferences.filter((c) => c !== "user_id");
    expect([...conflictUpdateColumns(sql)].sort()).toEqual([...inserted].sort());
  });
});

// `net_contribution` is nullable and NULL ("not recorded") differs from 0, so the
// RPC must take it as-is. A pre-S-17-export backup has no such key at all, and
// `jsonb_populate_recordset` leaves a missing key NULL — but only if the SELECT
// does not wrap it in a COALESCE. There is no database here, so read the SQL.
function snapshotsSelectExpressions(sql: string): string[] {
  const block =
    /INSERT INTO snapshots \([^)]*\)\s*SELECT([\s\S]*?)FROM jsonb_populate_recordset\(null::snapshots, p_data->'snapshots'\) AS r;/.exec(
      sql,
    );
  if (!block) throw new Error("no snapshots INSERT ... SELECT ... FROM jsonb_populate_recordset block found");
  // Split on top-level commas only: `COALESCE(r.base_currency, 'USD')` is one
  // expression.
  const exprs: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of block[1]) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      exprs.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  exprs.push(current.trim());
  return exprs.filter(Boolean);
}

describe(`restore_backup snapshots.net_contribution (${migrationName})`, () => {
  it("selects r.net_contribution bare, so a missing key or null stays NULL (never COALESCEd to 0)", () => {
    const exprs = snapshotsSelectExpressions(sql);
    const idx = inserts.snapshots.indexOf("net_contribution");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(exprs).toHaveLength(inserts.snapshots.length);
    expect(exprs[idx]).toBe("r.net_contribution");
  });
});
