---
title: BitWorth — Anti-Corruption Layer Refactor Plan (Supabase SDK)
created: 2026-06-18
type: refactor-plan
---

# BitWorth — Anti-Corruption Layer Refactor Plan

> **Deliverable: a PLAN, not an implementation.** No production code is changed here.
> Builds on `context/domain/01-domain-distillation.md` and `02-invariant-aggregate-refactor.md`.
> Focus: a **leaking external dependency** that crosses layer boundaries. Method: discovery → identification →
> classification → diagnosis → design. Which dependency leaks worst was **discovered**, not assumed — every `file:line`
> below was re-verified against the working tree.

---

## STEP 0 — Discovered context

**Product.** BitWorth — a privacy-first net worth tracker (Astro v6 SSR + React 19 islands, Supabase for
Postgres + Auth + RLS, Cloudflare Workers). Source docs read: `prd.md`, `net-worth-tracker-mvp.md`,
`tech-stack.md`, `README.md`, plus the two prior domain artifacts.

**External dependencies in the manifest (`package.json`) that could cross boundaries.** The candidates that
actually appear in more than one layer:

| Dependency | Kind | Where it appears |
|---|---|---|
| `@supabase/ssr` + `@supabase/supabase-js` | Persistence + Auth SDK | bootstrap, middleware, **domain `lib/`**, every API route, **Astro pages**, **wire types** (`env.d.ts`) |
| `frankfurter.app` / CoinGecko | external HTTP APIs (raw `fetch`, not packages) | `lib/exchange-rates.ts`, `lib/crypto-prices.ts` only |
| `recharts` | charting | UI only (`NetWorthChart.tsx`, `fire/FireProjectionChart.tsx`) |
| `lucide-react`, `@radix-ui/*` | UI primitives | UI only |

**Swappability declarations found in the docs (intent vs. code — a strong signal).**
The PRD **explicitly declares the rate and crypto providers interchangeable**:

- Open Question #2: *"Exchange rate API — Which free public API…? Popular options: exchangerate.host,
  frankfurter.app, Open Exchange Rates"* (`prd.md:151`).
- Open Question #3: *"Crypto price API — Which free public API…? Popular options: CoinGecko, CoinCap,
  CryptoCompare"* (`prd.md:152`).
- NFR: *"External API calls (exchange rates, crypto prices) fail gracefully with cached or fallback values"*
  (`prd.md:125`).

No doc declares **Supabase** swappable. But the decisive twist surfaces below: the two services the docs *do*
promise are swappable (`getRates`, `getPrice`) are themselves welded to the Supabase type — so the leak that
hurts most is the one nobody marked as a boundary.

**Library contract confirmed via Supabase docs (Context7, `/supabase/supabase`).** `@supabase/ssr` ships two
distinct factories on purpose — `createServerClient` (server) and `createBrowserClient` (client) — and the typed
client is `SupabaseClient<Database>` with the generated `Database` type. This is the official contract and it is
exactly what the ACL must encapsulate, not spread.

---

## STEP 1 — IDENTIFY the leaking dependencies

A dependency *leaks* when knowledge of its concrete shape (imports, types, query builder, error types) crosses a
layer boundary instead of sitting behind one seam. The Supabase SDK leaks through **six** distinct surfaces.

### L1 — Client factory exists for BOTH sides of the client/server boundary
- Server: `src/lib/supabase.ts:1` (`import { createServerClient } from "@supabase/ssr"`), instantiated at `:9`.
- Browser: `src/lib/supabase-browser.ts:1` (`import { createBrowserClient } from "@supabase/ssr"`), instantiated
  at `:10` as a typed `createBrowserClient<Database, "public">`. (Currently it has **no caller** in
  `src/components/` — auth is done server-side — so it is a *loaded* client-bundle entry point: the same vendor
  SDK is wired for both sides of the boundary even though only the server side is used today.)

