import type { Tables } from "./database.types";

// Pure, synchronous backup (de)serialization module. No Supabase imports, no
// `Date.now()`/`crypto.randomUUID()` — every non-deterministic input is injected
// so the whole surface is exhaustively unit-testable. Mirrors the pure-helper
// convention in `net-worth.ts`.
//
// Three layers cross the export/import boundary here:
//   1. column whitelists — the authoritative list of fields that round-trip,
//   2. serialize        — fetched rows → versioned envelope (whole-row, whitelisted),
//   3. validateEnvelope — untrusted parsed file → typed data | structured error,
//   4. prepareForImport — validated data → RPC-ready payload (drop ownership,
//                          regenerate parent ids, remap child FKs).

// Bumped to 2 when `goals` joined the envelope. Version 1 files carry no
// `goals` key at all, so that table is OPTIONAL on read (see `validateEnvelope`)
// — the version policy below only rejects NEWER files, and treating a missing
// `goals` array as `[]` is what makes that acceptance real rather than nominal.
export const CURRENT_SCHEMA_VERSION = 2;

type UserPreferencesRow = Tables<"user_preferences">;
type AssetRow = Tables<"assets">;
type SnapshotRow = Tables<"snapshots">;
type SnapshotItemRow = Tables<"snapshot_items">;
type GoalRow = Tables<"goals">;

// Column-explicit whitelists. Typed as `(keyof Row)[]` so a typo or a dropped
// column fails `tsc` rather than silently shrinking the backup. Whole-row by
// design — the easy-to-drop fields (9 `fire_*`, `quantity`, `show_on_chart`,
// both timestamps) are listed explicitly. `id`/`user_id` ARE included so the
// file carries whole rows and the snapshots→snapshot_items relationship is
// expressible; `prepareForImport` strips/remaps them on the way back in.

export const USER_PREFERENCES_COLUMNS = [
  "user_id",
  "display_currency",
  "theme",
  "fire_annual_expenses",
  "fire_annual_income",
  "fire_barista_income",
  "fire_current_age",
  "fire_expected_return",
  "fire_inflation_rate",
  "fire_safe_withdrawal_rate",
  "fire_starting_principal_override",
  "fire_traditional_retirement_age",
  "show_fire_dashboard",
  "show_drift_alerts",
  "show_goals",
  "show_trajectory",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof UserPreferencesRow)[];

export const ASSETS_COLUMNS = [
  "id",
  "user_id",
  "category_id",
  "name",
  "amount",
  "currency",
  "crypto_symbol",
  "metal_symbol",
  "notes",
  "quantity",
  "show_on_chart",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof AssetRow)[];

export const SNAPSHOTS_COLUMNS = [
  "id",
  "user_id",
  "total_net_worth",
  "display_currency",
  "base_currency",
  "source",
  "note",
  "created_at",
] as const satisfies readonly (keyof SnapshotRow)[];

export const SNAPSHOT_ITEMS_COLUMNS = [
  "id",
  "snapshot_id",
  "category_id",
  "name",
  "original_amount",
  "original_currency",
  "converted_amount",
  "display_currency",
  "display_order",
  "exchange_rate_usd",
  "created_at",
] as const satisfies readonly (keyof SnapshotItemRow)[];

export const GOALS_COLUMNS = [
  "id",
  "user_id",
  "name",
  "kind",
  "category_id",
  "target_amount",
  "target_currency",
  "target_date",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof GoalRow)[];

type UserPreferencesBackup = Pick<UserPreferencesRow, (typeof USER_PREFERENCES_COLUMNS)[number]>;
type AssetBackup = Pick<AssetRow, (typeof ASSETS_COLUMNS)[number]>;
type SnapshotBackup = Pick<SnapshotRow, (typeof SNAPSHOTS_COLUMNS)[number]>;
type SnapshotItemBackup = Pick<SnapshotItemRow, (typeof SNAPSHOT_ITEMS_COLUMNS)[number]>;
type GoalBackup = Pick<GoalRow, (typeof GOALS_COLUMNS)[number]>;

export interface BackupData {
  user_preferences: UserPreferencesBackup[];
  assets: AssetBackup[];
  snapshots: SnapshotBackup[];
  snapshot_items: SnapshotItemBackup[];
  goals: GoalBackup[];
}

export interface BackupEnvelope {
  schemaVersion: number;
  exportedAt: string;
  app: "bitworth";
  data: BackupData;
}

// Loose shape the export route hands to `serialize` — full rows straight from
// Supabase, projected down to the whitelist here.
export interface BackupInput {
  user_preferences: UserPreferencesRow[];
  assets: AssetRow[];
  snapshots: SnapshotRow[];
  snapshot_items: SnapshotItemRow[];
  goals: GoalRow[];
}

