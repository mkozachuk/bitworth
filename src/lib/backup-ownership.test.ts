import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { serialize, type BackupInput } from "@/lib/backup";

// Ownership guard: every table that holds user data is in the backup.
//
// `backup-completeness.test.ts` checks the COLUMNS of tables already in the
// envelope. It cannot see a whole table that was never added, which is how
// `allocation_cards` and `allocation_targets` went unexported and were then
// cascaded away by replace-mode restore. This test lists the user-owned tables
// straight from the generated `database.types.ts` (every `Tables` entry whose
// `Row` has a `user_id`, plus `snapshot_items`, which is owned through
// `snapshots`) and requires each one to be in the envelope that `serialize`
// actually produces, or in the exclusion list below with its reason.

const TYPES_FILE = new URL("./database.types.ts", import.meta.url);

// Tables owned through a parent rather than by their own `user_id` column.
const OWNED_THROUGH_PARENT = ["snapshot_items"] as const;

// User-owned tables deliberately left out of backups, each with its reason.
// Empty: every user-owned table is backed up. Adding one is a decision, so
// write the reason next to it.
const NOT_BACKED_UP: Record<string, string> = {};

// The generator emits `  public: {\n    Tables: {\n ... \n    };\n    Views: {`.
// Each table inside opens as `      <name>: {\n        Row: {` and its Row
// block closes at the first `};` at 8-space depth.
function userOwnedTables(source: string): string[] {
  const tables = /\n {4}Tables: \{\n([\s\S]*?)\n {4}\};\n {4}Views:/.exec(source);
  if (!tables) throw new Error("no public Tables block in database.types.ts");
  const owned: string[] = [];
  for (const m of tables[1].matchAll(/\n? {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\};/g)) {
    if (/^ {10}user_id\??:/m.test(m[2])) owned.push(m[1]);
  }
  return owned;
}

function allTables(source: string): string[] {
  const tables = /\n {4}Tables: \{\n([\s\S]*?)\n {4}\};\n {4}Views:/.exec(source);
  if (!tables) throw new Error("no public Tables block in database.types.ts");
  return [...tables[1].matchAll(/^ {6}(\w+): \{$/gm)].map((m) => m[1]);
}

const source = readFileSync(TYPES_FILE, "utf8");
const owned = [...userOwnedTables(source), ...OWNED_THROUGH_PARENT];

// The envelope as it is really built: serialize an input with every table
// empty and read back which sections it wrote.
const emptyInput = new Proxy({} as BackupInput, { get: () => [] });
const envelopeTables = Object.keys(serialize(emptyInput, "2026-01-01T00:00:00.000Z").data);

describe("backup ownership guard (database.types.ts)", () => {
  it("the parser finds the user-owned tables, not an empty list", () => {
    // Sanity anchors: if the generator's layout changes and parsing silently
    // returns [], the guard below would pass against nothing.
    expect(owned).toEqual(expect.arrayContaining(["assets", "snapshots", "user_preferences", "snapshot_items"]));
    expect(owned.length).toBeGreaterThanOrEqual(7);
    // Tables with no user_id (global reference data and caches) are not swept in.
    expect(allTables(source)).toContain("asset_categories");
    expect(owned).not.toContain("asset_categories");
  });

  it.each(owned)("%s is in the backup envelope or excluded with a reason", (table) => {
    if (table in NOT_BACKED_UP) {
      expect(NOT_BACKED_UP[table].trim().length).toBeGreaterThan(0);
    } else {
      expect(envelopeTables).toContain(table);
    }
  });

  it("the exclusion list is empty and every envelope section is a user-owned table", () => {
    expect(NOT_BACKED_UP).toEqual({});
    for (const table of envelopeTables) expect(owned).toContain(table);
  });
});
