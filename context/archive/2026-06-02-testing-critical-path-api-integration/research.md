---
date: 2026-06-02T14:30:00+02:00
researcher: Claude
git_commit: f0d3c21830914429c4315026c8df9c77e391c927
branch: master
repository: bitworth
topic: "Phase 2 — Critical-path API integration: risks #2, #3, #5"
tags: [research, codebase, vitest, supabase, api-integration, risk-2, risk-3, risk-5, auth, snapshots, testing-critical-path-api-integration]
status: complete
last_updated: 2026-06-02
last_updated_by: Claude
---

# Research: Phase 2 — Critical-path API integration (risks #2, #3, #5)

**Date**: 2026-06-02T14:30:00+02:00
**Researcher**: Claude
**Git Commit**: `f0d3c21830914429c4315026c8df9c77e391c927`
**Branch**: `master`
**Repository**: `mkozachuk/bitworth`

## Research Question

What does Phase 2 of `context/foundation/test-plan.md` actually have to assert? This phase covers three risks (per §2 risk map and §3 rollout row 2):

- **Risk #2** — Cross-tenant / authorization leak: user A reads or mutates user B's assets/snapshots via a missing session or owner check. Source: PRD FR-005; interview Q1.
- **Risk #3** — Snapshot history integrity: POST creates an orphan parent when items insert fails, or returns rows in the wrong order. Source: `context/foundation/lessons.md` §1; PRD FR-018.
- **Risk #5** — Public API route shipped without explicit auth decision: a new `/api/*` route skips the session check. Source: `context/foundation/lessons.md` §2; PRD FR-005.

Research must ground, for each risk: (1) where the failure lives in the code, (2) the canonical pattern a future engineer would copy or fail to copy, (3) the test seam (how the test intercepts the failure mode), and (4) the contract assertion that pins the lesson into a build break.

## Summary

Six findings dominate the phase and must shape the plan:

1. **The defense-in-depth story has a USING-only gap.** All five authenticated handlers consistently apply `.eq("user_id", user.id)`, AND Supabase RLS is enabled on every user-owned table with `USING (auth.uid() = user_id)` policies. **But the policies are `USING`-only — there is no `WITH CHECK`.** An `UPDATE` could legally set `user_id` to another user and the policy would still allow it. The handler-level `.eq("user_id", user.id)` is therefore the **only** defense against write-scope takeover on the update path. RLS alone is not enough; the handler test is not belt-and-suspenders, it is load-bearing. The test must assert both the WHERE-clause filter AND that `user_id` is not in the update payload.

2. **The "compensating delete" in the snapshot POST has an undocumented worst case.** [`src/pages/api/snapshots/index.ts:156`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L156) does `await supabase.from("snapshots").delete().eq("id", snapshot.id)` with no try/catch and no error check. If the items insert fails AND the compensating delete fails, the function still returns 500 but an orphan parent row remains. The lesson §1 worst case is real and the code does not advertise it. The plan must (a) pin the current behavior with a test (orphan remains, 500 returned) and (b) flag for the team whether the intended fix is a Postgres function or `supabase.rpc` wrapping both inserts.

3. **The chart's defensive re-sort is load-bearing, not redundant.** [`src/components/assets/NetWorthDisplay.tsx:155`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/components/assets/NetWorthDisplay.tsx#L155) re-sorts the API response by `created_at` ascending. [`id`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/lib/database.types.ts#L137) is a UUID, not insertion-ordered, so it cannot substitute for `created_at` if the API's `.order("created_at", { ascending: true })` is ever removed. The test should pin both the API's sort AND the structural property that the insert payload does NOT contain `created_at` (the DB default `NOW()` is the source of truth — confirmed by [`supabase/migrations/20260529190856_initial_schema.sql:46`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/supabase/migrations/20260529190856_initial_schema.sql#L46)).

