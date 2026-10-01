import type { Tables } from "./database.types";
import { duplicateTagNames, validateTagName } from "./tags";

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
// Bumped to 3 when `allocation_cards` and `allocation_targets` (the balancer)
// joined. Version 1 and 2 files carry neither key; both normalise to `[]` the
// same way `goals` does for version 1.
// Bumped to 4 when `tags` and `asset_tags` (asset tags, B1a) joined. Version
// 1–3 files carry neither key; both normalise to `[]` by the same rule.
export const CURRENT_SCHEMA_VERSION = 4;

type UserPreferencesRow = Tables<"user_preferences">;
type AssetRow = Tables<"assets">;
type SnapshotRow = Tables<"snapshots">;
type SnapshotItemRow = Tables<"snapshot_items">;
type GoalRow = Tables<"goals">;
type AllocationCardRow = Tables<"allocation_cards">;
type AllocationTargetRow = Tables<"allocation_targets">;
type TagRow = Tables<"tags">;
type AssetTagRow = Tables<"asset_tags">;

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
  // The user's custom list order (S-25). Deliberately NOT in REQUIRED_FIELDS or
  // TIMESTAMP_FIELDS: the column has a DB default, so a file exported before
  // S-25 omits it and must stay valid — `restore_backup` COALESCEs it to 0 and
  // the `created_at DESC` tiebreak reproduces the pre-S-25 order.
  "sort_order",
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
  // Signed money in/out recorded with the snapshot (S-17). Nullable with no
  // default: NULL means "not recorded" and is distinct from 0, so it round-trips
  // as-is. A file exported before this column joined the whitelist has no key;
  // `restore_backup` maps the missing key to NULL (no COALESCE).
  "net_contribution",
  // Income earned in the interval ending at this snapshot (B2, S-24), in the
  // snapshot's display_currency. Same rule as net_contribution: nullable, no
  // default, NULL ("not recorded") round-trips as-is, and a file from before
  // B2 has no key, which `restore_backup` maps to NULL.
  "income",
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
  // The ids of the tags the asset carried when the snapshot was saved (B1b).
  // Nullable: NULL means "not recorded" (every row saved before B1b) and is
  // distinct from [] ("recorded, no tags"), so it round-trips as-is. A file from
  // before B1b has no key; `restore_backup` maps it to NULL. On import each
  // element is remapped to its tag's fresh id; see `prepareImport`.
  "tag_ids",
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

// Balancer portfolio cards. `id` is exported because targets reference it;
// `prepareForImport` gives each card a fresh id and remaps the targets.
export const ALLOCATION_CARDS_COLUMNS = [
  "id",
  "user_id",
  "name",
  "position",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof AllocationCardRow)[];

// Balancer targets: one (card, asset) → target_pct row. Both FKs point at rows
// whose ids are regenerated on import, so `prepareForImport` remaps both.
export const ALLOCATION_TARGETS_COLUMNS = [
  "id",
  "user_id",
  "card_id",
  "asset_id",
  "target_pct",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof AllocationTargetRow)[];

// User-defined asset tags. `id` is exported because asset_tags references it;
// `prepareForImport` gives each tag a fresh id and remaps the links. In merge
// mode `restore_backup` folds a tag into the user's existing tag of the same
// name (ignoring case) instead of inserting a second one.
export const TAGS_COLUMNS = [
  "id",
  "user_id",
  "name",
  "show_on_dashboard",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof TagRow)[];

// Asset↔tag links. No id of their own (the key is the pair); both halves point
// at rows whose ids are regenerated on import, so `prepareForImport` remaps both.
export const ASSET_TAGS_COLUMNS = [
  "asset_id",
  "tag_id",
  "user_id",
  "created_at",
] as const satisfies readonly (keyof AssetTagRow)[];

