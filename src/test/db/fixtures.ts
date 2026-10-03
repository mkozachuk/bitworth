import type { PGlite } from "@electric-sql/pglite";
import type { BackupInput } from "@/lib/backup";

// Synthetic users and rows for the DB tests. Every value is invented.

export const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";

// Deterministic ids: `id(user, n)` keeps the two users' rows distinct and the
// failures readable.
function id(user: string, n: number): string {
  return `${user.slice(0, 8)}-1111-4111-8111-${String(n).padStart(12, "0")}`;
}

/** Tables that carry a `user_id` and are backed up. */
export const USER_TABLES = [
  "user_preferences",
  "assets",
  "snapshots",
  "goals",
  "allocation_cards",
  "allocation_targets",
  "tags",
  "asset_tags",
] as const;

/**
 * Insert a user (the on_auth_users_insert trigger creates its preferences
 * row) and a full data set: preferences, three assets, two tags with links,
 * two snapshots with items (tag_ids recorded / NULL / empty; income and
 * net_contribution set, NULL and negative), a goal per kind, and an
 * allocation card with two targets. Run as the superuser.
 */
export async function seedUser(db: PGlite, user: string, label: string): Promise<void> {
  const asset1 = id(user, 1);
  const asset2 = id(user, 2);
  const asset3 = id(user, 3);
  const tagLong = id(user, 11);
  const tagCrypto = id(user, 12);
  const snap1 = id(user, 21);
  const snap2 = id(user, 22);
  const card = id(user, 31);

  await db.query("INSERT INTO auth.users (id) VALUES ($1)", [user]);
  await db.query(
    `UPDATE user_preferences SET
       display_currency = 'EUR', theme = 'dark',
       fire_annual_expenses = 24000, fire_annual_income = 60000, fire_barista_income = 12000,
       fire_current_age = 35, fire_expected_return = 0.0650, fire_inflation_rate = 0.0250,
       fire_safe_withdrawal_rate = 0.0350, fire_starting_principal_override = 150000,
       fire_traditional_retirement_age = 67,
       show_fire_dashboard = false, show_drift_alerts = false, show_goals = true, show_trajectory = false,
       created_at = '2026-01-01T09:00:00Z', updated_at = '2026-02-01T09:00:00Z'
     WHERE user_id = $1`,
    [user],
  );

  await db.query(
    `INSERT INTO assets (id, user_id, category_id, name, amount, currency, crypto_symbol, metal_symbol,
                         notes, quantity, show_on_chart, sort_order, created_at, updated_at) VALUES
       ($2, $1, 'savings_account', $5::text || ' savings', 12500.50, 'EUR', NULL, NULL, 'emergency fund', NULL, true, 2,
        '2026-01-02T10:00:00Z', '2026-01-03T10:00:00Z'),
       ($3, $1, 'crypto', $5::text || ' coins', 4100.00, 'USD', 'BTC', NULL, NULL, 0.05000000, false, 0,
        '2026-01-04T10:00:00Z', '2026-01-05T10:00:00Z'),
       ($4, $1, 'loans_credit', $5::text || ' loan', 3000.00, 'PLN', NULL, NULL, NULL, NULL, false, 1,
        '2026-01-06T10:00:00Z', '2026-01-06T10:00:00Z')`,
    [user, asset1, asset2, asset3, label],
  );

  await db.query(
    `INSERT INTO tags (id, user_id, name, show_on_dashboard, created_at, updated_at) VALUES
       ($2, $1, 'Long term', true, '2026-01-07T10:00:00Z', '2026-01-08T10:00:00Z'),
       ($3, $1, 'Crypto', false, '2026-01-07T11:00:00Z', '2026-01-07T11:00:00Z')`,
    [user, tagLong, tagCrypto],
  );
  await db.query(
    `INSERT INTO asset_tags (asset_id, tag_id, user_id, created_at) VALUES
       ($2, $4, $1, '2026-01-09T10:00:00Z'),
       ($3, $4, $1, '2026-01-09T10:01:00Z'),
       ($3, $5, $1, '2026-01-09T10:02:00Z')`,
    [user, asset1, asset2, tagLong, tagCrypto],
  );

  await db.query(
    `INSERT INTO snapshots (id, user_id, total_net_worth, display_currency, base_currency, source, note,
                            net_contribution, income, created_at) VALUES
       ($2, $1, 15000.00, 'EUR', 'USD', 'manual', 'first', NULL, NULL, '2026-01-31T18:00:00Z'),
       ($3, $1, 16234.56, 'EUR', 'USD', 'manual', NULL, -250.00, 4200.00, '2026-02-28T18:00:00Z')`,
    [user, snap1, snap2],
  );
  await db.query(
    `INSERT INTO snapshot_items (snapshot_id, category_id, name, original_amount, original_currency,
                                 converted_amount, display_currency, exchange_rate_usd, display_order,
                                 tag_ids, created_at) VALUES
       ($1, 'savings_account', $5::text || ' savings', 12000.00, 'EUR', 12000.00, 'EUR', 1.0800000000, 0,
        NULL, '2026-01-31T18:00:00Z'),
       ($1, 'crypto', $5::text || ' coins', 3200.00, 'USD', 2950.00, 'EUR', 1.0000000000, 1,
        NULL, '2026-01-31T18:00:00Z'),
       ($2, 'savings_account', $5::text || ' savings', 12500.50, 'EUR', 12500.50, 'EUR', 1.0800000000, 0,
        ARRAY[$3::uuid], '2026-02-28T18:00:00Z'),
       ($2, 'crypto', $5::text || ' coins', 4100.00, 'USD', 3780.06, 'EUR', 1.0000000000, 1,
        ARRAY[$3::uuid, $4::uuid], '2026-02-28T18:00:00Z'),
       ($2, 'loans_credit', $5::text || ' loan', 3000.00, 'PLN', 700.00, 'EUR', 0.2500000000, 2,
        ARRAY[]::uuid[], '2026-02-28T18:00:00Z')`,
    [snap1, snap2, tagLong, tagCrypto, label],
  );

  await db.query(
    `INSERT INTO goals (user_id, name, kind, category_id, target_amount, target_currency, target_date,
                        created_at, updated_at) VALUES
       ($1, $2::text || ' million', 'net_worth', NULL, 1000000.00, 'EUR', '2040-12-31',
        '2026-01-10T10:00:00Z', '2026-01-10T10:00:00Z'),
       ($1, $2::text || ' cushion', 'category', 'savings_account', 20000.00, 'PLN', NULL,
        '2026-01-11T10:00:00Z', '2026-01-12T10:00:00Z')`,
    [user, label],
  );

  await db.query(
    `INSERT INTO allocation_cards (id, user_id, name, position, created_at, updated_at) VALUES
       ($2, $1, $3::text || ' portfolio', 0, '2026-01-13T10:00:00Z', '2026-01-13T10:00:00Z')`,
    [user, card, label],
  );
  await db.query(
    `INSERT INTO allocation_targets (user_id, card_id, asset_id, target_pct, created_at, updated_at) VALUES
       ($1, $2, $3, 70.00, '2026-01-14T10:00:00Z', '2026-01-14T10:00:00Z'),
       ($1, $2, $4, 30.00, '2026-01-14T10:00:00Z', '2026-01-15T10:00:00Z')`,
    [user, card, asset1, asset2],
  );
}