### L2 — Middleware speaks SDK directly (auth + a raw table query)
`src/middleware.ts:2` imports `createClient`; `:7` builds it; `:12` calls `supabase.auth.getUser()`; `:21-25`
runs a raw `supabase.from("user_preferences").select(...).eq(...).maybeSingle()` and hand-casts the row at `:26`.

### L3 — Domain `lib/` services take `SupabaseClient` IN THEIR SIGNATURE (the worst leak)
These are the **Generic subdomain** services the PRD calls swappable — yet they are typed to the persistence vendor:
- `src/lib/exchange-rates.ts:1` `import type { SupabaseClient }`; in signatures at `:13`, `:26`, `:46`
  (`getRates(supabase: SupabaseClient)`); raw queries `.from("exchange_rate_cache")` at `:14`, `:31`.
- `src/lib/crypto-prices.ts:1` `import type { SupabaseClient }`; in signatures at `:74`, `:97`, `:115`, `:124`;
  raw query `.from("crypto_price_cache")` at `:101`.

### L4 — Every API route re-derives and drives the SDK
`createClient(request.headers, cookies)` is repeated across **~12** route handlers, each followed by an
`await supabase.auth.getUser()` + 401 block and direct `.from(...)`:
`api/assets/index.ts:2,10,23,35,60,118`, `api/assets/[id]/index.ts:2,11,24,80,114,127,150`,
`api/snapshots/index.ts:2,13,23,48,58,68,81,112,153,156`, `api/user-preferences/index.ts:2,105,112,118,135,142,182`,
`api/categories/index.ts:2,9,22,34`, `api/rates.ts:2,8`, `api/crypto-price.ts:2,10,23`,
`api/auth/signin.ts:2,9,13`, `api/auth/signup.ts:2,9,13`, `api/auth/signout.ts:2,5,7`.

### L5 — Astro **pages** (render layer) query the database directly
The SSR page layer bypasses the API entirely and talks to the SDK:
`dashboard.astro:3,19,22,27`, `dashboard/fire.astro:3,18,21,38`, `dashboard/settings.astro:4,18,21`,
`dashboard/assets/index.astro:3,18,22`, `dashboard/assets/[id]/edit.astro:3,13,21`. Each does
`createClient(Astro.request.headers, Astro.cookies)` then `.from("assets" | "user_preferences" | "snapshots")`.

### L6 — Library types in the wire / shared contract
- **Auth identity:** `src/env.d.ts:3` types `App.Locals.user` as `import("@supabase/supabase-js").User`. Because
  `locals.user` is read by middleware, every page, and the topbar, the **entire app transitively depends on the
  supabase-js `User` shape** through `Locals`.
- **Persistence error type:** `PostgrestError` is imported into route signatures —
  `api/assets/[id]/index.ts:4,149` and `api/snapshots/index.ts:6`.
- **Row type as DTO:** the generated `Tables<"assets">` is returned as the API response body
  (`api/assets/[id]/index.ts:3,107`), so the wire contract = the database schema shape.

---

## STEP 2 — CLASSIFY and select #1

Three axes: **(a)** how many layers/files it touches, **(b)** cost/risk of swapping the library today, **(c)**
whether the docs declare it swappable (an intent-vs-code gap is a strong "this should have been a boundary" signal).

| Dependency | (a) Layers / files touched | (b) Swap cost today | (c) Declared swappable? | Verdict |
|---|---|---|---|---|
| **Supabase SDK** | **6 surfaces** — bootstrap, middleware, domain lib, ~12 API routes, ~5 Astro pages, wire/env types. ~30+ files. | **Catastrophic** — auth + queries + RLS assumptions + generated types + error types are all inlined; no seam to swap behind. | No doc says so — but the gap *is* the problem (see below). | **← #1** |
| HTTP rate/crypto providers | 2 files (`exchange-rates.ts`, `crypto-prices.ts`) | Low-medium — already isolated `fetch` calls with fallback | **Yes, explicitly** (`prd.md:151-152`) | #2 |
| `recharts` | 2 UI files, one layer | Low | No | leave |
| `lucide-react` / `@radix-ui` | UI only | Low | No | leave |

