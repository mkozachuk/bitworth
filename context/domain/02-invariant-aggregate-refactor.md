---
title: BitWorth — Invariant Guardian Aggregate Refactor Plan (Snapshot)
created: 2026-06-18
type: refactor-plan
---

# BitWorth — Invariant Guardian Aggregate Refactor Plan

> **Deliverable: a PLAN, not an implementation.** No production code is changed here.
> Builds on `context/domain/01-domain-distillation.md`. Every `file:line` below was re-verified against the
> working tree before being cited. Method: discovery → identification → classification → diagnosis → design.

---

## STEP 0 — Discovered context (confirmed)

**Product.** BitWorth is a privacy-first net worth tracker. The user enters balances in several currencies and
categories; the app consolidates them into **one number** in a display currency, then compares that number against
the previous month and January 1st with a trend chart (`prd.md:18-22,30,39-40`; `net-worth-tracker-mvp.md:5-8`).

**Where business logic lives (re-confirmed by reading the files):**

- **Pure domain helpers:** `src/lib/net-worth.ts` (`convertAmount` `:18-27`, `computeNetWorth` `:40-56`), `src/lib/fire.ts`, `src/lib/exchange-rates.ts`, `src/lib/crypto-prices.ts`.
- **API / orchestration + persistence:** `src/pages/api/snapshots/index.ts`, `.../assets/`, `.../user-preferences/`.
- **Persistence / schema:** `supabase/migrations/20260529190856_initial_schema.sql` (tables `snapshots` `:42-51`, `snapshot_items` `:54-66`).
- **UI islands:** `src/components/assets/NetWorthDisplay.tsx`, `src/components/NetWorthChart.tsx`.
- **Test discipline (relevant to STEP 5):** Vitest is the runner (`package.json:14-16`, `vitest.config.ts`), there is a Supabase mock harness (`@/test-utils/supabase-mock`), and a risk-based test-plan already covers this exact handler with 11 scenarios (`src/pages/api/snapshots/index.test.ts:72-285`). The project is **test-capable and test-disciplined** → phases that touch the domain/API go **test-first**.
- **Known-debt register:** `context/foundation/lessons.md` already records two of the defects this plan fixes — *"DB multi-table writes must be atomic"* and *"(snapshot_id, asset_id) has no unique constraint"*.

---

## STEP 1 — Business invariants (identified from docs AND code)

Rules that MUST always hold in this domain. Source cited for each.

| ID | Invariant (always true) | Source |
|---|---|---|
| **INV-A** | **Currency homogeneity.** Two net-worth figures may only be compared, summed, or shown side-by-side when expressed in the **same** currency. A delta is undefined across currencies. | FR-011 "All totals are shown in this currency" `prd.md:105`; FR-014/015 `prd.md:108-109`; business-logic statement "always in one currency, always compared to history" `prd.md:130-132` |
| **INV-B** | **Snapshot total ↔ items consistency.** A snapshot's `total_net_worth` equals the **signed** sum of its items (assets positive, liabilities negative), all in the snapshot's `display_currency`. | FR-014 `prd.md:108`; non-goal #7 "snapshot values are stored with converted amounts… rate captured implicitly" `prd.md:146` |
| **INV-C** | **Snapshot atomicity & immutability.** A snapshot and its items are written all-or-nothing, and once written are a frozen historical record (rates captured implicitly). | Atomicity lesson `lessons.md` §"DB multi-table writes must be atomic"; immutability implied by `prd.md:146` |
| **INV-D** | **Liability sign.** An entry in a liability category is subtracted from net worth. | FR-010 `prd.md:102`; "treated as negative" `net-worth-tracker-mvp.md:49` |
| **INV-E** | **Single computation rule.** "Net worth = Σ converted assets − Σ converted liabilities" is one rule with one definition. | Business-logic section `prd.md:128-132`; the `computeNetWorth` TODO admitting duplication `net-worth.ts:29-38` |
| **INV-F** | **Currency domain.** Every currency value ∈ {PLN, USD, EUR}. | FR-006/011 `prd.md:98,105`; CHECK `initial_schema.sql:46` |

