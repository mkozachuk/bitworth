# PWA Installable (S-08) — Plan Brief

> Full plan: `context/changes/pwa-installable/plan.md`
> Research: `context/changes/pwa-installable/research.md`

## What & Why

Make BitWorth an installable PWA so users can add the app to their phone's home screen (iOS via Share → Add to Home Screen; Android/Chrome via the deferred `beforeinstallprompt` flow) and launch it as a standalone full-bleed experience at `/dashboard` — no browser chrome, safe-area-inset-aware, with a minimal offline shell that prevents the redirect-cascade failure when the network is gone.

## Starting Point

The `feature/pwa` branch is checked out but no PWA code has landed. `Layout.astro:19` has only a favicon link; `astro.config.mjs:12` has no PWA plugin; `public/` has only `favicon.png` (32×32) and `template.png` (1492×470, wrong aspect ratio). `wrangler.jsonc`'s `assets` binding is set up to serve `dist/` statically, so the SW and manifest will land in a known-good serving path. `src/middleware.ts:4` redirects unauthed visitors to `/auth/signin`, which means an offline install-launch would cascade-fail without a SW short-circuit.

## Desired End State

A user with a BitWorth account can install the app to their phone's home screen and launch it standalone. iOS users see a dismissible "How to install" modal on first authed visit. Android/Chrome users see an "Install app" item in the Topbar dropdown. When offline (installed, no network), the app launches to a minimal cosmic-themed offline shell instead of a Cloudflare error. The install-prompt UI is invisible to users who have already installed (detected via `display-mode: standalone`). SW updates happen silently on the next navigation — no toast, no reload prompt.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| PWA library | Hand-roll `vite-plugin-pwa@1.3.0` (stable) as a custom Astro integration | `@serwist/astro` is preview-channel 14 with no stable since 2025-08; `@vite-pwa/astro@1.2.0` caps its peer at `astro@^5.0.0` and BitWorth is on Astro 6.3.1 | Plan |
| Icon source | Generated 512×512 monogram from 32×32 favicon + automated variants | Favicon is too small to upscale silently; designer can replace the single source file later | Plan |
| Install UI scope | Authed routes only; Android item in Topbar Radix DropdownMenu | Matches S-06's responsive scope (`mobile-refactor/plan.md:46`) — no premature install push on landing-page visitors | Plan + Research |
| Offline shell | Static HTML page with no React islands, no Supabase calls | Avoids dependency cycles (Supabase offline = no auth) and keeps the shell renderable even when the network is fully down | Plan + Research |
| Update flow | `registerType: "autoUpdate"` + `skipWaiting: true` + `clientsClaim: true` | Bypasses Cloudflare's 4-hour `Cache-Control` on `/sw.js`; SSR data is always fresh from Supabase so no UI to reconcile | Plan + Research |
| Install detection | CSS-only `display-mode: standalone` media query + inline `data-installed` flip before paint | Matches S-06's no-`useMediaQuery` convention; no hydration boundary, no flash of installable UI | Plan + Research |
| Phase order | Foundation-first: icons → SW → layout → offline → Android → iOS | Each phase has a verifiable end state; icon quality is gated before installability is built on top | Plan |
| Service worker registration | Manual via `workbox-window` in the authed layout, not the auto-injected register | The auto-injected register ships on every page (landing page too); we want the SW only for users who are about to see install-prompt UI | Plan |
| Cloudflare gotcha | `Cache-Control: max-age=14400` on `/sw.js` (not `Service-Worker-Allowed` as the roadmap says) | The roadmap's risk callout is mis-framed — `skipWaiting` + `clientsClaim` sidesteps the cache; `Service-Worker-Allowed` is not needed for scope `/` | Research |

## Scope

**In scope:**

