// In-file fixtures for the smoke suite's Supabase stub (supabase-stub.ts) and
// the specs that read them. No real backend is ever involved: every timestamp
// is computed from the stub's clock at request time, so ages are exact.

export const STUB_PORT = 54329;
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
/** Not a credential: the stub accepts any apikey. */
export const STUB_ANON_KEY = "smoke-dummy-anon-key";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** Each scenario is one fake user; the stub picks fixtures by the JWT `sub`. */
export const SCENARIOS = {
  /** One stale priced holding (10 days), one fresh; last snapshot 40 days ago. */
  stale: "00000000-0000-4000-8000-000000000010",
  /** Only fresh priced holdings; last snapshot 2 days ago. */
  fresh: "00000000-0000-4000-8000-000000000020",
} as const;

export type Scenario = keyof typeof SCENARIOS;

export function scenarioForUserId(userId: string): Scenario | null {
  for (const [name, id] of Object.entries(SCENARIOS)) {
    if (id === userId) return name as Scenario;
  }
  return null;
}

export const STALE_ASSET_NAME = "Smoke Bitcoin";
export const FRESH_ASSET_NAME = "Smoke Ethereum";
export const CASH_ASSET_NAME = "Smoke Savings";

type Row = Record<string, unknown>;

const CATEGORIES: Row[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Crypto",
    icon: null,
    is_liability: false,
    display_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Cash",
    icon: null,
    is_liability: false,
    display_order: 2,
    created_at: "2026-01-01T00:00:00.000Z",
  },
];
const [CRYPTO, CASH] = CATEGORIES;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function asset(userId: string, id: string, fields: Row, category: Row): Row {
  return {
    id,
    user_id: userId,
    amount: 0,
    currency: "USD",
    category_id: category.id,
    crypto_symbol: null,
    metal_symbol: null,
    quantity: null,
    notes: null,
    show_on_chart: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...fields,
    category,
  };
}

/** All tables for one scenario, as PostgREST would return them with joins embedded. */
export function tablesFor(scenario: Scenario, nowMs: number): Record<string, Row[]> {
  const userId = SCENARIOS[scenario];
  const freshAt = iso(nowMs - 1 * MS_PER_DAY);

  const assets: Row[] = [
    asset(
      userId,
      "20000000-0000-4000-8000-000000000002",
      { name: FRESH_ASSET_NAME, crypto_symbol: "ETH", quantity: 2, amount: 6000, sort_order: 1, updated_at: freshAt },
      CRYPTO,
    ),
    asset(
      userId,
      "20000000-0000-4000-8000-000000000003",
      // Unpriced and old: must never count as a stale price.
      { name: CASH_ASSET_NAME, amount: 10000, sort_order: 2, updated_at: iso(nowMs - 60 * MS_PER_DAY) },
      CASH,
    ),
  ];
  if (scenario === "stale") {
    assets.unshift(
      asset(
        userId,
        "20000000-0000-4000-8000-000000000001",
        {
          name: STALE_ASSET_NAME,
          crypto_symbol: "BTC",
          quantity: 0.5,
          amount: 30000,
          // 10 days and one hour: floors to exactly 10 whole days.
          updated_at: iso(nowMs - 10 * MS_PER_DAY - MS_PER_HOUR),
        },
        CRYPTO,
      ),
    );
  }

  const snapshotAgeDays = scenario === "stale" ? 40 : 2;
  const snapshotId =
    scenario === "stale" ? "30000000-0000-4000-8000-000000000001" : "30000000-0000-4000-8000-000000000002";
  const snapshotAt = iso(nowMs - snapshotAgeDays * MS_PER_DAY - MS_PER_HOUR);
  const snapshotItems: Row[] = assets.map((a, index) => ({
    id: `40000000-0000-4000-8000-00000000000${index + 1}`,
    snapshot_id: snapshotId,
    name: a.name,
    category_id: a.category_id,
    original_amount: a.amount,
    original_currency: a.currency,
    converted_amount: a.amount,
    display_currency: "USD",
    display_order: index,
    exchange_rate_usd: 1,
    tag_ids: null,
    created_at: snapshotAt,
    category: a.category,
  }));
  const total = assets.reduce((sum, a) => sum + Number(a.amount), 0);
  const snapshots: Row[] = [
    {
      id: snapshotId,
      user_id: userId,
      created_at: snapshotAt,
      total_net_worth: total,
      base_currency: "USD",
      display_currency: "USD",
      net_contribution: null,
      income: null,
      note: null,
      source: "manual",
      snapshot_items: snapshotItems,
    },
  ];

  // Fresh cache rows keep getRates() off the network (no frankfurter call).
  const fetchedAt = iso(nowMs - 60_000);
  const exchangeRateCache: Row[] = [
    { base_currency: "EUR", target_currency: "USD", rate: 1.1, fetched_at: fetchedAt },
    { base_currency: "EUR", target_currency: "PLN", rate: 4.3, fetched_at: fetchedAt },
  ];

  return {
    assets,
    asset_categories: CATEGORIES,
    snapshots,
    snapshot_items: snapshotItems,
    exchange_rate_cache: exchangeRateCache,
  };
}

/** Tables readable without a signed-in user. */
export function publicTables(nowMs: number): Record<string, Row[]> {
  const { asset_categories, exchange_rate_cache } = tablesFor("fresh", nowMs);
  return { asset_categories, exchange_rate_cache };
}

export function userFor(scenario: Scenario): Row {
  const id = SCENARIOS[scenario];
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${scenario}@smoke.invalid`,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
}