---

## STEP 2 — Classification and selection of #1

Three axes per invariant: **(a) how core** to the product's meaning, **(b) how smeared** across layers, **(c) actually enforced / merely declared / violable.**

| ID | (a) Core? | (b) Smeared across | (c) Enforcement today | Verdict |
|---|---|---|---|---|
| **INV-A** Currency homogeneity | **Highest** — deltas-over-time are the reason to exist vs. a spreadsheet (`roadmap.md:24`, `prd.md:39`) | UI delta math + snapshots table + currency preference (3 layers) | **VIOLABLE — zero enforcement.** Delta = raw subtraction of `total_net_worth` with **no `display_currency` check** (`NetWorthDisplay.tsx:165-166`). The client is the *only* place a delta exists, and it doesn't guard. | **← #1** |
| INV-B Total↔items | High | snapshots API compute loop + items insert + schema | **Declared, unverifiable.** `snapshot_items` stores no sign/`is_liability` (`initial_schema.sql:54-66`) → total cannot be reconstructed from children; no check that `total == Σ items`. | #2 |
| INV-C Atomicity | High (data integrity) | API + DB | **Declared (compensating delete only).** `snapshots/index.ts:155-156`; survives an items-insert error, not a crash between writes (`lessons.md` §1). | #3 |
| INV-D Liability sign | High | net-worth.ts + snapshots API + UI | **Declared, derived at read.** Sign never stored; recomputed from `category.is_liability` in 3 places. | folded into B |
| INV-E Single rule | High | `net-worth.ts:40-56`, `snapshots/index.ts:97-107`, `NetWorthDisplay.tsx:137-149` | **Declared, triplicated.** Three copies; drift latent. | prerequisite |
| INV-F Currency domain | Medium | DB + API | **Enforced.** CHECK constraints. | leave |

**Chosen #1 invariant — INV-A (Currency homogeneity), with INV-B/C/D/E as the supporting invariants the same aggregate must protect to make INV-A *trustworthy*.**

**Why INV-A.** It scores worst on the decisive combination: it is the **most core** (the product's promise is "watch the one number move over time" — `prd.md:30,39-40`) and the **least enforced** (literally no code anywhere asserts that two compared figures share a currency). The other invariants are at least *declared* in code; INV-A is *absent*. And INV-A is only meaningful if INV-B holds (you can't trust a homogeneous delta if the totals themselves aren't reconstructable) and INV-C holds (you can't trust a record that may be half-written) — so guarding INV-A pulls B, C, D, E along with it. That makes the `Snapshot` aggregate the single highest-leverage guardian.

---

## STEP 3 — Diagnosis of INV-A (and its dependents)

Where the rule lives today, layer by layer, with verified citations.

### 3.1 The delta — the violation site (INV-A)
`src/components/assets/NetWorthDisplay.tsx:152-181`. Snapshots are sorted by date, then:

```
const deltaLM = lastMonthSnap ? current.total_net_worth - lastMonthSnap.total_net_worth : null;   // :165
const deltaJ  = janSnap       ? current.total_net_worth - janSnap.total_net_worth       : null;   // :166
```

- **No `display_currency` comparison.** `current`, `lastMonthSnap`, `janSnap` may each have a different `display_currency` (the column exists — `initial_schema.sql:46` — and the user can change the preference). If the user switched PLN→USD between two snapshots, the delta subtracts USD from PLN and reports a fabricated number. The percentage (`:168-175`) inherits the same defect.
- **The client is the sole guardian, and it abstains.** There is no server-side delta. Enforcement of the core invariant lives entirely in a React render closure that does not enforce it.
- **Cosmetic tail (D-9):** `DeltaIndicator` hardcodes `$` (`NetWorthDisplay.tsx:29`) regardless of `displayCurrency` — a visible symptom of the same "currency isn't part of the value" mindset.