4. **The `astro:env/server` virtual module is a Vitest blocker for any per-handler test.** [`src/lib/supabase.ts:3`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/lib/supabase.ts#L3) imports `SUPABASE_URL` and `SUPABASE_KEY` from `astro:env/server`, which is resolved by Astro's Vite plugin. The current [`vitest.config.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/vitest.config.ts#L1-L10) does not load that plugin. The contract test (Risk #5) is exempt — it only reads file contents. The Risks #2 and #3 per-handler integration tests will need `vi.mock("@/lib/supabase", ...)` at the top of each test file. The plan must call this out explicitly.

5. **The full `/api/*` surface is small enough to enumerate and audit by hand.** 9 `.ts` files (8 in `src/pages/api/`, 3 of which are in `auth/`, plus the `debug/` directory is empty). Of the 6 non-auth routes, 5 are authenticated and 1 (`rates.ts`) is public-with-comment. The contract test's regex, error message, and `auth/` exemption rule fit in a single file of ~50 lines. There is no need for a glob dependency or a sophisticated AST — a recursive `fs.readdirSync` is sufficient.

6. **Mock at the request boundary, not the auth boundary.** Re-stating `test-plan.md:43` as a positive rule: pass a real `Request` (with or without a `Cookie` header) into the handler; the handler's own `supabase.auth.getUser()` runs against the request; the mock for `createClient` returns a client whose `auth.getUser()` returns `{user: null}` when the `Cookie` header is missing — exactly what a real missing-cookie request produces. The anti-pattern is mocking `auth.getUser()` to always return user A's id and only varying the URL, which passes for both the bug and the fix.

## Detailed Findings

### Risk #2 — Cross-tenant / authorization leak

#### Inventory of handlers that touch user-owned tables

| Route | Method | File:line | `user_id` filter | Filter form |
|---|---|---|---|---|
| `GET /api/assets` | GET | [`src/pages/api/assets/index.ts:34-38`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/index.ts#L34-L38) | yes | `.eq("user_id", user.id)` |
| `POST /api/assets` | POST | [`src/pages/api/assets/index.ts:117-130`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/index.ts#L117-L130) | yes | baked into insert payload (line 127) |
| `PUT /api/assets/[id]` | PUT | [`src/pages/api/assets/[id]/index.ts:79-85`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/[id]/index.ts#L79-L85) | yes | `.eq("id", id).eq("user_id", user.id)` (compound) |
| `DELETE /api/assets/[id]` | DELETE | [`src/pages/api/assets/[id]/index.ts:149-155`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/[id]/index.ts#L149-L155) | yes | compound |
| `GET /api/snapshots` | GET | [`src/pages/api/snapshots/index.ts:31-35`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L31-L35) | yes | `.eq("user_id", user.id)` |
| `POST /api/snapshots` | POST | [`src/pages/api/snapshots/index.ts:67-70, 110-121, 153`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L67-L70) | yes | filters on user-owned tables; items insert has no `user_id` (column does not exist) — ownership is transitive via the parent `snapshots` row |
| `GET /api/categories` | GET | [`src/pages/api/categories/index.ts:33-37`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/categories/index.ts#L33-L37) | n/a | reads global `asset_categories` (no `user_id` column) |
| `GET /api/crypto-price` | GET | [`src/pages/api/crypto-price.ts:48`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/crypto-price.ts#L48) | n/a | reads global `crypto_price_cache` (RLS `FOR SELECT USING (true)`) |
| `GET /api/rates` | GET | [`src/pages/api/rates.ts:7-21`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/rates.ts#L7-L21) | n/a | public-by-design (see Risk #5) |

All filter shapes are consistent. The `assets/[id]` compound filter (`id + user_id`) is the strongest form — even if `id` collides across users, the `user_id` clause makes the row unreachable. The other handlers use single `user_id` filters because they read/write collections scoped to the caller.

#### The canonical auth pattern

The 22-line block at [`src/pages/api/assets/index.ts:9-32`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/index.ts#L9-L32) is byte-identical (modulo indentation) in 5 other handlers: `snapshots/index.ts:13-29`, `assets/[id]/index.ts:11-33` and `:114-136`, `categories/index.ts:9-31`, and `crypto-price.ts:10-32`. Two functional deltas:

- `auth/signin.ts:9-12` and `auth/signup.ts:9-12` redirect on `!supabase` (not 401) because they own the auth flow.
- `rates.ts:7-14` skips the auth block and returns 200 with fallback rates when `supabase` is null — the documented exception (see Risk #5).

A future engineer copying "the auth pattern" from any one of the 5 authenticated handlers will get the correct shape. The risk is the engineer who copies the *outer shell* (status codes, response body) but forgets to call `getUser()` — a 14-line accident that the contract test (Risk #5) catches by static scan, and that the per-handler integration test catches by sending an unauthenticated `Request`.

#### Defense-in-depth: is RLS enabled? (and the USING-only gap)

Read in full from [`supabase/migrations/20260529190856_initial_schema.sql`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/supabase/migrations/20260529190856_initial_schema.sql) and [`supabase/migrations/20260531223101_crypto_price_cache.sql`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/supabase/migrations/20260531223101_crypto_price_cache.sql).

| Table | RLS enabled | Policy | USING | WITH CHECK |
|---|---|---|---|---|
| `user_preferences` | yes (line 85) | "Users own their preferences" (line 92-93) | `auth.uid() = user_id` | **none** |
| `assets` | yes (line 86) | "Users own their assets" (line 95-96) | `auth.uid() = user_id` | **none** |
| `snapshots` | yes (line 87) | "Users own their snapshots" (line 98-99) | `auth.uid() = user_id` | **none** |
| `snapshot_items` | yes (line 88) | "Users own their snapshot items" (line 101-104) | `snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid())` | **none** |
| `asset_categories` | yes (line 89) | none | n/a | n/a |
| `exchange_rate_cache` | yes (line 89) | "Anyone can read exchange rates" (line 106-107) | `true` | n/a |
| `crypto_price_cache` | yes ([migration 2 line 16](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/supabase/migrations/20260531223101_crypto_price_cache.sql#L16)) | "Anyone can read crypto prices" (line 18-19) | `true` | n/a |

**The USING-only gap.** `FOR ALL USING (...)` is the policy form. In Postgres RLS, `USING` gates row visibility for SELECT/UPDATE/DELETE; it does **not** constrain the new/updated row on INSERT/UPDATE. Without `WITH CHECK`, an `UPDATE` like `from("assets").update({ user_id: "<someone-else>" }).eq("id", id)` is permitted by the policy — Postgres checks that the *existing* row is visible (USING matches), but does not check the *resulting* row. The handler-level filter (`.eq("user_id", user.id)` in the WHERE) prevents this by ensuring the matched row is the caller's; the `updates` payload at [`src/pages/api/assets/[id]/index.ts:55-77`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/[id]/index.ts#L55-L77) never includes `user_id` in the keys, so a write-scope change is impossible at the call site. **A future feature that adds "transfer asset" and writes `user_id` to the update payload would silently bypass the policy** — RLS USING alone is insufficient.

**Plan recommendation:** add `WITH CHECK (auth.uid() = user_id)` to the four user-owned policies in a follow-up migration (out of scope for this phase). The Phase 2 test pins the current handler-side defense. Both layers matter.

#### The test seam

The test must mock at the **request boundary**, not the auth boundary. Concretely:

1. **Build a real `Request` object** with the desired `Cookie` header (or none). The handler's own `supabase.auth.getUser()` runs against this request and decides 401 vs. proceed.
2. **Mock `@/lib/supabase`'s `createClient`** via `vi.mock` so the test controls what the returned client does. The factory stub must:
   - Return a Supabase-like object with a fluent chainable `from(table).select(...).eq(...).eq(...).single()` proxy
   - Return a separate `auth: { getUser(): Promise<{data: {user: User|null}}> }` sub-object
   - The chainable proxy records every method call into an array: `{method: "eq", args: ["user_id", "userA.id"]}`
3. **Call the APIRoute handler directly** with the constructed context. The signature is `async ({ request, cookies, params }) => Response`. Build a minimal `cookies` stub (Map-backed; implements `set()` because `createClient`'s `setAll` calls it on token refresh — see [`src/lib/supabase.ts:17-21`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/lib/supabase.ts#L17-L21)).

The cross-tenant assertion shape: `expect(recorded).toContainEqual({method: "eq", args: ["user_id", "userA.id"]})`. **The mock must return user A's id from `auth.getUser()`** — varying only the URL but keeping the auth boundary mocked to "always user A" is the "mock at the auth boundary" anti-pattern called out in [`context/foundation/test-plan.md:43`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/foundation/test-plan.md#L43). It passes for both the bug (no filter) and the fix (filter present), so it proves nothing.

```ts
// GOOD: request-boundary mock — the handler's own auth check runs against the request
vi.mock("@/lib/supabase", () => ({
  createClient: (headers: Headers) => {
    const hasCookie = headers.get("Cookie")?.includes("sb-access-token");
    return {
      auth: {
        getUser: async () => ({
          data: { user: hasCookie ? { id: "user-A" } : null },
          error: null,
        }),
      },
      from: (table: string) => {
        const recorded: Array<{ method: string; args: unknown[] }> = [];
        const builder = new Proxy({}, {
          get: (_, prop: string) => (...args: unknown[]) => {
            recorded.push({ method: prop, args });
            if (prop === "then") return undefined; // not awaited directly
            return builder;
          },
        });
        (builder as any).__recorded = recorded; // expose for assertions
        (builder as any).__table = table;
        return builder;
      },
    };
  },
}));

const request1 = new Request("http://localhost/api/assets/asset-b-id", { method: "PUT", body: formData });
// no Cookie — handler's getUser() returns null — handler must 401
expect((await PUT({ request: request1, cookies, params: { id: "asset-b-id" }, locals: {} } as any)).status).toBe(401);

const request2 = new Request("http://localhost/api/assets/asset-b-id", {
  method: "PUT",
  body: formData,
  headers: { Cookie: "sb-access-token=fake" },
});
// Cookie present — handler's getUser() returns user-A
// assert the captured chain contains {method: "eq", args: ["user_id", "user-A"]}
```

#### Failure mode the test must catch

A future engineer writes `DELETE /api/assets/[id]` and forgets `.eq("user_id", user.id)`. With current RLS, the `USING` policy still applies — Postgres silently appends the row visibility check, no row matches, the handler returns 404. **The bug is caught by RLS, not by the handler test.** So for visibility, the handler test is redundant.

The handler test is **not** redundant for the policy-regression scenario: a future migration runs `ALTER TABLE assets DISABLE ROW LEVEL SECURITY;` (intentionally for a backfill, or by accident) and the handler test fails immediately with a captured `.eq("user_id", ...)` call that no longer matters. RLS is off, the test screams. The handler test is also not redundant for the write-scope scenario: a future maintainer adds `user_id` to the update payload for a "transfer" feature, and the policy's USING clause does not stop the row from being reassigned. The test that asserts `user_id` is **not** in the `updates` object catches this.

**The test must therefore assert three things for the update path:**
- `.eq("user_id", user.id)` was called
- the `updates` payload does not contain a `user_id` key
- the response is 404 (not 403) when the row does not match — matching the current handler's [`!data` 404 branch at line 97-105 and 167-175`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/[id]/index.ts#L97-L175)

For the read path, the test must assert:
- `.eq("user_id", user.id)` was called (in the GET chain)
- the response is 200 with only the caller's rows (the mock can return a fixed array and assert no leak)

---

### Risk #3 — Snapshot history integrity

#### Full POST /api/snapshots flow

Walked line-by-line in [`src/pages/api/snapshots/index.ts:47-168`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L47-L168). Operations in order:

1. **Auth check** (lines 48-64) — the canonical pattern.
2. **Asset fetch** (lines 67-70) — `from("assets").select("*, category:asset_categories(*)").eq("user_id", user.id)`. Failure: returns 500 with `code: FETCH_FAILED`.
3. **Preferences fetch** (lines 80-84) — `from("user_preferences").select("display_currency").eq("user_id", user.id).maybeSingle()`. **Note: no error check on this query.** A failure here silently falls through to the `prefs` being `null` and `displayCurrency` defaults to `"USD"` (line 88-90). This is benign for the user but should be flagged — a future maintainer might assume `prefs` is defined.
4. **Rates fetch** (line 95) — `getRates(supabase)`. The helper itself can fail (e.g., `crypto_price_cache` rate missing); the failure path is not in scope for this risk.
5. **Net worth computation** (lines 97-107) — pure arithmetic on the `assets` array. No failure mode.
6. **Parent `snapshots` insert** (lines 110-121). Failure: returns 500 with `code: INSERT_FAILED` (line 123-128). **No compensation needed** because nothing was inserted before this.
7. **Empty-assets short-circuit** (line 140) — if `assets.length === 0`, skip the items insert. A parent row with `total_net_worth: 0` is still committed. Intent unclear; test should pin and surface.
8. **Items insert** (lines 141-153) — `from("snapshot_items").insert(items)`. Each item carries `snapshot_id`, `category_id`, `name`, `original_amount`, `original_currency`, `converted_amount`, `display_currency`, `exchange_rate_usd`, `display_order`. **Failure: compensating delete** (line 156) — `await supabase.from("snapshots").delete().eq("id", snapshot.id)` — then return 500. **No try/catch on the delete**, no error check on the delete result.
9. **Final response** (lines 164-167) — `201` with the parent snapshot row.

#### The compensating delete — is it sufficient?

Three failure modes:

- **Items insert fails; compensating delete succeeds.** Handler returns 500. The DB has no parent and no items. Clean. This is the intended happy-failure path.
- **Items insert fails; compensating delete fails.** Handler returns 500 with the original `itemsError.message`. The DB has a parent row with no items. **Orphan persists.** This is the lesson §1 worst case, and the code does not advertise it. The test should pin this behavior so a future fix is observable.
- **Items insert silently no-ops due to RLS / permission mismatch.** The handler thinks the insert succeeded (no `error` returned), no compensating delete runs, the parent is committed, the items are absent. This is the most insidious failure — the test must stub `from("snapshot_items").insert` to return `{error: null}` and assert that the handler does NOT execute the compensating-delete branch.

A second risk surface: **concurrent POSTs.** Two POSTs from the same user fetch the same `assets` set in parallel. Both insert a parent. Both insert items with the same `(snapshot_id, asset_id)` pairs. The schema has **no unique constraint on `(snapshot_id, asset_id)`** — see [`supabase/migrations/20260529190856_initial_schema.sql:54-66`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/supabase/migrations/20260529190856_initial_schema.sql#L54-L66). Result: duplicated items in the chart. The plan should either pin the current behavior (duplicates allowed) or add the constraint. Out of scope for the test, but worth a note.

#### The sort-key contract

The chart depends on `created_at` ordering. The full chain:

- **Server-rendered chart** ([`src/pages/dashboard.astro:27-31`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/dashboard.astro#L27-L31)) uses `from("snapshots").select(...).order("created_at", { ascending: true })`.
- **Client-rendered chart** ([`src/components/assets/NetWorthDisplay.tsx:155`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/components/assets/NetWorthDisplay.tsx#L155)) re-sorts defensively: `const sorted = [...snapshots].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())`. Then uses `sorted[sorted.length - 1]` (line 156) for the "newest" delta. **This re-sort is load-bearing**, not redundant — without it, the chart's "newest" assumption depends entirely on the API's `.order()` call.
- **Year-start lookup** ([`src/components/NetWorthChart.tsx:58`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/components/NetWorthChart.tsx#L58)) does `snapshots.find((s) => new Date(s.created_at) <= yearStart)`. Depends on `created_at` being a real ISO timestamp.

`id` cannot substitute for `created_at`: per [`src/lib/database.types.ts:137`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/lib/database.types.ts#L137), the `snapshots.id` column is typed as `string` (Postgres `uuid`). UUIDs are not time-ordered in this codebase (no `uuid_generate_v7` evidence in migrations). A query that returns rows in `id` order will not return them in insertion order.

**Where is `created_at` set?** The handler never sends `created_at` in the insert payload ([line 113-119](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L113-L119)). The DB default fires. Confirmed by [`supabase/migrations/20260529190856_initial_schema.sql:46`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/supabase/migrations/20260529190856_initial_schema.sql#L46) (`created_at timestamptz default now()`). The Insert type at [`src/lib/database.types.ts:155`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/lib/database.types.ts#L155) allows `created_at` to be passed, so a future regression that adds `created_at: <client-derived-time>` is silent — the test should pin the structural property that the insert payload does NOT contain a `created_at` key.

#### Test scenarios

| # | Scenario | Mock shape | Assertion |
|---|---|---|---|
| 1 | Happy path: 2 assets, both inserts succeed | `from("snapshot_items").insert` returns `{error: null}` | Response 201; payload contains the parent row with `id`; the items-insert chain was called with a 2-element array |
| 2 | Items insert fails, compensating delete succeeds | `from("snapshot_items").insert` returns `{error: {message: "..."}}`; `from("snapshots").delete` returns `{error: null}` | Response 500; the `delete().eq("id", snapshotId)` call was made; net result is "no orphan, no items" |
| 3 | Items insert fails, compensating delete ALSO fails (lesson §1 worst case) | Both return `{error: {message: "..."}}` | Response 500; the delete call was made; **pin the orphan**: the test asserts the current behavior so a future fix is observable. Add a `// TODO: replace with a Postgres function` comment in the test. |
| 4 | Items insert silently no-ops (returns `{error: null}` but no rows written) | Stub returns `{error: null, data: []}` | Response 201; the compensating-delete branch was NOT entered; items are absent. This catches the "silent no-op" failure mode. |
| 5 | Sort order on GET | Stub `from("snapshots").select(...).order(...)` chain; pre-seed `created_at` values: `2024-01-01`, `2024-02-01`, `2023-12-01` in that insertion order | Response data is `[2023-12-01, 2024-01-01, 2024-02-01]` (chronological, not insertion order) |
| 6 | Empty assets: `assets.length === 0` | `from("assets").select(...)` returns `[]` | Response 201; parent row exists with `total_net_worth: 0`; **no** items insert call was made. Pins the questionable-but-current behavior. |
| 7 | Insert payload does NOT include `created_at` (structural property) | Capture the args to `from("snapshots").insert` | The captured object does not have a `created_at` key. Pins the DB-default contract. |

The 7th scenario is a regression guard against a future maintainer adding a client-derived timestamp. The 4th scenario is the "no error but no rows" trap. The 3rd pins the lesson §1 worst case.

#### Test seam for snapshot POST

`getRates` is an internal module import ([line 3](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L3)) — mocking it requires `vi.mock("@/lib/exchange-rates", ...)` per test file, returning a fixed `rates` object. This is one of the few cases where the plan's "never mock internal modules" policy has to bend — the alternative is MSW at the HTTP edge, but the handler does not call a public HTTP endpoint for rates, it calls the in-process module. **The plan must decide**: carve a one-line `vi.mock` exception or set up MSW for the `crypto_price_cache` table that `getRates` reads. **Recommend: bend the policy.** MSW for a single helper is overkill; the `vi.mock` is two lines.

The other internal calls in the handler:
- `createClient` from `@/lib/supabase` — must be `vi.mock`'d due to the `astro:env` blocker (see Risk #5 §5)
- `convertAmount` from `@/lib/net-worth` — pure function, no mock needed; stub `getRates` to return rates that make the conversion deterministic
- `getRates` from `@/lib/exchange-rates` — must be mocked

The supabase mock must distinguish each `.from(table)` chain by table name. Recommended shape: a factory that returns a `Map<tableName, chainableBuilder>` with each builder recording its own call sequence.

---

### Risk #5 — Public API route shipped without explicit auth decision

#### Full inventory of `src/pages/api/`

| Path | Methods | `auth.getUser()` call | Public-route comment | Verdict |
|---|---|---|---|---|
| [`src/pages/api/assets/index.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/index.ts) | GET (L9), POST (L59) | L23, L73 | — | **AUTHENTICATED** |
| [`src/pages/api/assets/[id]/index.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/[id]/index.ts) | PUT (L10), DELETE (L113) | L24, L127 | — | **AUTHENTICATED** |
| [`src/pages/api/categories/index.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/categories/index.ts) | GET (L8) | L22 | — | **AUTHENTICATED** |
| [`src/pages/api/crypto-price.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/crypto-price.ts) | GET (L9) | L23 | — | **AUTHENTICATED** |
| [`src/pages/api/snapshots/index.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts) | GET (L12), POST (L47) | L23, L58 | — | **AUTHENTICATED** |
| [`src/pages/api/rates.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/rates.ts) | GET (L7) | absent | L5-6 | **PUBLIC-WITH-COMMENT** |
| [`src/pages/api/auth/signin.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/auth/signin.ts) | POST (L4) | absent | — | **AUTH-ENDPOINT** (exempt) |
| [`src/pages/api/auth/signup.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/auth/signup.ts) | POST (L4) | absent | — | **AUTH-ENDPOINT** (exempt) |
| [`src/pages/api/auth/signout.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/auth/signout.ts) | POST (L4) | absent | — | **AUTH-ENDPOINT** (exempt) |
| `src/pages/api/debug/` | — | — | — | **EMPTY** (no files) |

**The canonical 22-line auth-check pattern** at [`src/pages/api/assets/index.ts:9-32`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/index.ts#L9-L32) is duplicated 8 times. The only public-route comment in the entire `src/` tree is the 2-line justification at [`src/pages/api/rates.ts:5-6`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/rates.ts#L5-L6).

#### Comment pattern survey

Only one public-route comment exists in the entire `src/` tree (verified via grep for `intentionally|public route|design decision`). No formal marker — the author used free-form prose:

> "Rates are intentionally unauthenticated — exchange rates are public financial data with no user-specific sensitivity. This is an explicit design decision, not an oversight."

Three regex options for the contract test:

| Option | Regex | Pros | Cons |
|---|---|---|---|
| A (recommended) | `/\/\*?\s*(intentionally (unauthenticated\|public)\|public route\|explicit design decision)/i` | Matches the existing comment's two key phrases | May miss future synonyms (`"no auth required"`) |
| B | `/\b(intentionally (unauthenticated\|public)\|public (route\|endpoint\|by design)\|no auth (needed\|required\|by design))\b/i` | Broader | Matches incidental prose; more false positives |
| C | `/\/\*?\s*@public-route\b/` | Deterministic, future-proof | Requires a refactor of `rates.ts` and a new docstring convention |

**Recommended: Option A.** The plan should commit to a small marker vocabulary and add a `// intentionally unauthenticated:` or `// explicit design decision:` convention to the test-plan §6 cookbook so future authors know exactly what to type.

#### Contract test design

**Location:** [`src/pages/api/api-auth-contract.test.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/api-auth-contract.test.ts) (co-located with the surface under audit). Rejected: `src/lib/` (less discoverable for code review).

**Walk algorithm:** 10-line recursive `fs.readdirSync` (no `glob` dependency):

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_ROOT = join(process.cwd(), "src/pages/api");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}
```

**Per-file rules:**

1. If the file is under `auth/`: must call `createClient` (positive assertion — auth endpoints need a client to do their work, but don't need a session). The `auth/` directory is the only directory-level exemption.
2. If the file is under any other path: must EITHER contain the substring `supabase.auth.getUser()` (canonical auth check) OR match the public-marker regex from §2 Option A.
3. **Error message:** `"File '<rel>' has neither auth check nor explicit public-route comment. Either add supabase.auth.getUser() + 401 handling, or add a comment explaining why this route is public."`
4. **Dynamic routes** (`[id]/index.ts`): no special handling. The auth check lives in the file regardless of the path parameter. The test reads `src/pages/api/assets/[id]/index.ts` like any other `.ts` file.
5. **Empty subdirectories** (`debug/`): handled gracefully — the walk just yields no files for them. The test does not assert a minimum route count.

**Expected test count:** 1 sanity `it` (walk found files) + 9 per-file `it` blocks (5 AUTHENTICATED, 1 PUBLIC-WITH-COMMENT, 3 AUTH-ENDPOINT) = 10 `it` blocks. The 3 AUTH-ENDPOINT `it` blocks run a positive `createClient` assertion instead of the auth-or-comment rule. Empty `debug/` contributes zero.

**Full test shape:**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_ROOT = join(process.cwd(), "src/pages/api");
const AUTH_CHECK = "supabase.auth.getUser()";
const PUBLIC_COMMENT = /\/\*?\s*(intentionally (unauthenticated|public)|public route|explicit design decision)/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("API route auth contract", () => {
  const files = walk(API_ROOT);

  it("finds at least one route (sanity check — empty dir is a test bug, not a pass)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const full of files) {
    const rel = relative(API_ROOT, full);
    const isAuth = rel.split(sep).includes("auth");

    it(`${rel} has an auth check or an explicit public-route comment`, () => {
      const src = readFileSync(full, "utf8");
      const hasAuth = src.includes(AUTH_CHECK);
      const hasComment = PUBLIC_COMMENT.test(src);
      if (isAuth) {
        // auth/ endpoints are exempt; they MUST call createClient to reach Supabase
        expect(src).toContain("createClient");
        return;
      }
      expect(
        hasAuth || hasComment,
        `File \`${rel}\` has neither auth check (\`${AUTH_CHECK}\`) nor explicit public-route comment. ` +
          `Either add \`supabase.auth.getUser()\` + 401 handling, or add a comment explaining why this route is public.`,
      ).toBe(true);
    });
  }
});
```

#### What the contract test does NOT catch (and is not meant to)

- **(a)** Auth check present but not called (e.g., `import { getUser } from "..."` with no invocation). The per-handler integration tests (Risk #2) catch this.
- **(b)** RLS not enabled on the underlying table. RLS regressions require a database fixture or a code review of migrations; not in scope for this contract.
- **(c)** 401 response shape. A handler that 500s on missing auth would still pass the contract test.
- **(d)** Comment truthfulness. A handler marked `// intentionally unauthenticated` with a false justification still passes.

The test enforces *visibility* of the auth decision, not correctness. [`context/foundation/lessons.md:15-23`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/foundation/lessons.md#L15-L23) confirms this is the intent: the test is a "public data, no auth needed" decision-must-be-visible pattern, not a ban on public routes.

#### The `astro:env/server` blocker

[`src/lib/supabase.ts:3`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/lib/supabase.ts#L3) imports `{ SUPABASE_URL, SUPABASE_KEY } from "astro:env/server"` — a virtual module provided by Astro's Vite plugin. The current [`vitest.config.ts`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/vitest.config.ts#L1-L10) does NOT load that plugin. The contract test is exempt because it only reads file contents (`fs.readFileSync` on each `.ts` file); it never imports them. **The per-handler integration tests for Risks #2 and #3 will fail without `vi.mock("@/lib/supabase", ...)` at the top of each test file.** The plan must call this out — it is a per-file boilerplate, not a config change.

The plan should consider whether to add `vitest-plugin-astro` (or similar) to make the virtual module resolve. The trade-off: that plugin is heavy and pulls in a build pipeline for tests that need 10 lines of mock anyway. Recommend: keep the current Vitest config, document the `vi.mock` boilerplate in §6.2 of the test plan.

#### The request-boundary mock seam (re-stated for Risk #5)

`context/foundation/test-plan.md:43` says: "Mocking auth middleware to always return user A and only varying the URL — does not catch the case where auth is missing entirely. Mock at the request boundary, not the auth boundary." What this means concretely:

- The test passes a real `Request` (no `Cookie` header) into the handler.
- The handler's own `supabase.auth.getUser()` runs against the request.
- The mock for `createClient` returns a client whose `auth.getUser()` returns `{user: null}` when the `Cookie` header is missing — exactly what a real missing-cookie request produces.
- This catches "handler forgot the auth check entirely" because the stub does NOT bypass the handler's own check.

The anti-pattern: mocking `auth.getUser()` to always return user A's id and only varying the URL. This passes for both the bug and the fix.

## Code References

### Auth pattern (canonical, 5 duplicates)

- [`src/pages/api/assets/index.ts:9-32`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/index.ts#L9-L32) — the reference; byte-identical blocks at the 5 other authenticated handlers
- [`src/lib/supabase.ts:5-24`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/lib/supabase.ts#L5-L24) — the `createClient` factory (returns `null` if env missing)
- [`src/middleware.ts:6-25`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/middleware.ts#L6-L25) — middleware does NOT enforce auth on `/api/*` (only on `PROTECTED_ROUTES = ["/dashboard"]`)

### Risk #2 (cross-tenant)

- [`src/pages/api/assets/[id]/index.ts:79-85`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/[id]/index.ts#L79-L85) — PUT compound filter
- [`src/pages/api/assets/[id]/index.ts:149-155`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/assets/[id]/index.ts#L149-L155) — DELETE compound filter
- [`src/pages/api/snapshots/index.ts:31-35`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L31-L35) — GET filter
- [`supabase/migrations/20260529190856_initial_schema.sql:85-104`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/supabase/migrations/20260529190856_initial_schema.sql#L85-L104) — RLS policies (USING-only, no WITH CHECK)

### Risk #3 (snapshot integrity)

- [`src/pages/api/snapshots/index.ts:47-168`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L47-L168) — full POST handler
- [`src/pages/api/snapshots/index.ts:140, 156`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/snapshots/index.ts#L140) — empty-assets short-circuit; compensating delete (no try/catch)
- [`src/components/assets/NetWorthDisplay.tsx:151-156`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/components/assets/NetWorthDisplay.tsx#L151-L156) — chart consumer; load-bearing defensive re-sort
- [`src/pages/dashboard.astro:27-31`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/dashboard.astro#L27-L31) — server-side render; depends on `created_at` order
- [`src/components/NetWorthChart.tsx:50-58`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/components/NetWorthChart.tsx#L50-L58) — year-start lookup; depends on `created_at` semantics
- [`supabase/migrations/20260529190856_initial_schema.sql:46, 54-66`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/supabase/migrations/20260529190856_initial_schema.sql#L46) — `created_at` default; `snapshot_items` table has no unique constraint on `(snapshot_id, asset_id)`

### Risk #5 (auth contract)

- [`src/pages/api/rates.ts:5-6`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/pages/api/rates.ts#L5-L6) — the only public-route justification in the codebase
- [`vitest.config.ts:1-10`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/vitest.config.ts#L1-L10) — current Vitest config; does NOT load Astro's Vite plugin
- [`astro.config.mjs:17-22`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/astro.config.mjs#L17-L22) — env schema declaring `SUPABASE_URL` / `SUPABASE_KEY` as server-only, optional

## Architecture Insights

1. **The defense-in-depth is two layers with different blind spots.** RLS `USING` catches visibility (SELECT/WHERE). The handler `.eq("user_id", user.id)` catches write-scope (UPDATE/DELETE). Neither catches a maintainer adding `user_id` to the update payload — that requires a `WITH CHECK` policy OR a test pinning the payload shape. The Phase 2 plan should pin the payload shape and add a `WITH CHECK` policy as a follow-up.

2. **The compensating-delete pattern is correct but optimistic.** It works for the common failure (items insert fails, no transient infra issue on the delete). It does not work for the lesson §1 worst case (both fail). The test should pin the current behavior so a future fix is observable; whether the fix is a Postgres function, a `supabase.rpc`, or a "try-catch the delete too" change is out of scope for this phase.

3. **The chart's defensive re-sort is load-bearing.** This is a subtle finding: removing line 155 of `NetWorthDisplay.tsx` would break the chart's "newest" delta. The test should not only assert the API's `.order("created_at")` is present — it should also document this dependency somewhere. A test that says "API must order by created_at because the client depends on it" makes the constraint visible to a future refactor that wants to remove the client-side sort "for efficiency."

4. **The contract test is a small, durable artifact.** ~50 lines, no runtime dependencies beyond Node's `fs`, no virtual module resolution. It can be the first test in Phase 2 because it does not need the `astro:env` workaround. **Recommend: ship the contract test first**, then the per-handler integration tests. The contract test catches new routes immediately; the integration tests catch regressions in the existing routes.

5. **`auth/` exemption is the right call but deserves an explicit rule.** The contract test should exempt `src/pages/api/auth/` from the "must have `auth.getUser()`" rule, but the exemption itself should be a positive assertion ("the file calls `createClient`") rather than a silent skip. This way, an `auth/` route that forgets the client entirely (e.g., a signin that does no DB work) still gets flagged.

6. **The middleware is a one-way door, not a gate.** [`src/middleware.ts:6-25`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/middleware.ts#L6-L25) only enforces auth on `/dashboard`. `/api/*` is implicitly trusted to enforce its own auth in each handler. This is the architectural reason the contract test is necessary: there is no upstream safety net.

7. **The `astro:env` blocker is the project's most fragile integration seam.** [`src/lib/supabase.ts:3`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/src/lib/supabase.ts#L3) is the only file that imports from `astro:env/server` and is also used by every API handler. A future test that imports any handler imports this file and trips the virtual-module resolution. Option 1 (`vi.mock`) is the cheapest, but a long-term solution might add a small Vite alias `astro:env/server` → a real `.ts` file in the test environment, or a `setupFiles` entry that pre-loads a stub. Out of scope for this research.

8. **The auth pattern is duplicated 8 times.** The 22-line "createClient + null check + getUser + null check + 401" block repeats in `assets/index.ts` (×2), `assets/[id]/index.ts` (×2), `categories/index.ts`, `crypto-price.ts`, `snapshots/index.ts` (×2). The same argument that Phase 1 used for `convertAmount` extraction applies here: a `requireUser(request, cookies): Promise<{ user, supabase } | Response>` helper would collapse 8×22=176 lines into 8×3=24 lines and the contract test would still pass (it would look for the helper call, not for the raw `getUser()` text — but the helper itself would still call `getUser()` internally, so the substring match still works). **Out of scope for this phase** — extraction is a refactor; the test pins the current shape.

## Historical Context (from prior changes)

- [`context/changes/testing-runner-bootstrap/research.md`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/changes/testing-runner-bootstrap/research.md) — Phase 1 research. Established the `src/lib/<module>.test.ts` co-location convention (§6.1) and the `npm run test:run` script. Phase 2 must respect both. Note: the contract test does NOT co-locate — it lives at `src/pages/api/api-auth-contract.test.ts` because the surface under audit is the directory itself. The plan should call this exception out so the convention is not weakened by Phase 2.
- [`context/changes/testing-runner-bootstrap/plan.md`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/changes/testing-runner-bootstrap/plan.md) — Phase 1 plan. Confirms the canonical pattern of "extract a pure module, write tests next to it." Phase 2 does not have a pure module to extract — the existing handlers ARE the surface under audit. The plan must adapt: the per-handler tests live next to the handlers (or in a sibling test directory if the plan chooses to centralize).
- [`context/foundation/lessons.md:1-13`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/foundation/lessons.md#L1-L13) — lesson §1: "DB multi-table writes must be atomic." Cited by Risk #3. The lesson is from the original `snapshots/index.ts` bug (no compensating delete at all). The current code has the compensating delete; this phase extends the lesson by pinning the worst-case behavior with a test.
- [`context/foundation/lessons.md:15-23`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/foundation/lessons.md#L15-L23) — lesson §2: "Public API endpoints need explicit auth decisions." Cited by Risk #5. The lesson identifies `rates.ts` as the precedent. Phase 2 ships the test that enforces this rule.
- [`context/foundation/test-plan.md:25-47`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/foundation/test-plan.md#L25-L47) — §2 risk map; the source of truth for risks #2, #3, #5. The plan phase must read this to align test scenarios with the plan's own guidance ("Integration test on the handler with a stubbed Supabase user, asserting the WHERE clause includes the caller's user_id").
- [`context/foundation/test-plan.md:43`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/foundation/test-plan.md#L43) — the "mock at the request boundary" rule. Phrased as the anti-pattern; this research re-frames it positively.
- **Prior change artifacts:**
  - `context/changes/dashboard-snapshots-chart/` — S-02 added `/api/snapshots` and the chart that reads from the `snapshots` table. The auth pattern at `src/pages/api/snapshots/index.ts:12-29` and `:47-64` was established in this change. No test was added.
  - `context/changes/asset-management/` — S-01 added `/api/assets` and `/api/assets/[id]`. The auth pattern at `src/pages/api/assets/index.ts:9-32` and `src/pages/api/assets/[id]/index.ts:10-33, :113-136` was established here. No test was added.
  - `context/changes/rates-crypto-fetch/` — S-03 added `/api/rates` (the only public route) and `/api/crypto-price` (authenticated). The explicit "intentionally unauthenticated" comment at `src/pages/api/rates.ts:5-6` was added in this change — that is the precedent the contract test must preserve.

## Related Research

- [`context/changes/testing-runner-bootstrap/research.md`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/context/changes/testing-runner-bootstrap/research.md) — Phase 1 research (the only sibling research artifact). Establishes the co-location convention and Vitest install shape that Phase 2 inherits.

## Open Questions

1. **Should the Phase 2 plan also add a `WITH CHECK` migration to the four user-owned policies?** The `USING`-only gap is real and the test pins the handler-side defense. A migration adding `WITH CHECK (auth.uid() = user_id)` would close the gap at the database layer. Out of scope for "tests that protect code" but a reasonable sibling change. Recommend: track in a follow-up issue, not in this phase.

2. **Is the empty-assets behavior intentional?** `assets.length === 0` still creates a parent snapshot with `total_net_worth: 0`. The chart would render a single zero point at the click of the "Save snapshot" button on a fresh account. Test scenario 6 pins the current behavior; the plan should ask the product team whether this is desired.

3. **Should the `getRates` mock in the snapshot test follow the "never mock internal modules" policy by going through MSW?** `getRates` is an internal module (in-process, not a public API). The plan's §6.2 policy says to mock at the network edge. `getRates` reads `crypto_price_cache` (a real Supabase table) — the cleanest seam is MSW against the postgrest endpoint. The plan must decide: bend the policy with `vi.mock("@/lib/exchange-rates", ...)` for one test, or set up MSW for the whole `snapshots` test file. **Recommend: bend the policy.** MSW for a single helper is overkill; the `vi.mock` is two lines.

4. **Where does the contract test live in CI?** §5 says "required after §3 Phase 2." The Phase 4 (gates) phase will wire `npm run test:run` into CI. The contract test runs under that script automatically (Vitest discovery is `src/**/*.test.ts` per [`vitest.config.ts:7`](https://github.com/mkozachuk/bitworth/blob/f0d3c21830914429c4315026c8df9c77e391c927/vitest.config.ts#L7)). No config change needed.

5. **What is the right name for the contract test file?** Three options: `api-auth-contract.test.ts`, `api-routes.test.ts`, `auth-coverage.test.ts`. Recommend `api-auth-contract.test.ts` — matches the lesson's "explicit auth decision" phrasing.

6. **Should the plan flag the orphan-row case in the snapshot test as a TODO?** Scenario 3 (items + delete both fail) currently produces a silent orphan + 500 response. The test pins this. The plan should add a `// TODO: replace with a Postgres function` comment in the test so a future maintainer sees the intent.

7. **The `(snapshot_id, asset_id)` uniqueness gap.** Two concurrent POSTs can duplicate items. Not in the risk map. Out of scope for Phase 2, but should be flagged for the team.

8. **Should the contract test's `it` blocks be a flat list (one per file) or grouped?** The flat list shows up as 9 separate test cases in the reporter, which is more visible but longer. Recommendation: flat — Vitest's reporter renders each `it` block by full title (file name included), and the `it.each(files)` pattern reads naturally.

9. **Should the contract test assert that the `auth/` files DO call `createClient`?** The current three do. If a future `auth/foo.ts` shipped without it, the test would catch it. The recommendation is YES — encode it as a positive assertion in the `isAuth` branch.

10. **Should the contract test also walk `src/pages/` for Astro pages that POST to `/api/*`?** No — pages are rendered in the browser, the API is the trust boundary. Astro pages are out of scope for this contract.