type UserPreferencesBackup = Pick<UserPreferencesRow, (typeof USER_PREFERENCES_COLUMNS)[number]>;
type AssetBackup = Pick<AssetRow, (typeof ASSETS_COLUMNS)[number]>;
type SnapshotBackup = Pick<SnapshotRow, (typeof SNAPSHOTS_COLUMNS)[number]>;
type SnapshotItemBackup = Pick<SnapshotItemRow, (typeof SNAPSHOT_ITEMS_COLUMNS)[number]>;
type GoalBackup = Pick<GoalRow, (typeof GOALS_COLUMNS)[number]>;
type AllocationCardBackup = Pick<AllocationCardRow, (typeof ALLOCATION_CARDS_COLUMNS)[number]>;
type AllocationTargetBackup = Pick<AllocationTargetRow, (typeof ALLOCATION_TARGETS_COLUMNS)[number]>;
type TagBackup = Pick<TagRow, (typeof TAGS_COLUMNS)[number]>;
type AssetTagBackup = Pick<AssetTagRow, (typeof ASSET_TAGS_COLUMNS)[number]>;

export interface BackupData {
  user_preferences: UserPreferencesBackup[];
  assets: AssetBackup[];
  snapshots: SnapshotBackup[];
  snapshot_items: SnapshotItemBackup[];
  goals: GoalBackup[];
  allocation_cards: AllocationCardBackup[];
  allocation_targets: AllocationTargetBackup[];
  tags: TagBackup[];
  asset_tags: AssetTagBackup[];
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
  allocation_cards: AllocationCardRow[];
  allocation_targets: AllocationTargetRow[];
  tags: TagRow[];
  asset_tags: AssetTagRow[];
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
  allocation_cards: ["name"] as const,
  allocation_targets: ["card_id", "asset_id", "target_pct"] as const,
  tags: ["name"] as const,
  asset_tags: ["asset_id", "tag_id"] as const,
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
  allocation_cards: ["created_at", "updated_at"] as const,
  allocation_targets: ["created_at", "updated_at"] as const,
  tags: ["created_at", "updated_at"] as const,
  asset_tags: ["created_at"] as const,
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
      allocation_cards: data.allocation_cards.map((r) => pick(r, ALLOCATION_CARDS_COLUMNS)) as AllocationCardBackup[],
      allocation_targets: data.allocation_targets.map((r) =>
        pick(r, ALLOCATION_TARGETS_COLUMNS),
      ) as AllocationTargetBackup[],
      tags: data.tags.map((r) => pick(r, TAGS_COLUMNS)) as TagBackup[],
      asset_tags: data.asset_tags.map((r) => pick(r, ASSET_TAGS_COLUMNS)) as AssetTagBackup[],
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
  // The allocation tables joined in schemaVersion 3 and follow the same rule:
  // absent (v1/v2 file) normalises to `[]`, present-but-not-an-array fails.
  // The tag tables joined in schemaVersion 4, same rule again.
  const optionalTables = ["goals", "allocation_cards", "allocation_targets", "tags", "asset_tags"] as const;
  for (const table of optionalTables) {
    if (data[table] !== undefined && data[table] !== null && !Array.isArray(data[table])) {
      return fail("INVALID_ENVELOPE", `Backup \`${table}\` section is not an array.`, { table });
    }
  }
  const normalised: Record<string, unknown> = { ...data };
  for (const table of optionalTables) {
    normalised[table] = Array.isArray(data[table]) ? data[table] : [];
  }

  const tables = [...requiredTables, ...optionalTables] as const;

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

  // Every allocation target must point at an asset AND a card carried in this
  // same file, because `prepareForImport` regenerates both parents' ids and can
  // only remap a reference it can see. An orphan fails here, by name, rather
  // than carrying its original id to the RPC: in merge mode that original id
  // can still exist in the database (the user's own live asset or card), so the
  // FK would accept it and the target would silently attach to a row the file
  // never described.
  const idsOf = (table: "assets" | "allocation_cards"): Set<unknown> =>
    new Set((normalised[table] as Record<string, unknown>[]).map((r) => r.id).filter((id) => typeof id === "string"));
  const fileAssetIds = idsOf("assets");
  const fileCardIds = idsOf("allocation_cards");
  const orphanTargets: { index: number; missing: ("asset_id" | "card_id")[] }[] = [];
  (normalised.allocation_targets as Record<string, unknown>[]).forEach((row, index) => {
    const missing: ("asset_id" | "card_id")[] = [];
    if (!fileAssetIds.has(row.asset_id)) missing.push("asset_id");
    if (!fileCardIds.has(row.card_id)) missing.push("card_id");
    if (missing.length > 0) orphanTargets.push({ index, missing });
  });
  if (orphanTargets.length > 0) {
    return fail("ORPHAN_ALLOCATION_TARGET", "Backup has allocation targets whose asset or card is not in the file.", {
      table: "allocation_targets",
      orphanTargets,
    });
  }