### 3.2 The total is unverifiable from its items (INV-B / INV-D)
`snapshot_items` (`initial_schema.sql:54-66`) stores `converted_amount` and `display_currency` but **not `is_liability`** (and no stable `asset_id`). So:
- `total_net_worth` is computed in one loop (`snapshots/index.ts:97-107`) and items are written in a **separate** loop (`:140-153`); nothing checks `total == signed Σ items`.
- Because the sign is absent from items, the total **cannot be reconstructed** from the children → the aggregate cannot validate its own state on load. (`lessons.md` §"(snapshot_id, asset_id) has no unique constraint" is the same gap from the identity angle.)

### 3.3 The write is not atomic (INV-C)
`snapshots/index.ts:110-162`: insert parent → insert items → on items error, `delete` the parent (`:155-156`). A compensating delete, not a transaction. A crash *between* the two inserts (or a failed delete — tested worst case at `index.test.ts:195`) leaves an orphan snapshot with a total but no items. Recorded verbatim in `lessons.md` §1.

### 3.4 The rule is triplicated (INV-E) — the enabling defect
The identical "convert, split by `is_liability`, subtract" loop exists three times:
- `src/lib/net-worth.ts:40-56` (`computeNetWorth`),
- `src/pages/api/snapshots/index.ts:97-107` (inline),
- `src/components/assets/NetWorthDisplay.tsx:137-149` (IIFE) — plus two more partial copies at `:206-208` and `:217-219`.

`net-worth.ts:29-38` documents this as known debt. Three copies means three places the currency rule can drift — the structural reason INV-A is unguarded.

**Diagnosis summary:** the core comparison invariant is enforced **nowhere**; it is computed on the client from records that themselves cannot prove their own total, written without a transaction, using a rule that exists in triplicate. Fail-open at every layer.

---

## STEP 4 — Design: the `Snapshot` guardian aggregate

Goal: make **one** server-side aggregate the **only** place INV-A–E are enforced; move enforcement off the client; fail-fast with **named domain errors** instead of silent miscalculation.

New home (no domain layer exists today): `src/lib/domain/` — pure TypeScript, no Supabase imports. Repository and route adapt it to Astro/Supabase.

### 4.1 Value Object — `Money` (carries its currency; refuses cross-currency math)

```ts
// src/lib/domain/money.ts
class CurrencyMismatchError extends Error {}              // named domain error (INV-A)

class Money {
  private constructor(readonly amount: number, readonly currency: Currency) {}
  static of(amount: number, currency: Currency): Money;   // validates currency ∈ {PLN,USD,EUR} (INV-F)

  plus(other: Money): Money {                             // precondition
    if (other.currency !== this.currency) throw new CurrencyMismatchError(this.currency, other.currency);
    return Money.of(this.amount + other.amount, this.currency);
  }
  minus(other: Money): Money { /* same precondition → CurrencyMismatchError */ }
  in(target: Currency, rates: ExchangeRates): Money;       // explicit, intentional conversion
}
```

`Money` makes INV-A structural: you **cannot** subtract two `Money` of different currencies without an explicit `CurrencyMismatchError`. The current `total_net_worth - other.total_net_worth` (a raw `number`) becomes impossible to write by accident.

### 4.2 Domain service — `NetWorthValuation` (kills the triplication, INV-E)

```ts
// src/lib/domain/net-worth-valuation.ts
interface ValuationLine { categoryId: string; name: string; original: Money; converted: Money; isLiability: boolean; }
interface Valuation { lines: ValuationLine[]; totalAssets: Money; totalLiabilities: Money; netWorth: Money; }

function valuate(assets: AssetInput[], displayCurrency: Currency, rates: ExchangeRates): Valuation;
// THE single definition of "Σ assets − Σ liabilities". Replaces net-worth.ts loop,
// the snapshots API loop, and the NetWorthDisplay IIFE. Returns the breakdown the
// net-worth.ts:29-38 TODO already asked for.
```

### 4.3 Aggregate root — `Snapshot` (the only enforcer)

