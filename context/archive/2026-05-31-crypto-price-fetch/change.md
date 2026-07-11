---
change_id: crypto-price-fetch
title: Live crypto price fetch on asset entry
status: archived
created: 2026-05-31
updated: 2026-07-11
archived_at: 2026-07-11T20:55:40Z
---

## Notes

When user adds or edits a crypto asset, the app auto-fetches current market price for BTC/ETH/altcoins from CoinGecko; if the fetch fails, a cached price or manual entry is used. PRD refs: FR-019, FR-020. Prerequisites: F-01. Parallel with: S-01, S-02.