async function rowsAsJson(db: PGlite, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  // to_jsonb gives the wire shape PostgREST gives the app: numerics as JSON
  // numbers, timestamptz as ISO-8601 strings, uuid[] as string arrays.
  const res = await db.query<{ rows: Record<string, unknown>[] }>(
    `SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM (${sql}) t`,
    params,
  );
  return res.rows[0].rows;
}

/**
 * What GET /api/backup/export fetches for `user`: the same tables, scoped the
 * same way (snapshot_items through the user's snapshot ids). Run it as the
 * user, so RLS applies exactly as for the route.
 */
export async function fetchBackupInput(db: PGlite, user: string): Promise<BackupInput> {
  const own = (table: string) => rowsAsJson(db, `SELECT * FROM ${table} WHERE user_id = $1`, [user]);
  return {
    user_preferences: await own("user_preferences"),
    assets: await own("assets"),
    snapshots: await own("snapshots"),
    snapshot_items: await rowsAsJson(
      db,
      "SELECT * FROM snapshot_items WHERE snapshot_id IN (SELECT id FROM snapshots WHERE user_id = $1)",
      [user],
    ),
    goals: await own("goals"),
    allocation_cards: await own("allocation_cards"),
    allocation_targets: await own("allocation_targets"),
    tags: await own("tags"),
    asset_tags: await own("asset_tags"),
  } as unknown as BackupInput;
}

/**
 * Per-table row count and md5 over the whole rows (ids included) belonging to
 * `user`, for "nothing of this user changed" checks. Run as the superuser.
 */
export async function userFingerprint(db: PGlite, user: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const scoped: Record<string, string> = Object.fromEntries(
    USER_TABLES.map((table) => [table, `SELECT * FROM ${table} WHERE user_id = $1`]),
  );
  scoped.snapshot_items =
    "SELECT * FROM snapshot_items WHERE snapshot_id IN (SELECT id FROM snapshots WHERE user_id = $1)";
  for (const [table, sql] of Object.entries(scoped)) {
    const res = await db.query<{ n: number; sum: string | null }>(
      `SELECT count(*)::int AS n, md5(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text)) AS sum
         FROM (${sql}) t`,
      [user],
    );
    out[table] = `${res.rows[0].n}:${res.rows[0].sum ?? "-"}`;
  }
  return out;
}
