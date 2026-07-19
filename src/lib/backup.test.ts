import { describe, expect, it } from "vitest";
import type { BackupInput } from "@/lib/backup";
import {
  CURRENT_SCHEMA_VERSION,
  prepareForImport,
  serialize,
  USER_PREFERENCES_COLUMNS,
  ASSETS_COLUMNS,
  SNAPSHOTS_COLUMNS,
  SNAPSHOT_ITEMS_COLUMNS,
  validateEnvelope,
} from "@/lib/backup";

// The pure backup module is where the risky logic (versioning, whitelisting,
// UUID remapping) lives, so every branch is pinned here. Fixtures are built
// from first principles, not by mirroring the implementation.

const ISO = "2026-06-20T18:38:00.123456+00:00";
const VALID_CATEGORIES = new Set(["cat-cash", "cat-stocks", "cat-debt"]);

function makeInput(): BackupInput {
  return {
    user_preferences: [
      {
        user_id: "user-1",
        display_currency: "USD",
        theme: "dark",
        fire_annual_expenses: 40000,
        fire_annual_income: 90000,
        fire_barista_income: 20000,
        fire_current_age: 30,
        fire_expected_return: 7,
        fire_inflation_rate: 3,
        fire_safe_withdrawal_rate: 4,
        fire_starting_principal_override: null,
        fire_traditional_retirement_age: 65,
        show_fire_dashboard: true,
        show_drift_alerts: true,
        show_trajectory: true,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    assets: [
      {
        id: "asset-1",
        user_id: "user-1",
        category_id: "cat-cash",
        name: "Checking",
        amount: 1500,
        currency: "USD",
        crypto_symbol: null,
        metal_symbol: null,
        notes: null,
        quantity: null,
        show_on_chart: true,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    snapshots: [
      {
        id: "snap-1",
        user_id: "user-1",
        total_net_worth: 1500,
        display_currency: "USD",
        base_currency: "USD",
        source: "manual",
        note: null,
        net_contribution: null,
        created_at: ISO,
      },
      {
        id: "snap-2",
        user_id: "user-1",
        total_net_worth: 1800,
        display_currency: "USD",
        base_currency: "USD",
        source: "manual",
        note: null,
        net_contribution: null,
        created_at: ISO,
      },
    ],
    snapshot_items: [
      {
        id: "item-1",
        snapshot_id: "snap-1",
        category_id: "cat-cash",
        name: "Checking",
        original_amount: 1500,
        original_currency: "USD",
        converted_amount: 1500,
        display_currency: "USD",
        display_order: 0,
        exchange_rate_usd: 1,
        created_at: ISO,
      },
      {
        id: "item-2",
        snapshot_id: "snap-2",
        category_id: "cat-stocks",
        name: "Brokerage",
        original_amount: 1800,
        original_currency: "USD",
        converted_amount: 1800,
        display_currency: "USD",
        display_order: 1,
        exchange_rate_usd: 1,
        created_at: ISO,
      },
    ],
  };
}

describe("serialize", () => {
  it("stamps the current version + app marker and includes every whitelisted column", () => {
    const env = serialize(makeInput(), ISO);
    expect(env.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(env.app).toBe("bitworth");
    expect(env.exportedAt).toBe(ISO);

    // Whitelist must carry the easy-to-drop fields.
    const pref = env.data.user_preferences[0] as Record<string, unknown>;
    for (const col of USER_PREFERENCES_COLUMNS) expect(pref).toHaveProperty(col);
    expect(USER_PREFERENCES_COLUMNS.filter((c) => c.startsWith("fire_"))).toHaveLength(9);

    const asset = env.data.assets[0] as Record<string, unknown>;
    expect(asset).toHaveProperty("quantity");
    expect(asset).toHaveProperty("show_on_chart");
    expect(asset).toHaveProperty("created_at");
    expect(asset).toHaveProperty("updated_at");
  });

  it("strips columns not on the whitelist", () => {
    const input = makeInput();
    (input.assets[0] as Record<string, unknown>).secret_extra = "leak";
    const env = serialize(input, ISO);
    expect(env.data.assets[0]).not.toHaveProperty("secret_extra");
  });
});

describe("validateEnvelope", () => {
  it("accepts a freshly serialized envelope (round-trip)", () => {
    const env = serialize(makeInput(), ISO);
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object / non-bitworth file", () => {
    expect(validateEnvelope(null, VALID_CATEGORIES).ok).toBe(false);
    expect(validateEnvelope({ app: "other", schemaVersion: 1, data: {} }, VALID_CATEGORIES).ok).toBe(false);
  });

  it("rejects a newer schemaVersion but accepts an equal/older one", () => {
    const env = serialize(makeInput(), ISO);

    const newer = { ...env, schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    const newerResult = validateEnvelope(newer, VALID_CATEGORIES);
    expect(newerResult.ok).toBe(false);
    if (!newerResult.ok) expect(newerResult.code).toBe("UNSUPPORTED_VERSION");

    const older = { ...env, schemaVersion: CURRENT_SCHEMA_VERSION };
    expect(validateEnvelope(older, VALID_CATEGORIES).ok).toBe(true);
  });

  it("rejects a non-integer schemaVersion", () => {
    const env = serialize(makeInput(), ISO);
    expect(validateEnvelope({ ...env, schemaVersion: 1.5 }, VALID_CATEGORIES).ok).toBe(false);
    expect(validateEnvelope({ ...env, schemaVersion: "1" }, VALID_CATEGORIES).ok).toBe(false);
  });

  it("rejects a row missing a required NOT-NULL field", () => {
    const env = serialize(makeInput(), ISO);
    delete (env.data.assets[0] as Record<string, unknown>).amount;
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ROW");
      expect(result.context).toMatchObject({ table: "assets", field: "amount" });
    }
  });

  it("rejects a non-ISO timestamp", () => {
    const env = serialize(makeInput(), ISO);
    (env.data.snapshots[0] as Record<string, unknown>).created_at = "not-a-date";
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_ROW");
  });

  it("rejects unknown category ids and lists every offender in context", () => {
    const env = serialize(makeInput(), ISO);
    (env.data.assets[0] as Record<string, unknown>).category_id = "cat-bogus";
    (env.data.snapshot_items[1] as Record<string, unknown>).category_id = "cat-also-bogus";
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNKNOWN_CATEGORY");
      expect((result.context as { unknownCategoryIds: string[] }).unknownCategoryIds).toEqual(
        expect.arrayContaining(["cat-bogus", "cat-also-bogus"]),
      );
    }
  });

  it("rejects when a table array is missing", () => {
    const env = serialize(makeInput(), ISO);
    const broken = { ...env, data: { ...env.data, snapshots: undefined } };
    expect(validateEnvelope(broken, VALID_CATEGORIES).ok).toBe(false);
  });
});

describe("prepareForImport", () => {
  it("drops ownership fields, regenerates parent ids, and remaps every child FK deterministically", () => {
    const env = serialize(makeInput(), ISO);
    const validated = validateEnvelope(env, VALID_CATEGORIES);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    let counter = 0;
    const newId = () => `new-${++counter}`;
    const prepared = prepareForImport(validated.data, newId);

    // user_preferences keeps everything except user_id (RPC stamps it).
    expect(prepared.user_preferences[0]).not.toHaveProperty("user_id");
    expect(prepared.user_preferences[0]).toHaveProperty("display_currency", "USD");

    // assets drop both id and user_id.
    expect(prepared.assets[0]).not.toHaveProperty("id");
    expect(prepared.assets[0]).not.toHaveProperty("user_id");
    expect(prepared.assets[0]).toHaveProperty("amount", 1500);

    // snapshots get fresh ids in order; user_id dropped.
    expect(prepared.snapshots[0].id).toBe("new-1");
    expect(prepared.snapshots[1].id).toBe("new-2");
    expect(prepared.snapshots[0]).not.toHaveProperty("user_id");

    // every snapshot_item.snapshot_id is remapped to its new parent; id dropped.
    expect(prepared.snapshot_items[0]).not.toHaveProperty("id");
    expect(prepared.snapshot_items[0].snapshot_id).toBe("new-1");
    expect(prepared.snapshot_items[1].snapshot_id).toBe("new-2");
  });

  it("emits only whitelisted columns (minus dropped id/user_id)", () => {
    const env = serialize(makeInput(), ISO);
    const validated = validateEnvelope(env, VALID_CATEGORIES);
    if (!validated.ok) throw new Error("fixture should validate");

    const prepared = prepareForImport(validated.data, () => "x");

    const assetKeys = Object.keys(prepared.assets[0]).sort();
    const expectedAssetKeys = ASSETS_COLUMNS.filter((c) => c !== "id" && c !== "user_id")
      .slice()
      .sort();
    expect(assetKeys).toEqual(expectedAssetKeys);

    const snapKeys = Object.keys(prepared.snapshots[0]).sort();
    const expectedSnapKeys = SNAPSHOTS_COLUMNS.filter((c) => c !== "user_id")
      .slice()
      .sort();
    expect(snapKeys).toEqual(expectedSnapKeys);

    const itemKeys = Object.keys(prepared.snapshot_items[0]).sort();
    const expectedItemKeys = SNAPSHOT_ITEMS_COLUMNS.filter((c) => c !== "id")
      .slice()
      .sort();
    expect(itemKeys).toEqual(expectedItemKeys);
  });
});