```ts
// src/lib/domain/snapshot.ts
class SnapshotIntegrityError extends Error {}     // INV-B: total ≠ Σ signed items
class InvalidSnapshotSourceError extends Error {} // source ∉ {manual, auto}

class Snapshot {
  private constructor(
    readonly id: SnapshotId,
    readonly userId: string,
    readonly takenAt: Date,
    readonly displayCurrency: Currency,
    readonly source: "manual" | "auto",
    readonly items: ReadonlyArray<SnapshotItem>,   // each item carries isLiability + converted Money
    readonly total: Money,
  ) {
    this.checkInvariants();                        // runs on EVERY construction (create AND rehydrate)
  }

  private checkInvariants() {
    if (this.total.currency !== this.displayCurrency) throw new SnapshotIntegrityError("total currency");      // INV-A/B
    for (const it of this.items)
      if (it.converted.currency !== this.displayCurrency) throw new SnapshotIntegrityError("item currency");   // INV-A/B
    const recomputed = this.items.reduce(
      (acc, it) => (it.isLiability ? acc.minus(it.converted) : acc.plus(it.converted)),                        // INV-D
      Money.of(0, this.displayCurrency),
    );
    if (!recomputed.equalsWithin(this.total, 0.01)) throw new SnapshotIntegrityError("total ≠ Σ items");       // INV-B (NUMERIC(18,2) epsilon)
  }

  // The ONLY factory that mints a snapshot from live assets (used by POST + future auto-save).
  static capture(args: { userId; assets; displayCurrency; rates; source; now: Date }): Snapshot {
    if (args.source !== "manual" && args.source !== "auto") throw new InvalidSnapshotSourceError(args.source);
    const v = valuate(args.assets, args.displayCurrency, args.rates);   // single rule (INV-E)
    const items = v.lines.map(SnapshotItem.fromValuationLine);          // sign captured into each item (INV-D)
    return new Snapshot(SnapshotId.new(), args.userId, args.now, args.displayCurrency, args.source, items, v.netWorth);
  }

  // The ONLY way to compute a delta — enforces INV-A at the boundary.
  deltaTo(baseline: Snapshot, rates: ExchangeRates): NetWorthDelta {
    const here = this.total;
    const there = baseline.displayCurrency === this.displayCurrency
      ? baseline.total
      : baseline.total.in(this.displayCurrency, rates);  // explicit reconciliation, not silent subtraction
    const abs = here.minus(there);                       // CurrencyMismatchError is now impossible-by-construction
    const pct = there.amount !== 0 ? (abs.amount / Math.abs(there.amount)) * 100 : null;
    return { value: abs, percentage: pct };              // value is Money → renders with the right symbol (fixes D-9)
  }
}
```

Key design choices:
- **Immutable** (INV-C): all `readonly`, no setters — a snapshot is a frozen record once captured.
- **`SnapshotItem` gains `isLiability`** — the missing field that makes INV-B verifiable (schema change in 4.5).
- **`deltaTo` is the only delta path** and it is *total-typed* (`Money`), so cross-currency comparison either reconciles explicitly or is structurally impossible. The client no longer computes deltas.

### 4.4 Repository — `SnapshotRepository` (atomic write, validating load)

```ts
// src/lib/domain/snapshot-repository.ts
interface SnapshotRepository {
  save(s: Snapshot): Promise<void>;          // ONE transaction (4.6) — fixes INV-C / lessons §1
  listForUser(userId): Promise<Snapshot[]>;  // loads roots + items, rehydrates via Snapshot ctor → invariants checked on read
}
```

`listForUser` rehydrates through the same constructor, so a historically-corrupt row (e.g. a pre-migration snapshot whose items lack a sign) fails loudly with `SnapshotIntegrityError` instead of feeding a wrong delta. (Migration backfill in STEP 5 handles legacy rows.)

### 4.5 Persistence change (makes INV-B enforceable)

New migration `supabase/migrations/<ts>_snapshot_items_is_liability.sql`:
- `ALTER TABLE snapshot_items ADD COLUMN is_liability BOOLEAN NOT NULL DEFAULT false;`
- Backfill existing rows from `asset_categories.is_liability` via `category_id` join.
- (Optional, addresses `lessons.md` §"no unique constraint") add `asset_id UUID` + `UNIQUE(snapshot_id, asset_id)` for stable item identity. Items remain otherwise frozen.

### 4.6 Atomic transactional write (INV-C)