  // Tag names follow the API's rule (trimmed, 1–32 characters). A file name
  // that is not already in stored form is rejected rather than silently
  // rewritten, so what is restored is exactly what the file says.
  const tagRows = normalised.tags as Record<string, unknown>[];
  for (let i = 0; i < tagRows.length; i++) {
    const checked = validateTagName(tagRows[i].name);
    if (!checked.ok || checked.name !== tagRows[i].name) {
      return fail("INVALID_ROW", `Row ${i} in \`tags\` has an invalid \`name\`.`, {
        table: "tags",
        index: i,
        field: "name",
      });
    }
  }

  // Names are unique per user regardless of case. Two such tags in one file
  // could never have been exported together, and the restore could not keep
  // both (the unique index on lower(name) would roll it back), so say so here.
  const duplicateNames = duplicateTagNames(tagRows.map((r) => r.name as string));
  if (duplicateNames.length > 0) {
    return fail("DUPLICATE_TAG_NAME", "Backup has tags whose names differ only in case.", {
      table: "tags",
      duplicateNames,
    });
  }

  // `snapshot_items.tag_ids` is optional (absent in a file from before B1b) and
  // nullable ("not recorded"). When present it must be an array of strings. An
  // element that names no tag in the file is NOT an error: it is a tag deleted
  // after the snapshot was taken, and `prepareImport` drops and counts it.
  const itemRows = normalised.snapshot_items as Record<string, unknown>[];
  for (let i = 0; i < itemRows.length; i++) {
    const tagIds = itemRows[i].tag_ids;
    if (tagIds === undefined || tagIds === null) continue;
    if (!Array.isArray(tagIds) || !tagIds.every((id) => typeof id === "string")) {
      return fail("INVALID_ROW", `Row ${i} in \`snapshot_items\` has an invalid \`tag_ids\`.`, {
        table: "snapshot_items",
        index: i,
        field: "tag_ids",
      });
    }
  }

