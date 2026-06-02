// Shared chainable Supabase mock factory for handler integration tests.
// Every per-handler test file calls `vi.mock("@/lib/supabase", ...)` and
// returns the `client` from `createSupabaseMock`. The mock records every
// chainable method call into `recorded` and per-builder `__recorded` for
// assertions like "did the handler filter by user_id".
//
// `auth.getUser()` returns `{user: {id: userId}}` when `userId` is set and
// `{user: null}` when null. The cookie header on the Request is the test's
// signal; the factory does not parse cookies itself — it is the test's job
// to call `createSupabaseMock({userId})` based on the request's Cookie
// header. This is the request-boundary mock pattern from
// context/foundation/test-plan.md:43.

import { vi } from "vitest";

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface TableResult {
  data: unknown;
  error: unknown;
}

export interface MockSupabaseBuilder {
  then: <T>(onFulfilled: (value: { data: unknown; error: unknown }) => T) => Promise<T>;
  [key: string]: unknown;
  __table: string;
  __recorded: RecordedCall[];
}

export interface MockSupabaseClient {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: null }> };
  from: (table: string) => MockSupabaseBuilder;
  rpc: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
}

export interface CreateSupabaseMockOptions {
  userId: string | null;
  // Static per-table result returned for every .then() call on that table.
  tableResults?: Record<string, TableResult>;
  // Per-table queue of results: the first .then() returns queue[0], the
  // second returns queue[1], etc. Used by the snapshot POST scenarios
  // where the same table is awaited multiple times in one handler
  // (parent insert + compensating delete). If the queue runs out, falls
  // back to tableResults, then to `{data: null, error: null}`.
  tableResultQueues?: Record<string, TableResult[]>;
}

export interface CreateSupabaseMockResult {
  client: MockSupabaseClient;
  recorded: RecordedCall[];
  builders: Map<string, MockSupabaseBuilder>;
  setTableResult: (table: string, result: TableResult) => void;
  setTableResultQueue: (table: string, results: TableResult[]) => void;
}

export function createSupabaseMock(opts: CreateSupabaseMockOptions): CreateSupabaseMockResult {
  const recorded: RecordedCall[] = [];
  const builders = new Map<string, MockSupabaseBuilder>();
  const tableResults = new Map<string, TableResult>(Object.entries(opts.tableResults ?? {}));
  const tableResultQueues = new Map<string, { queue: TableResult[]; index: number }[]>();
  for (const [table, results] of Object.entries(opts.tableResultQueues ?? {})) {
    tableResultQueues.set(table, [{ queue: [...results], index: 0 }]);
  }
  const thenCounters = new Map<string, number>();

  const from = (table: string): MockSupabaseBuilder => {
    const existing = builders.get(table);
    if (existing) return existing;

    const builderRecords: RecordedCall[] = [];
    const builder: MockSupabaseBuilder = new Proxy(
      { __table: table, __recorded: builderRecords },
      {
        get(target, prop: string | symbol): unknown {
          if (prop === "__table") return table;
          if (prop === "__recorded") return builderRecords;
          if (prop === "then") {
            return (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
              const callIdx = (thenCounters.get(table) ?? 0) + 1;
              thenCounters.set(table, callIdx);
              // 1-based call index — first then is callIdx === 1.
              const queue = tableResultQueues.get(table);
              let result: TableResult | undefined;
              if (queue && queue.length > 0) {
                const entry = queue[0];
                result = entry.queue[entry.index];
                entry.index += 1;
              }
              result = result ?? tableResults.get(table) ?? { data: null, error: null };
              return Promise.resolve(result).then(resolve);
            };
          }
          return (...args: unknown[]) => {
            const call: RecordedCall = { method: String(prop), args };
            builderRecords.push(call);
            recorded.push(call);
            return builder;
          };
        },
      },
    );
    builders.set(table, builder);
    return builder;
  };

  const client: MockSupabaseClient = {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await
      getUser: async () => ({
        data: { user: opts.userId ? { id: opts.userId } : null },
        error: null,
      }),
    },
    from,
    // eslint-disable-next-line @typescript-eslint/require-await
    rpc: async () => ({ data: null, error: null }),
  };

  return {
    client,
    recorded,
    builders,
    setTableResult: (table: string, result: TableResult) => {
      tableResults.set(table, result);
    },
    setTableResultQueue: (table: string, results: TableResult[]) => {
      tableResultQueues.set(table, [{ queue: [...results], index: 0 }]);
    },
  };
}

// Minimal AstroCookies stub — only `set` is invoked by the production
// `createClient` factory on token refresh. Other methods are typed but
// never called during the request lifecycle we exercise.
export function createCookiesStub() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
    delete: vi.fn(),
    headers: vi.fn(() => [] as { name: string; value: string }[]),
  };
}