Supabase JS has no client-side multi-statement transaction, so the all-or-nothing write goes through **one Postgres function** (implicitly transactional), replacing the insert→insert→compensating-delete dance:

```sql
-- supabase/migrations/<ts>_create_snapshot_rpc.sql
CREATE FUNCTION create_snapshot(p_total numeric, p_currency text, p_source text, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$   -- INVOKER → RLS still applies
DECLARE v_id uuid;
BEGIN
  INSERT INTO snapshots(user_id, total_net_worth, display_currency, base_currency, source)
    VALUES (auth.uid(), p_total, p_currency, 'USD', p_source) RETURNING id INTO v_id;
  INSERT INTO snapshot_items(snapshot_id, category_id, name, original_amount, original_currency,
                             converted_amount, display_currency, is_liability, exchange_rate_usd, display_order)
    SELECT v_id, x.* FROM jsonb_to_recordset(p_items) AS x(...);
  RETURN v_id;   -- either both inserts commit, or the function aborts and neither does
END $$;
```

`SnapshotRepository.save` calls `supabase.rpc("create_snapshot", …)`. The compensating delete (`snapshots/index.ts:155-156`) is deleted.

### 4.7 Thin API + enforcement moved off the client

```ts
// POST /api/snapshots  (thin)
auth() → load assets + display-currency pref + rates
const snap = Snapshot.capture({ userId, assets, displayCurrency, rates, source: "manual", now });
await repo.save(snap);
return 201;
// catch: map CurrencyMismatchError / SnapshotIntegrityError / InvalidSnapshotSourceError
//        → { error: { code, message, context } }   (project error shape, CLAUDE.md hard rule)
```

```ts
// GET /api/snapshots  → returns snapshots AND server-computed, currency-homogeneous deltas
const snaps = await repo.listForUser(userId);
const deltas = computeDeltas(snaps, rates);   // uses Snapshot.deltaTo — INV-A enforced server-side
return { data: { snapshots, deltas } };
```

`NetWorthDisplay.tsx` stops computing deltas (`:152-181` removed); it renders the server's `deltas`, whose `value` is `Money`, so the `$` hardcode (`:29`) is replaced by the value's own currency. **Enforcement migrates from the React closure to the server aggregate.**

---

## STEP 5 — Before/after, phased plan, tests, registry

### 5.1 Before / after (every current site of the rule)

| Site | Before | After |
|---|---|---|
| `NetWorthDisplay.tsx:165-166` | `current.total_net_worth - lastMonthSnap.total_net_worth` (no currency check) | deleted; renders server `deltas` from `Snapshot.deltaTo` (INV-A enforced) |
| `NetWorthDisplay.tsx:137-149,206-208,217-219` | net-worth recomputed inline (IIFE + 2 reduces) | calls `valuate()` once (INV-E) |
| `NetWorthDisplay.tsx:29` | `$` hardcoded in delta | renders `Money` with its currency (D-9) |
| `snapshots/index.ts:97-107` | inline convert/split/subtract loop | `Snapshot.capture` → `valuate()` |
| `snapshots/index.ts:110-162` | insert + insert + compensating delete | `repo.save` → `create_snapshot` RPC (INV-C) |
| `snapshot_items` schema `initial_schema.sql:54-66` | no `is_liability`; total unreconstructable | `+ is_liability` column; total = signed Σ items (INV-B) |
| `net-worth.ts:40-56` | `computeNetWorth` (one of 3 copies) | thin shim over `valuate`, or retired |

### 5.2 Phased refactor plan (test-first where it bites)