- Icon set (192/512/maskable-512/apple-touch-180/safari-pinned-SVG) from a 512×512 monogram source
- `public/manifest.webmanifest` (W3C format, `id: "/"`, `start_url: "/dashboard"`, `display: "standalone"`)
- Service worker via hand-rolled `vite-plugin-pwa` integration (no preview dep)
- `Layout.astro` head additions: manifest link, apple-touch-icon, mask-icon, theme-color, apple-mobile-web-app-* tags, `viewport-fit=cover`
- Static `public/offline.html` (no islands, no Supabase calls)
- CSS-only `data-installed` detection via `display-mode: standalone` media query
- `--safe-top` / `--safe-bottom` CSS variables + Topbar/dashboard application
- Android/Chrome "Install app" item in Topbar (visible on desktop + mobile, hidden on iOS and standalone)
- iOS "How to install" modal (native `<dialog>`, dismissible, `localStorage` persistence)
- `public/.assetsignore` updated to exclude `sw.js`, `sw.js.map`, `workbox-*.js`

**Out of scope:**

- DOM testing library (`@testing-library/react` + `jsdom`) — `test-plan.md:64` defers this; PWA verified via build + deploy-preview + manual smoke
- Push notifications, background sync, fullscreen API — iOS PWA limitations noted in the roadmap
- Light-mode theme color — cosmic dark theme dominates; deferred to a future theme slice
- Install-prompt UI on the landing page — visitors haven't seen the app's value yet
- Caching Supabase API responses or authed dashboard HTML — security regression
- Custom service-worker scope beyond `/` — not needed
- Updating `public/template.png` — wrong aspect ratio; not a PWA concern
- Designer-quality icon set — placeholder monogram only

## Architecture / Approach

`vite-plugin-pwa@1.3.0` is added as a devDep and wired into Astro via a small custom integration in `src/integrations/pwa.ts` (an `astro:config:setup` hook that calls `updateConfig({ vite: { plugins: [VitePWA({...})] } })`). The integration uses `strategies: "generateSW"` — Workbox generates the SW from the `workbox` config; no custom fetch handlers in `src/sw.ts` (which is a placeholder file reserved for a future slice that needs custom logic).

The manifest lives in `public/manifest.webmanifest` (not generated by the plugin — `manifest: false` in the config) so its shape is visible and editable. The icons live in `public/icons/`, all derived from a single 512×512 source PNG that's the designer's swap point.

`Layout.astro` is the single head emitter; every PWA tag lands there. The inline `data-installed` script runs before paint to set `document.documentElement.dataset.installed`, so install-prompt UI is hidden via CSS attribute selectors when the app is in `display-mode: standalone`. No JS-side `useMediaQuery`, no React-state-based install detection.

`offline.html` is a static page in `public/`, served by the SW's `setCatchHandler` (via Workbox's `navigateFallback: "/offline.html"`). It has no client JS beyond a `location.reload()` onclick handler, no external requests, no fonts. It works when the network is fully down.

The Android install button (`InstallButton.tsx`) and iOS install modal (`InstallInstructionsModal.tsx`) are React islands, both gated to the authed layout via `client:load`. The Topbar's `TopbarMenu` Radix DropdownMenu (established in S-06) is extended with an `installSlot` prop so the install button is reachable from the mobile dropdown.