// Required NOT-NULL-no-default fields per table (ownership `user_id` and
// auto-generated `id` excluded — the RPC supplies/regenerates those). A row
// missing any of these is structurally invalid and fails the whole envelope.
const REQUIRED_FIELDS = {
  user_preferences: [] as const,
  assets: ["category_id", "name", "amount", "currency"] as const,
  snapshots: ["total_net_worth", "display_currency", "source"] as const,
  snapshot_items: [
    "snapshot_id",
    "category_id",
    "name",
    "original_amount",
    "original_currency",
    "converted_amount",
    "display_currency",
  ] as const,
  goals: ["name", "kind", "target_amount", "target_currency"] as const,
};

// Timestamp columns to validate (ISO-8601 if present). `goals.target_date` is a
// DATE, not a timestamptz — it has no `T` separator and would fail
// `isIsoTimestamp`, so it is deliberately absent here.
const TIMESTAMP_FIELDS = {
  user_preferences: ["created_at", "updated_at"] as const,
  assets: ["created_at", "updated_at"] as const,
  snapshots: ["created_at"] as const,
  snapshot_items: ["created_at"] as const,
  goals: ["created_at", "updated_at"] as const,
};

function pick(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (col in row) out[col] = row[col];
  }
  return out;
}

function omit(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const drop = new Set(columns);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (!drop.has(key)) out[key] = row[key];
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Supabase serializes timestamptz as ISO-8601 with a `T` separator (e.g.
// "2026-06-20T18:38:00.123456+00:00"). Require that shape AND a parseable date.
function isIsoTimestamp(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Project the fetched table arrays down to whitelisted columns and wrap
 * them in a versioned envelope. `exportedAt` is injected (no `Date.now()` here).
 */
export function serialize(data: BackupInput, exportedAt: string): BackupEnvelope {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt,
    app: "bitworth",
    data: {
      user_preferences: data.user_preferences.map((r) => pick(r, USER_PREFERENCES_COLUMNS)) as UserPreferencesBackup[],
      assets: data.assets.map((r) => pick(r, ASSETS_COLUMNS)) as AssetBackup[],
      snapshots: data.snapshots.map((r) => pick(r, SNAPSHOTS_COLUMNS)) as SnapshotBackup[],
      snapshot_items: data.snapshot_items.map((r) => pick(r, SNAPSHOT_ITEMS_COLUMNS)) as SnapshotItemBackup[],
      goals: data.goals.map((r) => pick(r, GOALS_COLUMNS)) as GoalBackup[],
    },
  };
}

export type ValidateResult =
  | { ok: true; data: BackupData }
  | { ok: false; code: string; message: string; context?: unknown };

function fail(code: string, message: string, context?: unknown): ValidateResult {
  return context === undefined ? { ok: false, code, message } : { ok: false, code, message, context };
}

/**
 * Hand-validate an untrusted parsed object before any write: envelope shape,
 * version policy, per-row required fields, timestamp format, and category-id
 * membership. All-or-nothing — one violation fails the whole envelope. No Zod
 * (none in the repo). Returns the typed data or a structured error whose shape
 * matches the project's `ErrorShape` (`code`/`message`/`context`).
 */
export function validateEnvelope(parsed: unknown, validCategoryIds: ReadonlySet<string>): ValidateResult {
  if (!isRecord(parsed)) {
    return fail("INVALID_ENVELOPE", "Backup file is not a JSON object.");
  }
  if (parsed.app !== "bitworth") {
    return fail("INVALID_ENVELOPE", "File is not a bitworth backup (missing or wrong `app` marker).");
  }
  const version = parsed.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return fail("INVALID_ENVELOPE", "Backup `schemaVersion` is missing or not an integer.");
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return fail(
      "UNSUPPORTED_VERSION",
      `Backup was made by a newer version of the app (schemaVersion ${version} > ${CURRENT_SCHEMA_VERSION}). Update the app and try again.`,
      { schemaVersion: version, supported: CURRENT_SCHEMA_VERSION },
    );
  }
  if (!isRecord(parsed.data)) {
    return fail("INVALID_ENVELOPE", "Backup `data` section is missing or malformed.");
  }
  const data = parsed.data;

  // Each version-1 table must be present as an array.
  const requiredTables = ["user_preferences", "assets", "snapshots", "snapshot_items"] as const;
  for (const table of requiredTables) {
    if (!Array.isArray(data[table])) {
      return fail("INVALID_ENVELOPE", `Backup is missing the \`${table}\` array.`, { table });
    }
  }

  // `goals` joined the envelope in schemaVersion 2. A version-1 file has no
  // `goals` key at all, and the version policy above accepts older files — so an
  // ABSENT `goals` normalises to `[]` instead of failing, which is what keeps
  // every previously-exported file importable. A present-but-malformed one is
  // still an error.
  if (data.goals !== undefined && data.goals !== null && !Array.isArray(data.goals)) {
    return fail("INVALID_ENVELOPE", "Backup `goals` section is not an array.", { table: "goals" });
  }
  const normalised: Record<string, unknown> = {
    ...data,
    goals: Array.isArray(data.goals) ? data.goals : [],
  };

  const tables = [...requiredTables, "goals"] as const;

  // Per-row structural validation + timestamp shape.
  for (const table of tables) {
    const rows = normalised[table] as unknown[];
    const required = REQUIRED_FIELDS[table];
    const timestamps = TIMESTAMP_FIELDS[table];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!isRecord(row)) {
        return fail("INVALID_ROW", `Row ${i} in \`${table}\` is not an object.`, { table, index: i });
      }
      for (const field of required) {
        if (row[field] === undefined || row[field] === null) {
          return fail("INVALID_ROW", `Row ${i} in \`${table}\` is missing required field \`${field}\`.`, {
            table,
            index: i,
            field,
          });
        }
      }
      for (const field of timestamps) {
        if (row[field] !== undefined && row[field] !== null && !isIsoTimestamp(row[field])) {
          return fail("INVALID_ROW", `Row ${i} in \`${table}\` has a non-ISO-8601 \`${field}\` timestamp.`, {
            table,
            index: i,
            field,
          });
        }
      }
    }
  }

  // Semantic validation — `kind` ∈ enum, `target_currency` ∈ enum,
  // `target_amount > 0`, and `kind`↔`category_id` coherence — is deliberately NOT
  // repeated here. The goals table's DB CHECK constraints are the single source of
  // truth, and `restore_backup` runs as one transaction, so a semantically-bad row
  // rolls the whole import back cleanly with no partial write. This mirrors the
  // assets/snapshots posture, which likewise leaves currency/amount to the DB on
  // import. The tradeoff is that such a row surfaces as `500 RESTORE_FAILED` rather
  // than a granular `400` — accepted here. `category_id` membership (below) is the
  // one semantic check kept in this layer, because the FK's failure mode is a
  // RESTRICT error that is harder to attribute than a CHECK.

  // Category-id membership — collect every offending id so the user sees the
  // full set, not just the first. First real use of `ErrorShape.context`.
  // A `net_worth` goal carries a null `category_id`; the `typeof` guard skips it.
  const unknownCategoryIds = new Set<string>();
  for (const table of ["assets", "snapshot_items", "goals"] as const) {
    for (const row of normalised[table] as Record<string, unknown>[]) {
      const cid = row.category_id;
      if (typeof cid === "string" && !validCategoryIds.has(cid)) {
        unknownCategoryIds.add(cid);
      }
    }
  }
  if (unknownCategoryIds.size > 0) {
    return fail("UNKNOWN_CATEGORY", "Backup references category ids that do not exist in this app.", {
      unknownCategoryIds: [...unknownCategoryIds],
    });
  }

  return { ok: true, data: normalised as unknown as BackupData };
}

