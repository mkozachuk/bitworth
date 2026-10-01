import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALLOCATION_CARDS_COLUMNS,
  ALLOCATION_TARGETS_COLUMNS,
  ASSET_TAGS_COLUMNS,
  ASSETS_COLUMNS,
  GOALS_COLUMNS,
  SNAPSHOTS_COLUMNS,
  SNAPSHOT_ITEMS_COLUMNS,
  TAGS_COLUMNS,
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

// Columns the RPC deliberately omits: `prepareForImport` strips these ids and
// the database generates them. Everything else must match. `assets.id` and
// `allocation_cards.id` are NOT omitted: prepareForImport regenerates them so
// targets can be remapped, and the RPC inserts them as given. `tags.id` likewise
// (links are remapped to it); `asset_tags` has no id of its own.
const INTENTIONALLY_OMITTED: Record<string, readonly string[]> = {
  user_preferences: [],
  assets: [],
  snapshots: [],
  snapshot_items: ["id"],
  goals: ["id"],
  allocation_cards: [],
  allocation_targets: ["id"],
  tags: [],
  asset_tags: [],
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
  ["allocation_cards", ALLOCATION_CARDS_COLUMNS],
  ["allocation_targets", ALLOCATION_TARGETS_COLUMNS],
  ["tags", TAGS_COLUMNS],
  ["asset_tags", ASSET_TAGS_COLUMNS],
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

// Slice C2. `INSERT ... SELECT` expressions for any table, split on top-level
// commas, so a test can read what the RPC actually writes into a column.
function selectExpressions(sql: string, table: string): string[] {
  const block = new RegExp(
    `INSERT INTO ${table} \\([^)]*\\)\\s*SELECT([\\s\\S]*?)FROM jsonb_populate_recordset\\(null::${table}, p_data->'${table}'\\) AS r;`,
  ).exec(sql);
  if (!block) throw new Error(`no ${table} INSERT ... SELECT ... FROM jsonb_populate_recordset block found`);
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

function expressionFor(table: string, column: string): string {
  const idx = inserts[table].indexOf(column);
  if (idx < 0) throw new Error(`${table}.${column} is not in the INSERT column list`);
  const exprs = selectExpressions(sql, table);
  expect(exprs).toHaveLength(inserts[table].length);
  return exprs[idx];
}

describe(`restore_backup allocation cards and targets (${migrationName})`, () => {
  it("assets are inserted with the id from the payload, so the target remap holds", () => {
    // The fallback only serves a payload with no asset ids (a pre-v3 client).
    expect(expressionFor("assets", "id")).toBe("COALESCE(r.id, gen_random_uuid())");
  });

  it("cards are inserted with their payload id; targets with the remapped card_id and asset_id", () => {
    expect(expressionFor("allocation_cards", "id")).toBe("r.id");
    expect(expressionFor("allocation_targets", "card_id")).toBe("r.card_id");
    expect(expressionFor("allocation_targets", "asset_id")).toBe("r.asset_id");
    expect(expressionFor("allocation_targets", "target_pct")).toBe("r.target_pct");
    for (const table of ["allocation_cards", "allocation_targets"]) {
      expect(expressionFor(table, "user_id")).toBe("v_user");
    }
  });

  it("inserts assets and cards before targets", () => {
    const at = (t: string) => sql.indexOf(`INSERT INTO ${t} (`);
    expect(at("assets")).toBeGreaterThan(0);
    expect(at("allocation_cards")).toBeGreaterThan(at("assets"));
    expect(at("allocation_targets")).toBeGreaterThan(at("allocation_cards"));
  });

  it("replace mode deletes targets, then cards, before assets; no DELETE runs outside replace mode", () => {
    // Read the function body only: the migration header prose mentions DELETEs.
    const body = /AS \$\$([\s\S]*?)\$\$;/.exec(sql)?.[1];
    if (!body) throw new Error("no function body found");
    const block = /IF p_mode = 'replace' THEN([\s\S]*?)END IF;/.exec(body);
    if (!block) throw new Error("no replace-mode block found");
    const deletes = [...block[1].matchAll(/DELETE FROM (\w+)/g)].map((m) => m[1]);
    expect(deletes).toEqual([
      "asset_tags",
      "tags",
      "allocation_targets",
      "allocation_cards",
      "snapshot_items",
      "snapshots",
      "assets",
      "goals",
    ]);
    // Merge mode must never touch the user's existing cards: every DELETE in
    // the function sits inside the replace block.
    expect([...body.matchAll(/DELETE FROM/g)]).toHaveLength(deletes.length);
  });
});

// Slice B1a. The INSERT ... SELECT block for a table, up to its terminating
// semicolon, with the column list and the SELECT expressions split out. The tag
// inserts end in a WHERE or JOINs, so this does not assume `AS r;`.
function insertBlock(table: string): { columns: string[]; exprs: string[]; tail: string } {
  const block = new RegExp(`INSERT INTO ${table} \\(([^)]*)\\)\\s*SELECT([\\s\\S]*?)\\n\\s*FROM ([\\s\\S]*?);`).exec(
    sql,
  );
  if (!block) throw new Error(`no ${table} INSERT ... SELECT ... FROM block found`);
  const exprs: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of block[2]) {
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
  return {
    columns: block[1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    exprs: exprs.filter(Boolean),
    tail: block[3].replace(/\s+/g, " ").trim(),
  };
}

function tagExpr(table: string, column: string): string {
  const { columns, exprs } = insertBlock(table);
  expect(exprs).toHaveLength(columns.length);
  const idx = columns.indexOf(column);
  if (idx < 0) throw new Error(`${table}.${column} is not in the INSERT column list`);
  return exprs[idx];
}

describe(`restore_backup tags and asset_tags (${migrationName})`, () => {
  it("tags are inserted with their payload id and user_id stamped; show_on_dashboard defaults to false", () => {
    expect(tagExpr("tags", "id")).toBe("r.id");
    expect(tagExpr("tags", "user_id")).toBe("v_user");
    expect(tagExpr("tags", "name")).toBe("r.name");
    expect(tagExpr("tags", "show_on_dashboard")).toBe("COALESCE(r.show_on_dashboard, false)");
    expect(tagExpr("asset_tags", "asset_id")).toBe("r.asset_id");
    expect(tagExpr("asset_tags", "user_id")).toBe("v_user");
  });

  it("merge-mode name clash: a file tag whose name matches an existing tag, ignoring case, is not inserted", () => {
    // The skip condition is the unique index's own key, (user_id, lower(name)),
    // so whatever the index would reject as a duplicate is exactly what is
    // merged instead of violating it.
    expect(insertBlock("tags").tail).toBe(
      "jsonb_populate_recordset(null::tags, p_data->'tags') AS r " +
        "WHERE NOT EXISTS ( SELECT 1 FROM tags t WHERE t.user_id = v_user AND lower(t.name) = lower(r.name) )",
    );
  });

  it("merge-mode name clash: a link is attached to the caller's tag of the file tag's name (the merged tag)", () => {
    // tag_id is NOT the payload's r.tag_id: it is resolved through the file tag's
    // name to the caller's tag, which is either the file tag inserted above or
    // the existing tag it merged into. LEFT joins: an unresolvable link yields a
    // NULL tag_id, which fails NOT NULL and rolls the restore back.
    expect(tagExpr("asset_tags", "tag_id")).toBe("t.id");
    expect(insertBlock("asset_tags").tail).toBe(
      "jsonb_populate_recordset(null::asset_tags, p_data->'asset_tags') AS r " +
        "LEFT JOIN jsonb_populate_recordset(null::tags, p_data->'tags') AS f ON f.id = r.tag_id " +
        "LEFT JOIN tags t ON t.user_id = v_user AND lower(t.name) = lower(f.name)",
    );
  });

  it("the name match is the same key as the tags unique index in the schema migration", () => {
    const schema = readdirSync(MIGRATIONS_DIR)
      .filter((n) => n.endsWith(".sql"))
      .map((n) => readFileSync(new URL(n, MIGRATIONS_DIR), "utf8"))
      .find((text) => text.includes("CREATE TABLE tags ("));
    if (!schema) throw new Error("no migration creates the tags table");
    expect(schema).toContain("CREATE UNIQUE INDEX tags_user_id_lower_name_key ON tags (user_id, lower(name));");
  });

  it("inserts assets before tags, and tags before asset_tags", () => {
    const at = (t: string) => sql.indexOf(`INSERT INTO ${t} (`);
    expect(at("tags")).toBeGreaterThan(at("assets"));
    expect(at("asset_tags")).toBeGreaterThan(at("tags"));
  });

  it("merge mode never updates an existing tag: no UPDATE or upsert touches tags", () => {
    const body = /AS \$\$([\s\S]*?)\$\$;/.exec(sql)?.[1];
    if (!body) throw new Error("no function body found");
    expect(body).not.toMatch(/UPDATE\s+tags\b/);
    const tagsInsert = /INSERT INTO tags \([\s\S]*?;/.exec(body)?.[0] ?? "";
    expect(tagsInsert).not.toContain("ON CONFLICT");
  });
});
