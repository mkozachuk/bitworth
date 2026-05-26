---
project: BitWorth
derived_from: context/foundation/roadmap.md
created: 2026-05-26
updated: 2026-05-26
---

# GitHub Issues — Roadmap Mapping

> ⚠️ **Linear is now authoritative.** See the [Linear Roadmap project](https://linear.app/bitworth/project/roadmap-2e5bcdc2d5be).
> GitHub issues remain open as cross-linked references. Each GitHub issue has a Linear link comment.
> This file is maintained as a reference index.

> Roadmap items migrated to GitHub Issues on `mkozachuk/bitworth`.
> Each issue body contains the full roadmap entry (outcome, PRDs, blockers, unknowns, risk).
> This document is the authoritative index; it is updated when issues change state.

## Milestones

| # | Title | Description | Issues |
|---|---|---|---|
| 1 | M1: Foundation | PostgreSQL schema, migrations, and seed data for assets, snapshots, and user preferences. | #2 |
| 2 | M2: Core tracking | Asset CRUD with currency conversion. | #3 |
| 3 | M3: Dashboard | Net worth display, delta indicators, snapshot save, and trend chart. | #4 |
| 4 | M4: Crypto integration | Live BTC/ETH/altcoin price fetch on asset entry via CoinGecko. | #5 |
| 5 | MVP | Meta-milestone: all slices complete and core product hypothesis validated. | — |
| 6 | Backlog | Pre-work questions and parked items needing resolution before engineering starts. | #6–10 |

**Note on MVP milestone:** GitHub restricts an issue to one milestone. Issues #2–5 belong to their respective delivery milestones (M1–M4). To group them under the MVP milestone, manage membership manually at https://github.com/mkozachuk/bitworth/milestone/5.

## Roadmap Issues

| Roadmap ID | Change ID | GitHub # | Title | Milestone | Status |
|---|---|---|---|---|---|
| F-01 | `supabase-schema-migrations` | [#2](https://github.com/mkozachuk/bitworth/issues/2) | [Foundation] F-01: Supabase schema and migrations | M1: Foundation | OPEN |
| S-01 | `asset-management` | [#3](https://github.com/mkozachuk/bitworth/issues/3) | [Slice] S-01: Asset management with currency conversion | M2: Core tracking | OPEN |
| S-02 | `dashboard-snapshots-chart` | [#4](https://github.com/mkozachuk/bitworth/issues/4) | [Slice] S-02: Dashboard — net worth display, snapshots, and trend chart | M3: Dashboard | OPEN |
| S-03 | `crypto-price-fetch` | [#5](https://github.com/mkozachuk/bitworth/issues/5) | [Slice] S-03: Crypto price fetch on asset entry | M4: Crypto integration | OPEN |

## Question Issues

| Roadmap ID | GitHub # | Title | Owner | Needed by | Labels |
|---|---|---|---|---|---|
| Q1 | [#6](https://github.com/mkozachuk/bitworth/issues/6) | Exchange rate API — frankfurter.app vs alternatives | user | F-01 | `question` |
| Q2 | [#7](https://github.com/mkozachuk/bitworth/issues/7) | Crypto price API — CoinGecko free tier | user | F-01 | `question` |
| Q3 | [#8](https://github.com/mkozachuk/bitworth/issues/8) | Snapshot auto-save trigger — first-login-of-month vs fixed day-of-month | user | S-02 | `question` |
| Q4 | [#9](https://github.com/mkozachuk/bitworth/issues/9) | Display currency persistence — per-user vs session | user | F-01 | `question` |
| Q5 | [#10](https://github.com/mkozachuk/bitworth/issues/10) | Demo mode scope — sample data composition | user | post-MVP | `question`, `nice-to-have` |

## Labels

| Label | Color | Purpose |
|---|---|---|
| `foundation` | #6B7280 | Prerequisite/infra work (F-01) |
| `slice` | #2563EB | User-facing vertical slice (S-01, S-02, S-03) |
| `nice-to-have` | #9333EA | Parked/nice-to-have features (Q5) |
| `question` | #F59E0B | Open questions needing decision |
| `enhancement` | (GH default) | Standard GitHub label |

## Dependency Chain

```
F-01  ──┬──► S-01  ──► S-02
        └──► S-03
              ↑
         (parallel with S-01, S-02)
```

- **F-01** must complete before any slice starts.
- **S-01** must complete before **S-02** (dashboard needs asset data).
- **S-03** runs parallel to S-01 and S-02 after F-01 lands.
- **Q1–Q5** are Backlog items — resolve before their respective slices start.

## Links

- [All issues](https://github.com/mkozachuk/bitworth/issues)
- [Milestones](https://github.com/mkozachuk/bitworth/milestones)
- [Labels](https://github.com/mkozachuk/bitworth/labels)
- [Roadmap source](context/foundation/roadmap.md)