  // Every asset↔tag link must point at an asset AND a tag carried in this file,
  // for the same reason as allocation targets above: an original id can still
  // exist in the database in merge mode and would be silently accepted.
  const fileTagIds = new Set<unknown>(tagRows.map((r) => r.id).filter((id) => typeof id === "string"));
  const orphanAssetTags: { index: number; missing: ("asset_id" | "tag_id")[] }[] = [];
  (normalised.asset_tags as Record<string, unknown>[]).forEach((row, index) => {
    const missing: ("asset_id" | "tag_id")[] = [];
    if (!fileAssetIds.has(row.asset_id)) missing.push("asset_id");
    if (!fileTagIds.has(row.tag_id)) missing.push("tag_id");
    if (missing.length > 0) orphanAssetTags.push({ index, missing });
  });
  if (orphanAssetTags.length > 0) {
    return fail("ORPHAN_ASSET_TAG", "Backup has asset tags whose asset or tag is not in the file.", {
      table: "asset_tags",
      orphanAssetTags,
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
  allocation_cards: Record<string, unknown>[];
  allocation_targets: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  asset_tags: Record<string, unknown>[];
}

/**
 * Transform validated data into an RPC-ready, internally-consistent payload:
 * drop ownership fields (`user_id`) and auto-generated `id`s, regenerate each
 * parent id (`snapshots`, `assets`, `allocation_cards`, `tags`), and remap every
 * child FK (`snapshot_items.snapshot_id`, `allocation_targets.asset_id`/`card_id`,
 * `asset_tags.asset_id`/`tag_id`) to its new parent. `newId` is injected for deterministic tests (no `crypto.randomUUID()`
 * here). `user_preferences` stays keyed on the user (the RPC upserts it and
 * stamps `user_id` itself), so its `user_id` is dropped too.
 */
export function prepareForImport(data: BackupData, newId: () => string): PreparedBackup {
  return prepareImport(data, newId).payload;
}

export interface PreparedImport {
  /** The RPC-ready payload (exactly what `prepareForImport` returns). */
  payload: PreparedBackup;
  /**
   * How many `snapshot_items.tag_ids` elements were dropped because their tag is
   * not in the file. That is the one legitimate dangling tag id: a tag deleted
   * after the snapshot was taken (an array carries no foreign key, so the id
   * outlives its tag). The import result reports this count.
   */
  droppedTagIds: number;
}

/**
 * `prepareForImport`, plus the count of dropped `tag_ids` elements. Each
 * `snapshot_items.tag_ids` element is remapped through the tag id map, in
 * order; an element missing from the map is dropped and counted. NULL stays
 * NULL and an absent key stays absent (both mean "not recorded"); `[]` stays
 * `[]`. The RPC then resolves each remaining id by its tag's name, so a tag
 * merged into an existing one in merge mode is followed (see the migration).
 */
export function prepareImport(data: BackupData, newId: () => string): PreparedImport {
  const user_preferences = data.user_preferences.map((r) => omit(r as Record<string, unknown>, ["user_id"]));

  // Assets get a fresh id (inserted as-is by the RPC) so allocation targets can
  // be remapped to them. An asset row with no id in the file still gets one; it
  // simply cannot be referenced by a target (validation rejects that case).
  const assetIdMap = new Map<string, string>();
  const assets = data.assets.map((r) => {
    const row = r as Record<string, unknown>;
    const fresh = newId();
    if (typeof row.id === "string") assetIdMap.set(row.id, fresh);
    return { ...omit(row, ["user_id"]), id: fresh };
  });

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

  const cardIdMap = new Map<string, string>();
  const allocation_cards = data.allocation_cards.map((r) => {
    const row = r as Record<string, unknown>;
    const fresh = newId();
    if (typeof row.id === "string") cardIdMap.set(row.id, fresh);
    return { ...omit(row, ["user_id"]), id: fresh };
  });

  // Targets have no children, so they only shed ownership and their own id
  // (the RPC lets it default), and both parent references are remapped.
  // `validateEnvelope` has already rejected any target whose asset or card is
  // not in the file; the `??` fallback is only a backstop for callers that skip
  // validation, and an unmapped id then meets the FK instead of vanishing.
  const allocation_targets = data.allocation_targets.map((r) => {
    const row = omit(r, ["id", "user_id"]);
    const oldAssetId = row.asset_id as string;
    const oldCardId = row.card_id as string;
    return {
      ...row,
      asset_id: assetIdMap.get(oldAssetId) ?? oldAssetId,
      card_id: cardIdMap.get(oldCardId) ?? oldCardId,
    };
  });

  // Tags get a fresh id so the links can be remapped to it. In merge mode the
  // RPC may fold a tag into the user's existing one of the same name; it then
  // resolves the link through this fresh id to that tag (see the migration).
  const tagIdMap = new Map<string, string>();
  const tags = data.tags.map((r) => {
    const row = r as Record<string, unknown>;
    const fresh = newId();
    if (typeof row.id === "string") tagIdMap.set(row.id, fresh);
    return { ...omit(row, ["user_id"]), id: fresh };
  });

  // Links have no id and no children: shed ownership, remap both halves. The
  // `??` fallback is the same backstop as for allocation targets.
  const asset_tags = data.asset_tags.map((r) => {
    const row = omit(r, ["user_id"]);
    const oldAssetId = row.asset_id as string;
    const oldTagId = row.tag_id as string;
    return {
      ...row,
      asset_id: assetIdMap.get(oldAssetId) ?? oldAssetId,
      tag_id: tagIdMap.get(oldTagId) ?? oldTagId,
    };
  });

  // tag_ids are remapped after the tags have their fresh ids. A post-pass, so
  // the order in which `newId` is called (parents first) is unchanged.
  let droppedTagIds = 0;
  const remappedItems = snapshot_items.map((item): Record<string, unknown> => {
    const tagIds = (item as Record<string, unknown>).tag_ids;
    if (!Array.isArray(tagIds)) return item;
    const kept: string[] = [];
    for (const oldTagId of tagIds as string[]) {
      const fresh = tagIdMap.get(oldTagId);
      if (fresh === undefined) droppedTagIds++;
      else kept.push(fresh);
    }
    return { ...item, tag_ids: kept };
  });

  const payload: PreparedBackup = {
    user_preferences,
    assets,
    snapshots,
    snapshot_items: remappedItems,
    goals,
    allocation_cards,
    allocation_targets,
    tags,
    asset_tags,
  };
  return { payload, droppedTagIds };
}
