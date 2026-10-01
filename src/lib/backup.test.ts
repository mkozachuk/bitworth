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
  GOALS_COLUMNS,
  ALLOCATION_CARDS_COLUMNS,
  ALLOCATION_TARGETS_COLUMNS,
  TAGS_COLUMNS,
  ASSET_TAGS_COLUMNS,
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
        show_goals: true,
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
        sort_order: 3,
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
    goals: [
      {
        id: "goal-1",
        user_id: "user-1",
        name: "Reach 1M",
        kind: "net_worth",
        category_id: null,
        target_amount: 1000000,
        target_currency: "USD",
        target_date: null,
        created_at: ISO,
        updated_at: ISO,
      },
      {
        id: "goal-2",
        user_id: "user-1",
        name: "Emergency fund",
        kind: "category",
        category_id: "cat-cash",
        target_amount: 50000,
        target_currency: "EUR",
        // A DATE column, not a timestamptz — deliberately not `T`-separated, to
        // pin that `target_date` is NOT validated as an ISO-8601 timestamp.
        target_date: "2027-12-31",
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    allocation_cards: [
      {
        id: "card-1",
        user_id: "user-1",
        name: "Core",
        position: 0,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    allocation_targets: [
      {
        id: "target-1",
        user_id: "user-1",
        card_id: "card-1",
        asset_id: "asset-1",
        target_pct: 60,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    tags: [
      {
        id: "tag-1",
        user_id: "user-1",
        name: "Long term",
        show_on_dashboard: true,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    asset_tags: [
      {
        asset_id: "asset-1",
        tag_id: "tag-1",
        user_id: "user-1",
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
    // The user's custom list order must reach the file with its VALUE intact —
    // a whitelist entry that serialized as `undefined` would round-trip the
    // column away just as thoroughly as omitting it.
    expect(asset).toHaveProperty("sort_order", 3);
    expect(asset).toHaveProperty("created_at");
    expect(asset).toHaveProperty("updated_at");

    const goal = env.data.goals[0] as Record<string, unknown>;
    for (const col of GOALS_COLUMNS) expect(goal).toHaveProperty(col);
    expect(env.data.goals).toHaveLength(2);
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

  it("accepts a schemaVersion 1 envelope with no `goals` key and normalises it to []", () => {
    // The backwards-compatibility contract: every file exported before goals
    // existed must still import. Built by hand rather than by deleting a key
    // from a fresh envelope, so it is a genuine v1 shape.
    const legacy = {
      app: "bitworth",
      schemaVersion: 1,
      exportedAt: ISO,
      data: {
        user_preferences: [],
        assets: [],
        snapshots: [],
        snapshot_items: [],
      },
    };
    const result = validateEnvelope(legacy, VALID_CATEGORIES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.goals).toEqual([]);

    // …and it survives the rest of the pipeline, not just validation.
    expect(prepareForImport(result.data, () => "x").goals).toEqual([]);
  });

  it("accepts an asset row with no `sort_order` key (pre-S-25 file)", () => {
    // sort_order joined the assets whitelist WITHOUT a CURRENT_SCHEMA_VERSION
    // bump, because the column has a DB default — so a file exported before it
    // existed carries the current version number and simply lacks the key. It
    // must stay valid: it is deliberately absent from REQUIRED_FIELDS. The RPC
    // COALESCEs the missing value to 0, and the `created_at DESC` tiebreak on
    // both ordered reads then reproduces the pre-S-25 order.
    const env = serialize(makeInput(), ISO);
    const assets = env.data.assets.map((a) => {
      const { sort_order: _sort_order, ...rest } = a as Record<string, unknown>;
      return rest;
    });
    const legacy = { ...env, data: { ...env.data, assets } };

    const result = validateEnvelope(legacy, VALID_CATEGORIES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.assets[0]).not.toHaveProperty("sort_order");
    // …and it survives the rest of the pipeline, not just validation.
    expect(prepareForImport(result.data, () => "x").assets[0]).not.toHaveProperty("sort_order");
  });

  it("rejects a `goals` key that is present but not an array", () => {
    const env = serialize(makeInput(), ISO);
    const broken = { ...env, data: { ...env.data, goals: "nope" } };
    const result = validateEnvelope(broken, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ENVELOPE");
      expect(result.context).toMatchObject({ table: "goals" });
    }
  });

  it("rejects a goal missing a required NOT-NULL field", () => {
    const env = serialize(makeInput(), ISO);
    delete (env.data.goals[0] as Record<string, unknown>).target_currency;
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ROW");
      expect(result.context).toMatchObject({ table: "goals", field: "target_currency" });
    }
  });

  it("accepts a goal's non-timestamp `target_date` but rejects a bad `created_at`", () => {
    // `target_date` is a DATE ("2027-12-31"): no `T` separator, so validating it
    // as an ISO-8601 timestamp would reject every dated goal.
    expect(validateEnvelope(serialize(makeInput(), ISO), VALID_CATEGORIES).ok).toBe(true);

    const env = serialize(makeInput(), ISO);
    (env.data.goals[0] as Record<string, unknown>).created_at = "2027-12-31";
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_ROW");
  });

  it("rejects an unknown category id on a goal before any write", () => {
    const env = serialize(makeInput(), ISO);
    (env.data.goals[1] as Record<string, unknown>).category_id = "cat-vanished";
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNKNOWN_CATEGORY");
      expect((result.context as { unknownCategoryIds: string[] }).unknownCategoryIds).toContain("cat-vanished");
    }
  });

  it("accepts a net-worth goal's null category_id", () => {
    const env = serialize(makeInput(), ISO);
    expect((env.data.goals[0] as Record<string, unknown>).category_id).toBeNull();
    expect(validateEnvelope(env, VALID_CATEGORIES).ok).toBe(true);
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

    // assets get a fresh id (allocation targets are remapped to it); user_id
    // dropped.
    expect(prepared.assets[0].id).toBe("new-1");
    expect(prepared.assets[0]).not.toHaveProperty("user_id");
    expect(prepared.assets[0]).toHaveProperty("amount", 1500);

    // snapshots get fresh ids in order; user_id dropped.
    expect(prepared.snapshots[0].id).toBe("new-2");
    expect(prepared.snapshots[1].id).toBe("new-3");
    expect(prepared.snapshots[0]).not.toHaveProperty("user_id");

    // every snapshot_item.snapshot_id is remapped to its new parent; id dropped.
    expect(prepared.snapshot_items[0]).not.toHaveProperty("id");
    expect(prepared.snapshot_items[0].snapshot_id).toBe("new-2");
    expect(prepared.snapshot_items[1].snapshot_id).toBe("new-3");

    // cards get a fresh id; targets drop id/user_id and point at both new parents.
    expect(prepared.allocation_cards[0].id).toBe("new-4");
    expect(prepared.allocation_cards[0]).not.toHaveProperty("user_id");
    expect(prepared.allocation_targets[0]).not.toHaveProperty("id");
    expect(prepared.allocation_targets[0]).not.toHaveProperty("user_id");
    expect(prepared.allocation_targets[0].asset_id).toBe("new-1");
    expect(prepared.allocation_targets[0].card_id).toBe("new-4");

    // goals drop both id and user_id — the RPC stamps ownership and lets the
    // primary key default — but keep every other field.
    expect(prepared.goals[0]).not.toHaveProperty("id");
    expect(prepared.goals[0]).not.toHaveProperty("user_id");
    expect(prepared.goals[0]).toHaveProperty("target_amount", 1000000);
    expect(prepared.goals[1]).toHaveProperty("category_id", "cat-cash");
    expect(prepared.goals[1]).toHaveProperty("target_date", "2027-12-31");
  });

  it("emits only whitelisted columns (minus dropped id/user_id)", () => {
    const env = serialize(makeInput(), ISO);
    const validated = validateEnvelope(env, VALID_CATEGORIES);
    if (!validated.ok) throw new Error("fixture should validate");

    const prepared = prepareForImport(validated.data, () => "x");

    const assetKeys = Object.keys(prepared.assets[0]).sort();
    const expectedAssetKeys = ASSETS_COLUMNS.filter((c) => c !== "user_id")
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

    const goalKeys = Object.keys(prepared.goals[0]).sort();
    const expectedGoalKeys = GOALS_COLUMNS.filter((c) => c !== "id" && c !== "user_id")
      .slice()
      .sort();
    expect(goalKeys).toEqual(expectedGoalKeys);

    const cardKeys = Object.keys(prepared.allocation_cards[0]).sort();
    expect(cardKeys).toEqual(ALLOCATION_CARDS_COLUMNS.filter((c) => c !== "user_id").sort());

    const targetKeys = Object.keys(prepared.allocation_targets[0]).sort();
    expect(targetKeys).toEqual(ALLOCATION_TARGETS_COLUMNS.filter((c) => c !== "id" && c !== "user_id").sort());
  });
});

describe("snapshots.net_contribution round-trip", () => {
  it("export carries a recorded net_contribution into the envelope", () => {
    const input = makeInput();
    input.snapshots[0] = { ...input.snapshots[0], net_contribution: 1234.5 };
    const env = serialize(input, ISO);
    expect(env.data.snapshots[0]).toHaveProperty("net_contribution", 1234.5);
    // ...and it survives the JSON file and the import transform.
    const validated = validateEnvelope(JSON.parse(JSON.stringify(env)), VALID_CATEGORIES);
    if (!validated.ok) throw new Error("fixture should validate");
    const prepared = prepareForImport(validated.data, () => "fresh");
    expect(prepared.snapshots[0]).toHaveProperty("net_contribution", 1234.5);
  });

  it("export keeps an explicit null as null (not 0, not dropped)", () => {
    const env = serialize(makeInput(), ISO);
    expect(env.data.snapshots[0]).toHaveProperty("net_contribution", null);
  });

  it("an old backup with no net_contribution key validates and prepares unchanged", () => {
    const env = serialize(makeInput(), ISO);
    interface OldEnvelope {
      data: { snapshots: Record<string, unknown>[] };
    }
    const old = JSON.parse(JSON.stringify(env)) as OldEnvelope;
    for (const snap of old.data.snapshots) delete snap.net_contribution;
    const before = JSON.parse(JSON.stringify(old)) as OldEnvelope;

    const validated = validateEnvelope(old, VALID_CATEGORIES);
    if (!validated.ok) throw new Error(`old backup should validate: ${validated.code}`);
    expect(validated.data.snapshots).toEqual(before.data.snapshots);
    for (const snap of validated.data.snapshots) expect(snap).not.toHaveProperty("net_contribution");

    // No key is invented on the way to the RPC; restore_backup maps the
    // absence to NULL (pinned in backup-rpc-parity.test.ts).
    const prepared = prepareForImport(validated.data, () => "fresh");
    for (const snap of prepared.snapshots) expect(snap).not.toHaveProperty("net_contribution");
    expect(old).toEqual(before);
  });
});

// Slice C2: the balancer (allocation cards + targets) joins the envelope in
// schemaVersion 3. Before this, neither table was exported and replace-mode
// restore cascaded every target away.
describe("allocation cards and targets (schemaVersion 3)", () => {
  function validated(env: unknown) {
    const result = validateEnvelope(env, VALID_CATEGORIES);
    if (!result.ok) throw new Error(`fixture should validate: ${result.code} ${result.message}`);
    return result.data;
  }

  it("serialize carries both tables with every whitelisted column", () => {
    const env = serialize(makeInput(), ISO);
    expect(env.schemaVersion).toBeGreaterThanOrEqual(3);
    const card = env.data.allocation_cards[0] as Record<string, unknown>;
    for (const col of ALLOCATION_CARDS_COLUMNS) expect(card).toHaveProperty(col);
    const target = env.data.allocation_targets[0] as Record<string, unknown>;
    for (const col of ALLOCATION_TARGETS_COLUMNS) expect(target).toHaveProperty(col);
    expect(target).toHaveProperty("target_pct", 60);
  });

  it("a v1 file (no goals, no allocation keys) normalises all three to []", () => {
    const v1 = {
      app: "bitworth",
      schemaVersion: 1,
      exportedAt: ISO,
      data: { user_preferences: [], assets: [], snapshots: [], snapshot_items: [] },
    };
    const data = validated(v1);
    expect(data.goals).toEqual([]);
    expect(data.allocation_cards).toEqual([]);
    expect(data.allocation_targets).toEqual([]);
    const prepared = prepareForImport(data, () => "x");
    expect(prepared.allocation_cards).toEqual([]);
    expect(prepared.allocation_targets).toEqual([]);
  });

  it("a v2 file (goals, no allocation keys) validates and normalises the allocation sections to []", () => {
    // Built from a real v3 envelope with the two keys removed, the exact shape
    // of every export made before this change (e.g. the 2026-09-27 one).
    const env = JSON.parse(JSON.stringify(serialize(makeInput(), ISO))) as {
      schemaVersion: number;
      data: Record<string, unknown>;
    };
    env.schemaVersion = 2;
    delete env.data.allocation_cards;
    delete env.data.allocation_targets;
    delete env.data.tags;
    delete env.data.asset_tags;
    const data = validated(env);
    expect(data.goals).toHaveLength(2);
    expect(data.allocation_cards).toEqual([]);
    expect(data.allocation_targets).toEqual([]);
    const prepared = prepareForImport(data, () => "x");
    expect(prepared.assets).toHaveLength(1);
    expect(prepared.allocation_cards).toEqual([]);
    expect(prepared.allocation_targets).toEqual([]);
  });

  it("a v3 file keeps its allocation sections through validation", () => {
    const data = validated(JSON.parse(JSON.stringify(serialize(makeInput(), ISO))));
    expect(data.allocation_cards).toHaveLength(1);
    expect(data.allocation_targets).toHaveLength(1);
    expect(data.allocation_targets[0]).toMatchObject({ card_id: "card-1", asset_id: "asset-1", target_pct: 60 });
  });

  it.each(["allocation_cards", "allocation_targets"])(
    "rejects a `%s` key that is present but not an array",
    (table) => {
      const env = serialize(makeInput(), ISO);
      const result = validateEnvelope({ ...env, data: { ...env.data, [table]: {} } }, VALID_CATEGORIES);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_ENVELOPE");
        expect(result.context).toMatchObject({ table });
      }
    },
  );

  it("rejects a target missing target_pct", () => {
    const env = serialize(makeInput(), ISO);
    delete (env.data.allocation_targets[0] as Record<string, unknown>).target_pct;
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.context).toMatchObject({ table: "allocation_targets", field: "target_pct" });
  });

  it("rejects a target whose asset is not in the file, by name, instead of dropping it", () => {
    const env = serialize(makeInput(), ISO);
    (env.data.allocation_targets[0] as Record<string, unknown>).asset_id = "asset-not-in-file";
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ORPHAN_ALLOCATION_TARGET");
    expect(result.context).toEqual({
      table: "allocation_targets",
      orphanTargets: [{ index: 0, missing: ["asset_id"] }],
    });
  });

  it("rejects a target whose card is not in the file, and names both missing parents when both are", () => {
    const env = serialize(makeInput(), ISO);
    const second = { ...env.data.allocation_targets[0], card_id: "card-gone", asset_id: "asset-gone" };
    (env.data.allocation_targets[0] as Record<string, unknown>).card_id = "card-gone";
    env.data.allocation_targets.push(second);
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ORPHAN_ALLOCATION_TARGET");
    expect(result.context).toEqual({
      table: "allocation_targets",
      orphanTargets: [
        { index: 0, missing: ["card_id"] },
        { index: 1, missing: ["asset_id", "card_id"] },
      ],
    });
  });

  it("prepareForImport remaps every target to the fresh asset and card ids (the same asset in two cards)", () => {
    const input = makeInput();
    input.assets.push({ ...input.assets[0], id: "asset-2", name: "Brokerage", category_id: "cat-stocks" });
    input.allocation_cards.push({ ...input.allocation_cards[0], id: "card-2", name: "Satellite", position: 1 });
    input.allocation_targets = [
      { ...input.allocation_targets[0], id: "t-1", card_id: "card-1", asset_id: "asset-1", target_pct: 60 },
      { ...input.allocation_targets[0], id: "t-2", card_id: "card-1", asset_id: "asset-2", target_pct: 40 },
      { ...input.allocation_targets[0], id: "t-3", card_id: "card-2", asset_id: "asset-2", target_pct: 100 },
    ];
    let n = 0;
    const prepared = prepareForImport(validated(serialize(input, ISO)), () => `id-${++n}`);

    // Assets are mapped first, then snapshots (2), then cards.
    expect(prepared.assets.map((a) => a.id)).toEqual(["id-1", "id-2"]);
    expect(prepared.allocation_cards.map((c) => c.id)).toEqual(["id-5", "id-6"]);
    expect(prepared.allocation_targets.map((t) => [t.card_id, t.asset_id, t.target_pct])).toEqual([
      ["id-5", "id-1", 60],
      ["id-5", "id-2", 40],
      ["id-6", "id-2", 100],
    ]);
    // No original id survives anywhere in the balancer payload.
    const payload = JSON.stringify([prepared.assets, prepared.allocation_cards, prepared.allocation_targets]);
    for (const old of ["asset-1", "asset-2", "card-1", "card-2", "t-1", "t-2", "t-3"]) {
      expect(payload).not.toContain(`"${old}"`);
    }
  });

  it("round trip: 2 assets, 1 card, 2 targets → each target points at the new id of the same asset", () => {
    const input = makeInput();
    input.assets = [
      { ...input.assets[0], id: "a-cash", name: "Checking" },
      { ...input.assets[0], id: "a-etf", name: "World ETF", category_id: "cat-stocks" },
    ];
    input.allocation_cards = [{ ...input.allocation_cards[0], id: "c-core" }];
    // The fixture's one tag link points at the asset this test replaces.
    input.asset_tags = [];
    input.allocation_targets = [
      { ...input.allocation_targets[0], id: "t-cash", card_id: "c-core", asset_id: "a-cash", target_pct: 12.5 },
      { ...input.allocation_targets[0], id: "t-etf", card_id: "c-core", asset_id: "a-etf", target_pct: 87.5 },
    ];
    const originalAssetName = new Map(input.assets.map((a) => [a.id, a.name]));

    const file = JSON.parse(JSON.stringify(serialize(input, ISO))) as unknown;
    let n = 0;
    const prepared = prepareForImport(
      validated(file),
      () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    );

    const newAssetName = new Map(prepared.assets.map((a) => [a.id as string, a.name as string]));
    expect(prepared.allocation_targets).toHaveLength(2);
    input.allocation_targets.forEach((before, i) => {
      const after = prepared.allocation_targets[i];
      expect(after.asset_id).not.toBe(before.asset_id);
      expect(newAssetName.get(after.asset_id as string)).toBe(originalAssetName.get(before.asset_id));
      expect(after.card_id).toBe(prepared.allocation_cards[0].id);
      expect(after.target_pct).toBe(before.target_pct);
    });
  });
});

// Slice B1a: asset tags join the envelope in schemaVersion 4.
describe("asset tags (schemaVersion 4)", () => {
  function validated(env: unknown) {
    const result = validateEnvelope(env, VALID_CATEGORIES);
    if (!result.ok) throw new Error(`fixture should validate: ${result.code} ${result.message}`);
    return result.data;
  }

  function fileOf(input: BackupInput): { schemaVersion: number; data: Record<string, unknown[] | undefined> } {
    return JSON.parse(JSON.stringify(serialize(input, ISO))) as {
      schemaVersion: number;
      data: Record<string, unknown[] | undefined>;
    };
  }

  it("serialize carries both tables with every whitelisted column, at schemaVersion 4", () => {
    const env = serialize(makeInput(), ISO);
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
    expect(env.schemaVersion).toBe(4);
    const tag = env.data.tags[0] as Record<string, unknown>;
    for (const col of TAGS_COLUMNS) expect(tag).toHaveProperty(col);
    expect(tag).toHaveProperty("show_on_dashboard", true);
    const link = env.data.asset_tags[0] as Record<string, unknown>;
    for (const col of ASSET_TAGS_COLUMNS) expect(link).toHaveProperty(col);
  });

  it.each([1, 2, 3])("a v%i file (no tag keys) validates and normalises both tag sections to []", (version) => {
    const env = fileOf(makeInput());
    env.schemaVersion = version;
    delete env.data.tags;
    delete env.data.asset_tags;
    if (version < 3) {
      delete env.data.allocation_cards;
      delete env.data.allocation_targets;
    }
    if (version < 2) delete env.data.goals;
    const data = validated(env);
    expect(data.tags).toEqual([]);
    expect(data.asset_tags).toEqual([]);
    expect(data.assets).toHaveLength(1);
    const prepared = prepareForImport(data, () => "x");
    expect(prepared.tags).toEqual([]);
    expect(prepared.asset_tags).toEqual([]);
  });

  it.each(["tags", "asset_tags"])("rejects a `%s` key that is present but not an array", (table) => {
    const env = serialize(makeInput(), ISO);
    const result = validateEnvelope({ ...env, data: { ...env.data, [table]: {} } }, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ENVELOPE");
      expect(result.context).toMatchObject({ table });
    }
  });

  it.each([
    ["tags", "name"],
    ["asset_tags", "asset_id"],
    ["asset_tags", "tag_id"],
  ])("rejects a %s row missing %s", (table, field) => {
    const env = fileOf(makeInput());
    const rows = env.data[table] as Record<string, unknown>[];
    rows[0] = Object.fromEntries(Object.entries(rows[0]).filter(([key]) => key !== field));
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.context).toMatchObject({ table, index: 0, field });
  });

  it.each([
    ["empty", ""],
    ["untrimmed", " Long term"],
    ["33 characters", "x".repeat(33)],
    ["not a string", 7],
  ])("rejects a tag whose name is %s", (_label, name) => {
    const env = fileOf(makeInput());
    (env.data.tags as Record<string, unknown>[])[0].name = name;
    const result = validateEnvelope(env, VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ROW");
      expect(result.context).toEqual({ table: "tags", index: 0, field: "name" });
    }
  });

  it("rejects two tags whose names differ only in case, naming them", () => {
    const input = makeInput();
    input.tags.push({ ...input.tags[0], id: "tag-2", name: "LONG TERM" });
    const result = validateEnvelope(fileOf(input), VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DUPLICATE_TAG_NAME");
    expect(result.context).toEqual({ table: "tags", duplicateNames: ["Long term"] });
  });

  it("rejects links whose asset or tag is not in the file, by name, and lists every offender", () => {
    const input = makeInput();
    input.asset_tags = [
      { ...input.asset_tags[0], asset_id: "asset-gone" },
      { ...input.asset_tags[0], tag_id: "tag-gone" },
      { ...input.asset_tags[0], asset_id: "asset-gone", tag_id: "tag-gone" },
      { ...input.asset_tags[0] },
    ];
    const result = validateEnvelope(fileOf(input), VALID_CATEGORIES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ORPHAN_ASSET_TAG");
    expect(result.context).toEqual({
      table: "asset_tags",
      orphanAssetTags: [
        { index: 0, missing: ["asset_id"] },
        { index: 1, missing: ["tag_id"] },
        { index: 2, missing: ["asset_id", "tag_id"] },
      ],
    });
  });

  // The import remap, table-tested (T5). Every case carries two assets. Fresh
  // ids are handed out in order: assets (id-1, id-2), snapshots (id-3, id-4),
  // the card (id-5), then tags from id-6.
  const remapCases: {
    label: string;
    tags: { id: string; name: string }[];
    links: [string, string][];
    expected: [string, string][];
  }[] = [
    { label: "no tags, no links", tags: [], links: [], expected: [] },
    {
      label: "one asset with one tag",
      tags: [{ id: "t-a", name: "A" }],
      links: [["asset-1", "t-a"]],
      expected: [["id-1", "id-6"]],
    },
    {
      label: "one asset with two tags",
      tags: [
        { id: "t-a", name: "A" },
        { id: "t-b", name: "B" },
      ],
      links: [
        ["asset-1", "t-a"],
        ["asset-1", "t-b"],
      ],
      expected: [
        ["id-1", "id-6"],
        ["id-1", "id-7"],
      ],
    },
    {
      label: "one tag on two assets",
      tags: [{ id: "t-a", name: "A" }],
      links: [
        ["asset-1", "t-a"],
        ["asset-2", "t-a"],
      ],
      expected: [
        ["id-1", "id-6"],
        ["id-2", "id-6"],
      ],
    },
    {
      label: "links listed out of order keep their order",
      tags: [
        { id: "t-a", name: "A" },
        { id: "t-b", name: "B" },
      ],
      links: [
        ["asset-2", "t-b"],
        ["asset-1", "t-a"],
      ],
      expected: [
        ["id-2", "id-7"],
        ["id-1", "id-6"],
      ],
    },
    {
      label: "a tag with no links still gets a fresh id",
      tags: [
        { id: "t-a", name: "A" },
        { id: "t-unused", name: "Unused" },
      ],
      links: [["asset-1", "t-a"]],
      expected: [["id-1", "id-6"]],
    },
  ];

  it.each(remapCases)("prepareForImport remaps links: $label", ({ tags, links, expected }) => {
    const input = makeInput();
    input.assets.push({ ...input.assets[0], id: "asset-2", name: "Brokerage" });
    input.tags = tags.map((t) => ({ ...input.tags[0], ...t }));
    input.asset_tags = links.map(([asset_id, tag_id]) => ({ ...input.asset_tags[0], asset_id, tag_id }));
    let n = 0;
    const prepared = prepareForImport(validated(fileOf(input)), () => `id-${++n}`);

    expect(prepared.tags.map((t) => t.id)).toEqual(tags.map((_, i) => `id-${6 + i}`));
    expect(prepared.tags.map((t) => t.name)).toEqual(tags.map((t) => t.name));
    expect(prepared.asset_tags.map((l) => [l.asset_id, l.tag_id])).toEqual(expected);
    for (const tag of prepared.tags) expect(tag).not.toHaveProperty("user_id");
    for (const link of prepared.asset_tags) {
      expect(Object.keys(link).sort()).toEqual(ASSET_TAGS_COLUMNS.filter((c) => c !== "user_id").sort());
    }
    // No original id survives anywhere in the tag payload.
    const payload = JSON.stringify([prepared.tags, prepared.asset_tags]);
    for (const old of ["asset-1", "asset-2", ...tags.map((t) => t.id)]) expect(payload).not.toContain(`"${old}"`);
  });

  it("prepareForImport keeps show_on_dashboard and the timestamps of each tag", () => {
    const prepared = prepareForImport(validated(fileOf(makeInput())), () => "fresh");
    expect(prepared.tags).toEqual([
      { id: "fresh", name: "Long term", show_on_dashboard: true, created_at: ISO, updated_at: ISO },
    ]);
  });

  it("round trip: 2 assets, 2 tags, 3 links → each link points at the new ids of the same asset and tag", () => {
    const input = makeInput();
    input.assets = [
      { ...input.assets[0], id: "a-cash", name: "Checking" },
      { ...input.assets[0], id: "a-etf", name: "World ETF", category_id: "cat-stocks" },
    ];
    input.allocation_targets = [];
    input.tags = [
      { ...input.tags[0], id: "t-safe", name: "Safe" },
      { ...input.tags[0], id: "t-growth", name: "Growth", show_on_dashboard: false },
    ];
    input.asset_tags = [
      { ...input.asset_tags[0], asset_id: "a-cash", tag_id: "t-safe" },
      { ...input.asset_tags[0], asset_id: "a-etf", tag_id: "t-growth" },
      { ...input.asset_tags[0], asset_id: "a-etf", tag_id: "t-safe" },
    ];
    const assetName = new Map(input.assets.map((a) => [a.id, a.name]));
    const tagName = new Map(input.tags.map((t) => [t.id, t.name]));

    let n = 0;
    const prepared = prepareForImport(
      validated(fileOf(input)),
      () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    );

    const newAssetName = new Map(prepared.assets.map((a) => [a.id as string, a.name as string]));
    const newTagName = new Map(prepared.tags.map((t) => [t.id as string, t.name as string]));
    expect(prepared.asset_tags).toHaveLength(3);
    input.asset_tags.forEach((before, i) => {
      const after = prepared.asset_tags[i];
      expect(after.asset_id).not.toBe(before.asset_id);
      expect(after.tag_id).not.toBe(before.tag_id);
      expect(newAssetName.get(after.asset_id as string)).toBe(assetName.get(before.asset_id));
      expect(newTagName.get(after.tag_id as string)).toBe(tagName.get(before.tag_id));
    });
  });
});