```
Layout.astro (head + inline data-installed)
  └─ /sw.js (generated by vite-plugin-pwa)
       ├─ precache: /manifest.webmanifest, /offline.html, /icons/*, /apple-touch-icon.png
       ├─ runtime cache: /public/* (CacheFirst), /_astro/* (StaleWhileRevalidate)
       └─ setCatchHandler → /offline.html (on navigation failure)

DashboardLayout.astro (authed only)
  ├─ Topbar.astro
  │    ├─ <InstallButton client:load />      (Android/Chrome only)
  │    └─ <TopbarMenu installSlot={...} />
  └─ <InstallInstructionsModal client:load /> (iOS only)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Icon set + manifest | 5 icon variants from 512×512 monogram source + `public/manifest.webmanifest` + `.assetsignore` update | Monogram quality visible to every user with the home-screen icon — must be acceptable before Phase 2 builds on it |
| 2. vite-plugin-pwa + SW | Custom Astro integration wiring stable `vite-plugin-pwa@1.3.0`; `dist/sw.js` emitted; SW registered via `workbox-window` in authed layout | The hand-roll must not leak SW registration to unauthed routes; manual registration in `DashboardLayout.astro` is the only place that imports `workbox-window` |
| 3. Layout head + safe-area | All 6 PWA meta/link tags in `<head>`, `viewport-fit=cover`, `data-installed` script, `--safe-top`/`--safe-bottom` CSS vars | Inline script must run before paint to avoid flash of installable UI — `is:inline` is the Astro-idiomatic way to ensure no module wrapping |
| 4. Offline shell | Static `public/offline.html` with no React/Supabase deps, served by SW's `setCatchHandler` | The page must be a true static shell — any external request (Google Fonts, CDN) breaks offline |
| 5. Android install button | `InstallButton` React island listening for `beforeinstallprompt`; TopbarMenu extended with `installSlot` prop | Button must hide on iOS (no `beforeinstallprompt`) and on standalone (already installed) — both checks must be in `useEffect` and re-evaluated on `appinstalled` event |
| 6. iOS install modal | `InstallInstructionsModal` React island using native `<dialog>`; `localStorage` dismissal under `bw-ios-install-dismissed-v1`; three steps (Share → Add to Home Screen → Add) | Focus trap must work — native `<dialog>` handles it; if the modal ever uses a `div` with role="dialog", the trap becomes our problem |

**Prerequisites:** S-06 (mobile-refactor — `TopbarMenu` Radix seam) and S-07 (asset-list-mobile-reflow — both done per the roadmap At-a-glance table).
**Estimated effort:** ~2-3 sessions across 6 phases. The bulk of the work is in Phase 1 (icon generation script + manifest authoring) and Phase 2 (custom Astro integration + Workbox config).

## Open Risks & Assumptions

- **The 32×32 favicon may not upscale cleanly.** A "B" or simple letterform monogram can be hand-rendered at 512×512 from scratch if the upscale looks bad. The icon-generation script in Phase 1 should fail loud (not silent) if the result is too pixelated — manual check is the gate before Phase 2.
- **`workbox-window` adds ~2 KB gzipped to the authed layout.** Dynamic import keeps it out of the initial bundle. Not a real risk; flagged for awareness.
- **No DOM testing infrastructure.** Verification is build + deploy-preview + manual smoke test. If the team wants unit tests for the install-banner detection logic, that's a separate slice that drags in `@testing-library/react` + `jsdom`.
- **Real iOS device testing requires physical hardware or BrowserStack.** Chrome DevTools' iOS emulation is good but doesn't capture every iOS Safari quirk (e.g. `display-mode: standalone` reliability on iOS 16.4 vs 17.x). Final verification on a deploy preview should include a real-device smoke test if available.
- **The favicon is assumed to be a "B" or simple letterform.** If the favicon is a more complex mark, the monogram generation needs a designer. Plan flags this as Phase 1's manual gate.

## Success Criteria (Summary)

- Lighthouse PWA audit passes on a deploy preview (manifest + SW + icons all valid).
- iOS Safari → auth → see modal → Share → Add to Home Screen → tap home-screen icon → standalone launch at `/dashboard` with no Safari chrome, dark status bar, safe-area insets visible.
- Android Chrome → auth → see "Install app" button → tap → accept prompt → home-screen icon → standalone launch.
- Offline launch (airplane mode + installed): minimal cosmic-themed offline shell renders, no redirect cascade, no Cloudflare error.
- `wrangler dev` and a real deploy preview both serve `/sw.js` and `/manifest.webmanifest` with the correct Content-Type and `Cache-Control` headers (4 h for static, no caching for the SW itself in practice because `skipWaiting` overrides it).
