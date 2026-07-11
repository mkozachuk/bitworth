# Contributions vs Growth — Plan Brief

> Full plan: `context/changes/contributions-vs-growth/plan.md`

## What & Why

Show the user how much of each snapshot-to-snapshot change in net worth came from **money they added** (contributions) vs **market movement** (growth) — `contribution + growth = total change`. Net worth going up doesn't tell you *why*; this separates the part you controlled (saving/withdrawing) from the part the market did.

## Starting Point

The dashboard records periodic net-worth snapshots, but the save flow is a single bodyless button that derives everything server-side — no user input, no contribution data in the schema. The net-worth line chart (`NetWorthChart.tsx`) reads `total_net_worth` straight off snapshot rows. Per-interval signed-contribution math already exists for Top Movers (`movers.ts`), and `AssetTrendsChart.tsx` is a working multi-series chart template.

## Desired End State

Under the net-worth chart sits a stacked-bar chart: one bar per interval, contribution and growth diverging around a zero line (a save-and-market-drop month shows both forces, net = total change). Intervals with no recorded contribution show a neutral "unknown split" bar. Saving a snapshot opens a dialog asking for the optional signed amount added/withdrawn; users can also edit/backfill the contribution on any existing snapshot.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Contribution capture | Nullable `net_contribution NUMERIC(18,2)` on `snapshots` | Schema has no flow data; nullable column mirrors the existing column-add pattern | Change |
| Input UX | Dialog on save click (native `<dialog>`) | Room for label, help text, "blank = unknown"; no new Radix dep | Plan |
| Editability | Editable via new PATCH `snapshots/[id]` | Lets users fix typos and backfill old snapshots into real splits | Plan |
| Contribution sign | Signed (+ added, − withdrawn) | Models reality; keeps `growth = change − contribution` correct | Plan |
| Negative growth | Diverging bars around a zero reference line | Honestly shows both forces in a drop month at a glance | Plan |
| Missing data | Single neutral "unknown split" bar | Never mislabels contributions as growth; never crashes | Plan |
| Cross-currency | Convert stored contribution at today's rates | Matches movers convention; no spurious FX movement | Plan |
| Testing | Oracle unit tests mirroring `movers.test.ts` | Pins the split identity + edge cases in the riskiest layer | Plan |

## Scope

**In scope:** schema column; signed contribution capture (save dialog) + edit/backfill (PATCH); pure tested `contributions.ts`; diverging stacked-bar chart with unknown-split handling; dashboard wiring.

**Out of scope:** savings-rate/income metric; per-asset growth attribution; auto-inferred contributions; multi-currency contribution breakdown; backfill migration of old rows.

## Architecture / Approach

Bottom-up vertical slice: migration + types → pure split lib (+ oracle tests) → API write path (POST gains a JSON body; new PATCH route) → save dialog → edit/backfill UI → Recharts diverging-bar chart. The pure lib (`buildContributionSplits`) returns a discriminated `split | unknown` result per interval, reusing `convertAmount` and the signed/diff-at-today's-rates convention from `movers.ts`. The chart and both dialogs reuse a shared `ContributionField` component and the native `<dialog>` pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & Types | Nullable `net_contribution` column + types | Type regen drift |
| 2. Pure split lib + tests | `contributions.ts` with oracle tests | Sign/FX/null edge cases |
| 3. API write path | POST body + PATCH `snapshots/[id]` | Backward-compat of bodyless POST; write-scope (RLS) |
| 4. Save dialog UI | Native dialog captures signed contribution | `react-compiler` lint on new island |
| 5. Edit / backfill UI | Set/correct contribution on existing snapshots | Interval→snapshot mapping (target the later one) |
| 6. Stacked-bar chart + wiring | Diverging bars + unknown-split under net-worth chart | Recharts diverging-stack rendering |

**Prerequisites:** F-01, S-01, S-02, S-05 (snapshot history, `convertAmount`/`computeNetWorth`, Recharts, display currency) — all present. Reuses S-11/S-12 read patterns.
**Estimated effort:** ~3–4 sessions across 6 phases.

## Open Risks & Assumptions

- `total_net_worth` is compared across a pair assuming stable display currency (existing mixed-currency caveat); only the contribution is re-converted.
- Diverging stacked bars in Recharts need a zero `ReferenceLine` and clear legend to read correctly.
- The bodyless legacy POST must keep working after the body contract is added (defensive parse).
- Contribution stored in entry-time display currency; viewing in another currency reflects today's FX (documented same-family caveat).

## Success Criteria (Summary)

- A user sees, per interval, how much change was contribution vs market growth, with negative growth honestly shown below zero.
- Intervals without a recorded contribution are clearly marked "unknown split", never mislabeled.
- Users can record contributions at save time and backfill/correct them afterward.
