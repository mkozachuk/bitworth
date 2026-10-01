import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALLOCATION_CARDS_COLUMNS,
  ALLOCATION_TARGETS_COLUMNS,
  ASSETS_COLUMNS,
  GOALS_COLUMNS,
  SNAPSHOTS_COLUMNS,
  SNAPSHOT_ITEMS_COLUMNS,
  USER_PREFERENCES_COLUMNS,
} from "@/lib/backup";

// Completeness guard: every real column of a backed-up table is exported.
//
// `backup-rpc-parity.test.ts` checks export against import, so it cannot see a
// column that BOTH halves forget: they agree with each other and the column is
// still lost. That is how `snapshots.net_contribution` went missing. This test
// adds the third reference point, the table's real columns, taken from the
// generated `database.types.ts`.
//
// It parses the file instead of using a type-level check. A type-level
// exhaustiveness assertion only fails under `tsc`, so a dropped column would
// show up in `typecheck` but `vitest run` would stay green. Parsing keeps the
// guard in the same red/green signal as its sibling parity test.

const TYPES_FILE = new URL("./database.types.ts", import.meta.url);

// Columns of a backed-up table that are deliberately NOT exported, each with
// its reason. Empty for every table today: backups are whole-row by design.
// Adding a column here is a decision, so write the reason next to it.
const NOT_BACKED_UP: Record<string, readonly string[]> = {
  user_preferences: [],
  assets: [],
  snapshots: [],
  snapshot_items: [],
  goals: [],
  allocation_cards: [],
  allocation_targets: [],
};

// The generator emits each table as
//   `      <table>: {\n        Row: {\n          col: type;\n ...        };`
// with fixed indentation, so the Row block runs from `Row: {` to the first
// `};` at the same 8-space depth.
function rowColumns(source: string, table: string): string[] {
  const block = new RegExp(`\\n {6}${table}: \\{\\n {8}Row: \\{\\n([\\s\\S]*?)\\n {8}\\};`).exec(source);
  if (!block) throw new Error(`no Row block for table ${table} in database.types.ts`);
  return block[1]
    .split("\n")
    .map((line) => /^ {10}(\w+)\??:/.exec(line)?.[1])
    .filter((c): c is string => c !== undefined);
}

const source = readFileSync(TYPES_FILE, "utf8");

const TABLES = [
  ["user_preferences", USER_PREFERENCES_COLUMNS],
  ["assets", ASSETS_COLUMNS],
  ["snapshots", SNAPSHOTS_COLUMNS],
  ["snapshot_items", SNAPSHOT_ITEMS_COLUMNS],
  ["goals", GOALS_COLUMNS],
  ["allocation_cards", ALLOCATION_CARDS_COLUMNS],
  ["allocation_targets", ALLOCATION_TARGETS_COLUMNS],
] as const;

describe("backup export completeness (database.types.ts)", () => {
  it.each(TABLES)("%s: the export whitelist equals the table's Row columns", (table, exported) => {
    const expected = rowColumns(source, table).filter((c) => !NOT_BACKED_UP[table].includes(c));
    expect([...exported].sort()).toEqual([...expected].sort());
  });

  it.each(TABLES)("%s: the Row parser reads the table, not an empty block", (table) => {
    // Without this, a change in the generator's layout could make every table
    // parse as [] and the guard above would compare against nothing useful.
    const cols = rowColumns(source, table);
    expect(cols).toContain("created_at");
    expect(cols.length).toBeGreaterThanOrEqual(5);
  });

  it("every exclusion names a real column", () => {
    for (const [table] of TABLES) {
      const cols = rowColumns(source, table);
      for (const excluded of NOT_BACKED_UP[table]) expect(cols).toContain(excluded);
    }
  });
});