export interface PreparedBackup {
  user_preferences: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  snapshot_items: Record<string, unknown>[];
  goals: Record<string, unknown>[];
}

/**
 * Transform validated data into an RPC-ready, internally-consistent payload:
 * drop ownership fields (`user_id`) and auto-generated `id`s, regenerate each
 * parent `snapshots.id`, and remap every `snapshot_items.snapshot_id` to its new
 * parent. `newId` is injected for deterministic tests (no `crypto.randomUUID()`
 * here). `user_preferences` stays keyed on the user (the RPC upserts it and
 * stamps `user_id` itself), so its `user_id` is dropped too.
 */
export function prepareForImport(data: BackupData, newId: () => string): PreparedBackup {
  const user_preferences = data.user_preferences.map((r) => omit(r as Record<string, unknown>, ["user_id"]));

  const assets = data.assets.map((r) => omit(r as Record<string, unknown>, ["id", "user_id"]));

  const idMap = new Map<string, string>();
  const snapshots = data.snapshots.map((r) => {
    const row = r as Record<string, unknown>;
    const oldId = row.id as string;
    const fresh = newId();
    idMap.set(oldId, fresh);
    return { ...omit(row, ["user_id"]), id: fresh };
  });

  const snapshot_items = data.snapshot_items.map((r) => {
    const row = omit(r, ["id"]);
    const oldSnapshotId = row.snapshot_id as string;
    // Fallback to the original id keeps the payload honest: an orphan item
    // (no matching parent in the file) carries an id the RPC's FK will reject,
    // rolling the whole restore back rather than silently dropping the row.
    return { ...row, snapshot_id: idMap.get(oldSnapshotId) ?? oldSnapshotId };
  });

  // goals own their `user_id` directly and have no child rows, so they only
  // shed ownership — the RPC stamps `user_id` and lets `id` default.
  const goals = data.goals.map((r) => omit(r as Record<string, unknown>, ["id", "user_id"]));

  return { user_preferences, assets, snapshots, snapshot_items, goals };
}