- **Phase 0 — Characterization (test-first).** Pin *current* POST behavior (the 11 scenarios already at `index.test.ts:72-285`) so the refactor is provably behavior-preserving except for the fixed invariants. *(test-first)*
- **Phase 1 — `Money` + `NetWorthValuation`** in `src/lib/domain/`, pure, no DB. Unit-tested first; then repoint the three duplicate loops (INV-E). *(test-first)*
- **Phase 2 — Schema migration:** add `snapshot_items.is_liability` (+ optional `asset_id`/unique), backfill legacy rows (4.5).
- **Phase 3 — `create_snapshot` RPC** migration + `SnapshotRepository.save` atomic write; delete the compensating-delete branch (INV-C). *(test-first: re-run the atomicity scenarios incl. `index.test.ts:195` worst case)*
- **Phase 4 — `Snapshot` aggregate** (`capture` + `checkInvariants` + `deltaTo`); thin the POST route through it. *(test-first: invariant tests below)*
- **Phase 5 — Move deltas server-side:** GET returns homogeneous `deltas`; strip delta math from `NetWorthDisplay` (INV-A, D-9). *(test-first on the GET; E2E re-check of the dashboard delta panel via `/10x-e2e`.)*

### 5.3 Test cases for the invariant (legal vs. illegal)

**Legal (must pass):**
- L1 capture with mixed-currency assets → `total.currency === displayCurrency`, `total == signed Σ items` (INV-B).
- L2 `deltaTo` between two same-currency snapshots → correct absolute + pct.
- L3 `deltaTo` where baseline currency differs → reconciles via `rates`, returns a `Money` in current currency (INV-A satisfied *by conversion*).
- L4 liability-only portfolio → negative total; assets-only → positive (INV-D).
- L5 empty portfolio → `total == Money.of(0, currency)` (matches `index.test.ts:249`).
- L6 `save` then `listForUser` round-trips and re-validates on load.

**Illegal (must throw the named error, must NOT silently proceed):**
- I1 `Money.minus` across currencies → `CurrencyMismatchError` (INV-A).
- I2 construct a `Snapshot` whose `total ≠ Σ items` → `SnapshotIntegrityError` (INV-B).
- I3 item currency ≠ snapshot currency → `SnapshotIntegrityError` (INV-A/B).
- I4 `source: "weekly"` → `InvalidSnapshotSourceError`.
- I5 RPC: simulate items-insert failure → **zero** rows committed (no orphan) (INV-C; replaces `index.test.ts:170-225`).
- I6 rehydrate a legacy/corrupt row (sign missing) → `SnapshotIntegrityError` on load, not a wrong delta.

### 5.4 New load-bearing names to register (`lessons.md` / contract registry)

`Money` (VO), `ExchangeRates` (VO), `NetWorthValuation` / `valuate`, `Snapshot` (aggregate root), `SnapshotItem`, `SnapshotRepository`, domain errors `CurrencyMismatchError` · `SnapshotIntegrityError` · `InvalidSnapshotSourceError`, the `create_snapshot` RPC, and the `snapshot_items.is_liability` column. Each becomes a contract a future change must not silently break — and closes the two open `lessons.md` items (atomicity §1, item-identity §"no unique constraint").

---

## Summary

BitWorth's most core invariant is **currency homogeneity** — that the net-worth number is only ever compared against another number in the same currency — because watching that one number move over time is the product's entire reason to exist over a spreadsheet. It is also the **least enforced** invariant in the codebase: the only delta computation lives in a React render closure (`NetWorthDisplay.tsx:165-166`) that subtracts `total_net_worth` values without ever checking `display_currency`, so a currency switch between snapshots silently fabricates the delta. That fragility is compounded by three dependent gaps — `snapshot_items` stores no liability sign so a snapshot's total can't be reconstructed from its children (`initial_schema.sql:54-66`), the write uses a compensating delete instead of a transaction (`snapshots/index.ts:155-156`, already logged in `lessons.md`), and the net-worth rule exists in triplicate (`net-worth.ts`, the snapshots API, the UI). The plan introduces a `Snapshot` aggregate in a new `src/lib/domain/` as the single guardian: a `Money` value object that makes cross-currency arithmetic throw `CurrencyMismatchError`, a `NetWorthValuation` service that collapses the three loops into one, invariant checks that run on every construction and rehydration (`SnapshotIntegrityError`), an atomic `create_snapshot` RPC, and a `deltaTo` method that is the only sanctioned delta path. Enforcement moves off the client onto the server, illegal operations fail fast with named domain errors instead of computing wrong numbers, and the work is sequenced test-first through six phases against the existing Vitest suite.
