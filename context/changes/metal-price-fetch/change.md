---
change_id: metal-price-fetch
title: Precious-metals spot-price fetch on asset entry
status: new
created: 2026-07-12
updated: 2026-07-12
archived_at: null
---

## Notes

from @context/foundation/roadmap.md

Roadmap slice **S-19: Precious-metals price fetch on asset entry** — when the user adds/edits a `precious_metals` asset, auto-fetch the current gold/silver (XAU/XAG) spot price, convert to display currency, and auto-calc value from quantity (troy oz). Mirrors the S-03 crypto flow (`getPrice`/cache/`/api/*-price`/`AssetForm` conditional) and reuses `exchange-rates.ts` for USD→display conversion. Prereqs: F-01, S-01, S-03 (all done). Core unknown: pick a keyless, **Cloudflare-Workers-reachable** metals price API (S-03 hit the CoinGecko 403-from-Workers trap).