**Chosen #1 — the Supabase SDK.** It is the worst leak on the decisive combination of axes:

1. **Breadth (a).** It is the *only* dependency that crosses **every** layer, including the two it never should:
   the **domain `lib/` signatures** (L3) and the **wire contract** (L6). The HTTP providers, by contrast, are
   already corralled into two files.
2. **The intent-vs-code inversion (c), used precisely.** The docs promise the rate/crypto providers are swappable
   (#2/#3) — but `getRates`/`getPrice` take a `SupabaseClient` parameter (L3). So the dependency the docs *did*
   mark as a boundary is structurally chained to the dependency nobody marked. You cannot honor the declared
   swap (frankfurter → exchangerate.host) cleanly while the "swappable" service is typed to the persistence
   vendor. **Fixing the Supabase leak is the precondition for delivering the swappability the PRD already
   promised.** That makes Supabase the highest-leverage boundary, not a competing one.
3. **Risk (b).** With the SDK inlined into ~30 files, any Supabase change — a client API bump, a move off
   Supabase Auth, a different Postgres host — is a 30-file edit with no compiler-enforced seam.

The HTTP-provider leak (#2) is real but small and already half-contained; this plan absorbs it as a
**sub-boundary inside the same ACL** (STEP 4.5), since the rate/crypto cache *is* persistence.

---

## STEP 3 — DIAGNOSIS

### 3.1 Duplication — the same SDK incantation, copy-pasted
- **Client construction** `createClient(headers, cookies)` appears in **~12 route files + ~5 Astro pages +
  middleware** (full list in L4/L5). Seventeen-plus identical bootstraps.
- **Auth gate** `const { data: { user } } = await supabase.auth.getUser()` followed by an `if (!user) → 401`
  block is duplicated across **~10 handlers** (e.g. `api/assets/index.ts:23,73`, `api/assets/[id]/index.ts:24,127`,
  `api/snapshots/index.ts:23,58`, `api/user-preferences/index.ts:112,142`, `api/categories/index.ts:22`).
- **Raw query builder** `.from("<table>")…` is written in **~20 call sites** across 4 layers (the `.from(` list:
  middleware, both lib services, 5 Astro pages, 6 API files).

### 3.2 Cross-boundary danger — server SDK config wired for the client bundle
`src/lib/supabase-browser.ts:10` instantiates `createBrowserClient<Database, "public">` — a code path intended
to run in the browser, importing `SUPABASE_URL`/`SUPABASE_KEY` (`:2`). It has no consumer in `src/components/`
today, so it is dead-but-armed: a future React island importing it pulls the vendor SDK and the typed schema into
the client bundle. The same vendor lives on **both** sides of the client/server line with no single owner of
which side is allowed.

### 3.3 Library types in domain signatures (the leak with teeth)
`getRates(supabase: SupabaseClient)` (`exchange-rates.ts:46`) and the crypto cache helpers
(`crypto-prices.ts:74,97,115,124`) are **Generic-subdomain** functions whose only persistence need is
"read/write a cache row." Typing them to `SupabaseClient` means:
- a unit test must fabricate a `SupabaseClient` (it does — `exchange-rates.test.ts:8` casts a mock
  `as unknown as SupabaseClient`, and the same `asClient` trick recurs in `crypto-prices.test.ts:8`; the
  pattern is logged in memory as the `asClient` cast helper);
- the declared provider swap (`prd.md:151-152`) cannot be done without touching code typed to the database vendor.

### 3.4 Library types in the wire contract
- `App.Locals.user: import("@supabase/supabase-js").User` (`env.d.ts:3`) makes the **auth identity shape a
  vendor type** shared by middleware, every page, and `Topbar`. Replacing Supabase Auth would ripple through the
  whole app via `Locals`.
- `PostgrestError` in route signatures (`api/assets/[id]/index.ts:149`, `api/snapshots/index.ts:6`) leaks the
  persistence error model into the HTTP layer, which then maps it by hand into the project error shape.
- `Tables<"assets">` returned as the response body (`api/assets/[id]/index.ts:107`) equates the **public API DTO
  with the raw DB row** — schema and wire are the same object.

**Diagnosis summary.** The persistence/auth vendor is not behind a boundary; it *is* the boundary. Its client,
its query builder, its row types, its error type, and its auth `User` are inlined across bootstrap, middleware,
domain services, ~12 routes, ~5 pages, and the shared `Locals` contract. The one swap the docs explicitly promise
is blocked by it. Fail-leaky at every layer.

---

## STEP 4 — DESIGN the Anti-Corruption Layer

Goal: make **one directory** the single place that knows the word "supabase". Everything else depends on narrow
**domain ports** and domain **value objects**, never on `@supabase/*`.

New home: `src/lib/persistence/` (adapter) + `src/lib/domain/` (ports, VOs, errors — the same `domain/` folder
that doc 02 introduces for `Money`/`Snapshot`; this plan and that one share it).

### 4.1 Domain value objects — the only shapes the app knows

```ts
// src/lib/domain/identity.ts
export interface UserIdentity {        // replaces supabase-js `User` everywhere outside the adapter
  readonly id: string;
  readonly email: string | null;
}

// src/lib/domain/errors.ts
export class PersistenceError extends Error {            // replaces PostgrestError at the boundary
  constructor(readonly code: string, message: string, readonly context?: unknown) { super(message); }
}
export class NotFoundError extends PersistenceError {}
export class NotAuthenticatedError extends PersistenceError {}
```

`UserIdentity` is mapped **once**, from supabase-js `User`, inside the adapter. `App.Locals.user` becomes
`UserIdentity | null` (`env.d.ts` no longer imports `@supabase/*`).

### 4.2 Narrow ports — the domain interfaces (no Supabase in sight)

```ts
// src/lib/domain/ports.ts
export interface AuthGateway {
  currentUser(): Promise<UserIdentity | null>;
  signInWithPassword(email: string, password: string): Promise<void>;   // throws NotAuthenticatedError
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface AssetRepository {
  listForUser(userId: string): Promise<Asset[]>;
  create(userId: string, draft: AssetDraft): Promise<Asset>;
  update(userId: string, id: string, patch: AssetPatch): Promise<Asset>;   // throws NotFoundError
  delete(userId: string, id: string): Promise<void>;                       // throws NotFoundError
}
export interface SnapshotRepository { /* save(Snapshot) atomic; listForUser — see doc 02 §4.4 */ }
export interface UserPreferencesRepository {
  get(userId: string): Promise<UserPreferences | null>;                    // feeds middleware (L2)
  upsert(userId: string, patch: UserPreferencesPatch): Promise<UserPreferences>;
}
export interface RateCache {  read(): Promise<CachedRates | null>;  write(rates: CachedRates): Promise<void>; }
export interface CryptoPriceCache { read(symbol): Promise<CachedPrice | null>; write(p: CachedPrice): Promise<void>; }

// One injection surface, built once per request in middleware and put on locals:
export interface DataAccess {
  auth: AuthGateway;
  assets: AssetRepository;
  snapshots: SnapshotRepository;
  preferences: UserPreferencesRepository;
  rates: RateCache;
  cryptoPrices: CryptoPriceCache;
}
```

The rest of the codebase imports **only** these interfaces and the domain VOs. `Asset`, `AssetDraft`,
`UserPreferences`, etc. are domain types owned by `domain/`, **not** `Tables<...>` — that severs L6's DTO leak.

### 4.3 The adapter — the ONLY module importing `@supabase/*`

```ts
// src/lib/persistence/supabase/client.ts   (the single SDK seam — both sides live here, one owner)
import { createServerClient, createBrowserClient, parseCookieHeader } from "@supabase/ssr";
import type { Database } from "./database.types";        // generated types confined to this folder
export type Db = SupabaseClient<Database>;               // typed client per Supabase docs
export function serverClient(headers: Headers, cookies: AstroCookies): Db | null { /* moved from lib/supabase.ts */ }
export function browserClient(): Db | null { /* moved from lib/supabase-browser.ts — kept server-folder-internal */ }

// src/lib/persistence/supabase/auth-gateway.ts
export class SupabaseAuthGateway implements AuthGateway {
  constructor(private db: Db) {}
  async currentUser(): Promise<UserIdentity | null> {
    const { data: { user } } = await this.db.auth.getUser();
    return user ? { id: user.id, email: user.email ?? null } : null;     // map vendor User → UserIdentity (L6)
  }
  async signInWithPassword(email, password) {
    const { error } = await this.db.auth.signInWithPassword({ email, password });
    if (error) throw new NotAuthenticatedError("SIGNIN_FAILED", error.message);   // PostgrestError never escapes
  }
  /* signUp / signOut similar */
}

// src/lib/persistence/supabase/asset-repository.ts
export class SupabaseAssetRepository implements AssetRepository {
  constructor(private db: Db) {}
  async listForUser(userId: string): Promise<Asset[]> {
    const { data, error } = await this.db.from("assets").select("*, category:asset_categories(*)").eq("user_id", userId);
    if (error) throw mapError(error);                    // PostgrestError → PersistenceError, in one place
    return (data ?? []).map(toAsset);                    // Row → domain Asset, in one place
  }
  /* create/update/delete: map drafts → Insert/Update rows; map errors; return domain Asset */
}
```

`mapError(e: PostgrestError): PersistenceError` and `toAsset(row): Asset` are the **only** translators; the
`as unknown as SupabaseClient` test casts (§3.3) disappear — tests now implement the port with a plain object.

### 4.4 Wiring (composition root) — built once in middleware

```ts
// src/middleware.ts  (after refactor)
const db = serverClient(request.headers, cookies);
const data: DataAccess | null = db ? buildSupabaseDataAccess(db) : null;   // the ONLY call to the adapter factory
context.locals.data = data;
context.locals.user = (await data?.auth.currentUser()) ?? null;            // UserIdentity, not vendor User
context.locals.displayCurrency = (await data?.preferences.get(user.id))?.displayCurrency ?? null;  // replaces raw .from() at L2
```

API routes and Astro pages then read `locals.data.<repo>` — no route or page ever imports `@supabase/*` or calls
`createClient` again.

### 4.5 Folding in the declared-swappable HTTP providers (#2)
The rate/crypto cache lives in the same ACL because it *is* persistence. The `fetch` to frankfurter/CoinGecko
becomes a port too, so the PRD-declared swap (`prd.md:151-152`) touches exactly one adapter:

```ts
// src/lib/domain/ports.ts
export interface RateProvider { latest(base: Currency): Promise<Record<Currency, number>>; }   // swappable per #2
// src/lib/persistence/http/frankfurter-rate-provider.ts   ← the ONLY file that knows "frankfurter.app"
export class FrankfurterRateProvider implements RateProvider { /* the fetch from exchange-rates.ts:61-66 */ }
```

`getRates` (`exchange-rates.ts:46`) becomes `getRates(cache: RateCache, provider: RateProvider)` — **no
`SupabaseClient` in the signature** (kills L3). Swapping to `exchangerate.host` = add one `RateProvider`
adapter; swapping the cache store = one `RateCache` adapter. **This is where Open Questions #2/#3 get encoded —
in the adapter, never in the API layer.**

---

## STEP 5 — Proof of isolation + before/after

### 5.1 Isolation proof (the success criterion)
After the refactor, `grep -rn "@supabase/" src` must return **only files under `src/lib/persistence/supabase/`**.

| File that knows Supabase TODAY | After refactor |
|---|---|
| `lib/supabase.ts`, `lib/supabase-browser.ts` | moved → `persistence/supabase/client.ts` (only home) |
| `middleware.ts:2,12,21` | knows only `DataAccess`; builds adapter via one factory call |
| `lib/exchange-rates.ts:1,13,26,46`, `lib/crypto-prices.ts:1,74,97,115,124` | take `RateCache`/`CryptoPriceCache` + `RateProvider` ports — **no SDK type** |
| `api/**/*.ts` (12 files) | read `locals.data.*`; **zero** `@supabase/*` imports, **zero** `createClient`, **zero** `.from()` |
| `dashboard*.astro`, `settings.astro`, `assets/*.astro` (5 pages) | read `locals.data.*` repositories |
| `env.d.ts:3` (`User`), `api/.../index.ts` (`PostgrestError`, `Tables<>`) | `UserIdentity`, `PersistenceError`, domain types — **no vendor types on the wire** |

### 5.2 Before / after (representative leak sites)

| Site | Before | After |
|---|---|---|
| `middleware.ts:21-26` | raw `supabase.from("user_preferences").select(...).maybeSingle()` + hand-cast | `await locals.data.preferences.get(userId)` → typed `UserPreferences` |
| `api/assets/[id]/index.ts:79-85` | `supabase.from("assets").update(...).eq(...).select().single()` | `locals.data.assets.update(userId, id, patch)` |
| `api/assets/[id]/index.ts:149` | `error: PostgrestError` in route | adapter maps to `PersistenceError`; route catches domain error |
| `api/assets/[id]/index.ts:107` | returns `data as Tables<"assets">` | returns a domain `Asset` DTO (schema ≠ wire) |
| `exchange-rates.ts:46` | `getRates(supabase: SupabaseClient)` | `getRates(cache: RateCache, provider: RateProvider)` |
| `dashboard.astro:22` | `supabase.from("assets").select(...)` in the render path | `locals.data.assets.listForUser(user.id)` |
| `env.d.ts:3` | `user: ...supabase-js.User` | `user: UserIdentity` |

The **UI** (React islands + Astro pages) receives ready-made domain objects (`Asset`, `UserPreferences`,
`UserIdentity`), never a raw Supabase row or client.

### 5.3 Open questions resolved against the library contract
- **Where does the SDK run?** Per `@supabase/ssr` docs (Context7 `/supabase/supabase`), `createServerClient` and
  `createBrowserClient` are intentionally separate. Decision: **only the server factory is wired**; the browser
  factory stays internal to `persistence/supabase/` with no exported consumer (closes §3.2). Encode this in the
  adapter, not in routes.
- **Typed client.** Use `SupabaseClient<Database>` (= `Db`) confined to the adapter; the generated
  `database.types.ts` moves under `persistence/supabase/` so `Database`/`Tables<>` never leak outward.
- **Provider choice (#2/#3).** Encode the concrete `frankfurter.app` / CoinGecko URLs in `RateProvider` /
  `CryptoPriceProvider` adapters (§4.5) — **the ACL, not the API layer.**

---

## STEP 6 — Verification + phased plan

### 6.1 Verification (objective)
1. `grep -rn "@supabase/" src` → only `src/lib/persistence/supabase/**`. (Today: `env.d.ts:3`,
   `lib/supabase*.ts`, `lib/exchange-rates.ts`, `lib/crypto-prices.ts`, `api/snapshots/index.ts:6`,
   `api/assets/[id]/index.ts:4`, plus the test casts — **all** must clear.)
2. `grep -rn "createClient(" src/pages src/middleware.ts` → empty (routes/middleware no longer build the client).
3. `grep -rn "\.from(\"" src` → only inside `src/lib/persistence/**`.
4. No `Tables<` / `PostgrestError` / `SupabaseClient` / supabase-js `User` outside the adapter.
5. `npm run typecheck` + the existing Vitest suite green; the `as unknown as SupabaseClient` casts
   (`exchange-rates.test.ts:8`, `crypto-prices.test.ts:8`) are **deleted** in favor of plain port fakes.

### 6.2 Phased plan (project convention: test-first where it bites; one change-folder via `/10x-new`)
- **Phase 0 — Ports & VOs.** Add `domain/identity.ts`, `domain/errors.ts`, `domain/ports.ts`, domain entity types
  (`Asset`, `UserPreferences`, …). Pure, no SDK. Unit-tested. *(test-first)*
- **Phase 1 — Adapter package.** Move `lib/supabase*.ts` + `database.types.ts` under `persistence/supabase/`;
  implement `SupabaseAuthGateway` + repositories + `mapError`/`toX` translators; `buildSupabaseDataAccess`. *(test-first: port-conformance tests using the existing mock harness, now behind the port)*
- **Phase 2 — Composition root.** Build `DataAccess` in `middleware.ts`; set `locals.data`; change `locals.user`
  to `UserIdentity`; update `env.d.ts`. Replace the raw `user_preferences` query (L2).
- **Phase 3 — Drain the API routes.** Repoint all ~12 handlers to `locals.data.*`; delete every `createClient`,
  `.from()`, `PostgrestError`, and `Tables<>`-as-DTO. *(test-first: the existing per-route suites pin behavior;
  `api-auth-contract.test.ts` guards the 401 path now centralized in `AuthGateway`)*
- **Phase 4 — Drain the Astro pages.** Repoint the 5 dashboard pages to `locals.data.*`.
- **Phase 5 — Generic services + HTTP sub-boundary.** Re-type `getRates`/`getPrice` to `RateCache`/`RateProvider`
  (and crypto equivalents); add the HTTP provider adapters (§4.5); delete the `SupabaseClient` casts in their tests.
- **Phase 6 — Lock it.** Add the `grep` checks (6.1) as a CI guard / lint rule and register the new contracts in
  `lessons.md`: *the only directory allowed to import `@supabase/*` is `src/lib/persistence/`.*

---

## Summary

BitWorth's worst boundary leak is the **Supabase SDK** (`@supabase/ssr` + `@supabase/supabase-js`): it is the only
dependency that crosses every layer, and two it never should — the **domain `lib/` signatures**
(`getRates(supabase: SupabaseClient)`, `exchange-rates.ts:46`; the crypto cache, `crypto-prices.ts:74-124`) and the
**wire contract** (the supabase-js `User` baked into `App.Locals`, `env.d.ts:3`; `PostgrestError` in route
signatures; `Tables<"assets">` returned as the API body, `api/assets/[id]/index.ts:107`). The client factory is
duplicated across ~17 server entry points, raw `.from(...)` queries appear in ~20 sites spanning middleware, both
generic services, five Astro pages, and six API files, and a browser-client factory (`supabase-browser.ts`) arms the
client bundle with the same vendor SDK. The decisive signal is an intent-vs-code inversion: the PRD explicitly
declares the exchange-rate and crypto providers swappable (`prd.md:151-152`), yet those very "swappable" services
are typed to the persistence vendor — so honoring the promised swap is blocked until Supabase sits behind a seam.
The plan introduces an Anti-Corruption Layer: narrow domain ports (`AuthGateway`, `AssetRepository`,
`RateProvider`, …) and value objects (`UserIdentity`, `PersistenceError`, domain entities) that the whole app
depends on, with a single `src/lib/persistence/` adapter as the only module importing `@supabase/*`, mapping rows
↔ domain objects and `PostgrestError` ↔ named domain errors. The success criterion is objective —
`grep -rn "@supabase/" src` returns only files under the adapter directory — and the work is sequenced test-first
across seven phases against the existing Vitest suite, ending with a CI guard that keeps the boundary sealed.
