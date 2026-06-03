---
date: 2026-06-03T22:29:45+0200
researcher: Claude (research agent)
git_commit: bf62654376092f386f0ca93785551f60b7b86695
branch: feature/pwa
repository: bitworth
topic: "PWA installable (S-08): make BitWorth a standalone installable app on iOS and Android, served from Cloudflare Workers"
tags: [research, pwa, serwist, cloudflare-workers, installability, mobile]
status: complete
last_updated: 2026-06-03
last_updated_by: Claude (research agent)
---

# Research: PWA installable (S-08)

**Date**: 2026-06-03 22:29 (Europe/Warsaw)
**Researcher**: Claude (research agent)
**Git Commit**: `bf62654` (branch `feature/pwa`)
**Repository**: bitworth

## Research Question

How to make BitWorth an installable PWA (S-08 per the roadmap): users install the app to a phone's home screen, it launches standalone at `/dashboard` with no browser chrome, and the offline experience degrades gracefully. The app is Astro v6 SSR + React 19 islands + Cloudflare Workers. Decisions needed: which PWA tooling (Serwist vs. hand-rolled vs. workbox-cli), manifest shape, icon set, install UX for iOS (no `beforeinstallprompt`) and Android/Chrome, service worker registration, offline fallback, and update strategy.

## Summary

The current repo has **no PWA pieces whatsoever** — no manifest, no service worker, no apple-touch-icon, no theme-color, no `beforeinstallprompt` listener, no `viewport-fit=cover`. The only head-related infrastructure is a single favicon link in `src/layouts/Layout.astro:19`. The `feature/pwa` branch is checked out but no PWA code has landed yet.

The roadmap S-08 entry recommends `@serwist/astro`, and that is the right tool — but with a **material caveat the roadmap does not capture**: as of 2026-06-03, `@serwist/astro` is at `10.0.0-preview.14` (published 2025-09-03). There is no `/docs/astro` page on the published docs site, the GitHub monorepo `main` branch has no `packages/astro/` directory, and the package is on preview channel 14 with no stable release. The integration works mechanically (it wraps `vite-plugin-serwist` and runs an `astro:build:done` hook to call `generateServiceWorker`), so it is *usable* for BitWorth's scope — but the plan must accept "preview dependency with thin docs" as a known risk, not treat it as a stable, fully-documented library.

Astro's `output: "server"` (no static HTML for routes — every meaningful page is auth-gated and SSR) actually *helps* this slice: the default Serwist precache over `dist/**/*` finds nothing useful beyond the SW and static `/public/` assets. The right precache is therefore tiny: just the SW, the manifest, the icons, the favicon, and a single static `offline.html` shell. The right runtime caching is `CacheFirst` for `/public/` assets, `StaleWhileRevalidate` for `/_astro/*` hashed JS/CSS, and **explicitly no** caching for Supabase API responses (a cached 401/200 mismatch is a security regression).

The Cloudflare Workers risk the roadmap calls out — `Service-Worker-Allowed` scope header — is not actually the binding risk for `/sw.js` at root; scope is determined by the registration path, not the header. The **real** Workers gotcha is `Cache-Control: max-age=0, must-revalidate` on `/sw.js` (else old SWs stick around after deploy), and `wrangler.jsonc`'s `assets` binding serving the file with the right `Content-Type: application/manifest+json` for the manifest (default behaviour; verify with `curl -I` in E2E).

iOS still has no `beforeinstallprompt` event as of iOS 26. The install flow is Share → Add to Home Screen. The plan needs: (a) a 180×180 `apple-touch-icon.png`, (b) the four Apple-specific `<meta>` tags, (c) a `mask-icon` SVG for Safari pinned tab, and (d) a dismissible "How to install" modal on authed visits for iOS users running in browser mode. Android/Chrome get a manual "Install app" button in the Topbar wired to the deferred `beforeinstallprompt` event, with the standard 30-day dismissal cooldown handled by Chrome itself.

The offline experience: ship a single static `offline.html` shell served by `setCatchHandler` in the SW. The middleware redirect-to-`/auth/signin` means that without the SW short-circuit, an offline launch would cascade-fail (redirect target also needs network). The SW must serve the offline shell *before* the SSR middleware runs for a navigation request.

Icon source is the one open user-owned prerequisite blocking planning: the repo has only `public/favicon.png` (32×32, 733 B) and `public/template.png` (1492×470, 1.2 MB — wrong aspect ratio for a square PWA icon). The favicon is too small to upscale; a real 512×512 source is needed. Roadmap S-08 unknown recommends a placeholder monogram set generated from the favicon — defensible, but the design constraint must be acknowledged (do not silently ship a blurry icon).

## Detailed Findings

### 1. Current PWA state (inventory)

The `feature/pwa` branch is checked out but no PWA code has been written. Every installability gate is currently failing:

- `src/layouts/Layout.astro:19` — only `<link rel="icon" type="image/png" href="/favicon.png" />`. No manifest link, no theme-color, no apple-touch-icon.
- `src/layouts/Layout.astro:18` — viewport meta is `width=device-width` only; missing `viewport-fit=cover` (required for safe-area insets in standalone PWA mode; this is a quiet gap left by S-06).
- `astro.config.mjs:12` — `integrations: [react(), sitemap()]`. No Serwist / `vite-plugin-pwa` / workbox integration.
- `package.json` — no `serwist`, no `workbox-*`, no `@vite-pwa/*` dep. (The `overrides.vite: ^7.3.2` is the only PWA-adjacent entry; Serwist's `vite-plugin-serwist` peer is `vite >=5.0.0`, so Vite 7 is fine.)
- `public/` — only `favicon.png` (32×32, 733 B) and `template.png` (1492×470, 1.2 MB marketing banner). No manifest, no icons, no `apple-touch-icon.png`, no `offline.html`.
- Build output (`dist/`) — confirmed by `find dist`: no `sw.js`, no `manifest.webmanifest`. Only `sitemap.xml`, `favicon.png`, `template.png`, `.assetsignore`.
- All of these terms are absent across `src/`: `manifest`, `webmanifest`, `serviceWorker`, `beforeinstallprompt`, `apple-touch-icon`, `theme-color`, `theme_color`, `display: standalone`, `navigator.serviceWorker`.

### 2. Head/meta surface — single point of insertion

Grep across `src/` for `<head|</head|<title|set:html` returns exclusively `src/layouts/Layout.astro:16-33`. **Every required PWA tag lands in this one file.** No competing head emitters means no risk of a partial installability configuration split across multiple layouts.

### 3. Build/serve interaction

- `astro.config.mjs` — `output: "server"`, no Serwist integration yet. SSR is fine for Serwist; the integration handles build output regardless of output mode.
- `wrangler.jsonc` — `assets.directory: ./dist`, `binding: "ASSETS"`, `not_found_handling: "404-page"`, `compatibility_flags: ["nodejs_compat"]`. The stable `assets` binding (not the beta `--assets` flag) is in use. Serwist's default `swDest: dist/sw.js` lands inside the `assets` binding directory — no path mismatch, no shadowing by the SSR worker. `public/.assetsignore` currently lists `_worker.js`, `_routes.json` only; must add `sw.js`, `sw.js.map`, and any `workbox-*.js` so the Wrangler assets binding doesn't try to serve them via a stale worker.
- `tsconfig.json` — `paths: { "@/*": ["./src/*"] }`, `jsxImportSource: "react"`. The SW source file (e.g. `src/sw.ts`) needs `lib: ["webworker"]` + a triple-slash reference to `/// <reference types="@serwist/astro/typings" />` for `self.__SW_MANIFEST` typing.

### 4. Auth & offline routing impact

`src/middleware.ts:4` defines `PROTECTED_ROUTES = ["/dashboard"]`; unauthed visitors are redirected to `/auth/signin` (which itself needs network to call `supabase.auth.getUser()`). **The implication is concrete**: an installed PWA launched with no network will hit `supabase.auth.getUser()` (which fails), then be redirected to `/auth/signin` (which also fails), then likely surface a Cloudflare error. The SW's offline shell must short-circuit *before* the SSR middleware runs for navigation requests — `setCatchHandler` returning `matchPrecache("/offline.html")` is the right hook, and the offline shell should itself be a self-contained static HTML (no `client:*` islands, no Supabase calls).

### 5. `@serwist/astro` — the recommended tool, with caveats

The roadmap S-08 row says: *"PWA: installable mobile app via @serwist/astro"*. Mechanical reality (verified by inspecting the published tarball, the Serwist docs site, and the GitHub monorepo):

- **Version**: `@serwist/astro@10.0.0-preview.14` (published 2025-09-03, Node `>=20`). No stable release exists. The v9 line (`serwist@9.5.11`) is the last stable of the core, but `@serwist/astro` has only ever been on the v10 preview line.
- **Docs**: The published docs site `serwist.pages.dev` has nav for `/docs/next`, `/docs/nuxt`, `/docs/vite`, `/docs/webpack-plugin` — but no `/docs/astro` link. Direct navigation to `/docs/astro/getting-started` returns 404. The integration is real (it ships a working tarball with a real `AstroIntegration` default export), but the docs site has not been deployed for it.
- **GitHub**: The monorepo `main` branch has no `packages/astro/` directory. The package was first published 2025-04-21 and has stayed on preview through 14 patch revisions.
- **Mechanics**: `serwist(options)` returns an `AstroIntegration` whose `astro:config:setup` hook adds three Vite plugins (`mainPlugin`, `virtual`, `dev`) and whose `astro:build:done` hook calls `generateServiceWorker(ctx)`. Internally it wraps `vite-plugin-serwist` (which wraps `@serwist/build` — note: `@serwist/build` does **not** depend on `workbox-build`; it is a from-scratch reimplementation using `glob@11`, `source-map`, `zod`, `pretty-bytes`).
- **Build runtime**: `@serwist/build` runs in Node during the Astro build step. It does not run in workerd. So there is no risk of `fs`/`path`/Node-only code landing in the deployed worker.

**Recommendation for the plan**: pin to `@serwist/astro@10.0.0-preview.14` (or whatever the latest preview is at plan time), accept "preview dep, thin docs" as a known risk, and verify in `/10x-implement` by (a) running `npm install` and confirming peer resolution, (b) building with `astro build` and checking that `dist/sw.js` is emitted, (c) opening the deploy preview in Chrome DevTools → Application → Service Workers and confirming the worker is active with scope `/`. **Fallback option**: a hand-rolled `vite-plugin-serwist` + custom Astro integration (uses the same building blocks without the preview dep). The roadmap is right about the tool family; the preview status is the only thing to flag.

### 6. Cache-Control on `/sw.js` — the real Workers gotcha

Roadmap S-08 calls out `Service-Worker-Allowed` as a Cloudflare Workers risk. That header is **not** the binding risk for a SW at `/sw.js` controlling `/` — scope follows the registration path, not the header. The actual Workers gotchas for this slice:

- **Cache-Control on `/sw.js`**: Cloudflare's `assets` binding serves static files with a default `Cache-Control: public, max-age=14400` (4 hours). For a SW, that means an old worker sticks around for up to 4 hours after a deploy, even if the manifest hash changed. Fix: either (a) set `Cache-Control: public, max-age=0, must-revalidate` via a custom Worker route, or (b) use Serwist's default `skipWaiting: true` + `clientsClaim: true` (the plan should use the latter — it sidesteps the cache problem by forcibly activating the new worker on next page load).
- **Manifest Content-Type**: Cloudflare's assets binding serves `.webmanifest` as `application/manifest+json` by default (correct). Verify with `curl -I https://<deploy>/manifest.webmanifest` in E2E; if wrong, set via a custom Worker route.
- **Service worker scope**: for `navigator.serviceWorker.register('/sw.js')` with `sw.js` at the root, the default scope is `/`. No `Service-Worker-Allowed` header needed. If we ever nested the SW (e.g. `/assets/sw.js` to keep it out of the precache), the header would become necessary — but the default flat layout avoids that.

### 7. Precache strategy for `output: "server"`

Serwist's default `globDirectory: outDir` (= `./dist`) and default `globPatterns: ['**/*.{js,css,html,png,svg,ico,webp,avif}']` will walk `dist/`. In BitWorth's case, `dist/` contains:

- The SSR Worker bundle (`_worker.js`)
- Static files from `/public/` (favicon, template, plus the new manifest/icons/offline shell)
- Client-bundled JS/CSS under `_astro/` (content-hashed)
- **No `.html` files for routes** — every meaningful page is SSR with Supabase auth

So the precache manifest, with Serwist defaults, will include only the static `/public/` assets plus `/_astro/*` hashed JS/CSS (excluded by the default `dontCacheBustURLsMatching: /_astro\//` rule, which is correct — Vite's content-hash makes them cache-safe via HTTP cache, not SW precache). **Net precache**: empty-ish. This is the right outcome for an SSR app — we do not want to precache personal dashboard HTML.

The plan should add to the precache only:

- `/manifest.webmanifest`
- `/offline.html` (the new static shell — this is the meaningful precache entry)
- `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png`
- `/apple-touch-icon.png`
- The SW itself (`/sw.js`)

### 8. Runtime caching strategy (what to wire in `src/sw.ts`)

| Resource | Strategy | Why |
|----------|----------|-----|
| `sw.js` itself | (no Serwist strategy — handled by `skipWaiting` + `clientsClaim`) | Old SWs must die on deploy |
| `/public/*` static assets (manifest, icons, favicon) | `CacheFirst` with `maxEntries: 20`, `maxAgeSeconds: 30 * 24 * 60 * 60` (30 days) | Content-stable, small, low cardinality |
| `/_astro/*` JS/CSS | `StaleWhileRevalidate` with `maxEntries: 50`, `maxAgeSeconds: 7 * 24 * 60 * 60` | Content-hashed, want fresh copies on deploy |
| Navigation requests (`request.mode === 'navigate'`) | `NetworkFirst` with `networkTimeoutSeconds: 5`, falling back to `matchPrecache('/offline.html')` via `setCatchHandler` | Standard offline-shell pattern |
| `*.supabase.co` and `/api/*` (Supabase REST, app API) | **No strategy — pass through to network** | Caching a 401/200 mismatch is a security regression; Supabase auth requires a fresh session cookie every request |

The `setCatchHandler` block is the offline-shell entry point. It must return a `Response` with the precached offline shell for any failed navigation; non-navigation failures can return a generic 503 or `matchPrecache` on a relevant resource.

### 9. iOS install UX (no `beforeinstallprompt`)

iOS 26 still does not fire `beforeinstallprompt`. The install flow is Share → Add to Home Screen. Required pieces:

- `<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">` — iOS does not scale from the manifest icons; ship a real 180×180 PNG (and optionally 152×152 + 167×167 for iPad, but iOS falls back to 180×180 fine).
- `<meta name="apple-mobile-web-app-capable" content="yes">` — enables standalone mode.
- `<meta name="apple-mobile-web-app-title" content="BitWorth">` — home-screen label, overrides `short_name`; ≤12 chars recommended.
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` — required for true full-bleed; pairs with `viewport-fit=cover`.
- `<link rel="mask-icon" href="/icons/safari-pinned-tab.svg" color="#0a0a0a">` — Safari pinned-tab monochrome SVG.
- A dismissible "How to install" modal/banner: detect iOS + `display-mode !== 'standalone'`, show on first authed visit, hide after dismiss or install. Use a native `<dialog>` element for a11y and focus trap; persist dismissal in `localStorage` under a versioned key (e.g. `bw-ios-install-dismissed-v1`); clear on detected install via a `matchMedia('(display-mode: standalone)')` change listener.
- The `ios-pwa` npm package is unmaintained — hand-rolled `<dialog>` is the right call.

The Lucide icon set (already a project dep) has `Share` — reuse it for the modal illustration. Inline SVG for the "Add to Home Screen" step is fine; the plan should ship a small `InstallInstructionsModal.tsx` React island.

### 10. Android/Chrome install UX

Chromium fires `beforeinstallprompt` on `Window` once the page meets installability criteria (HTTPS, manifest with required fields, registered SW with `fetch` handler, ≥192 + ≥512 icons, user engagement heuristic). The flow:

1. Listen for `beforeinstallprompt`, call `event.preventDefault()`, stash the event in a `useRef`.
2. Show a manual "Install app" button in the Topbar (existing `TopbarMenu.tsx` pattern via Radix DropdownMenu is the right seam — roadmap S-06 specifically set up the Radix dropdown for S-08 to extend).
3. On click, call `stashedEvent.prompt()`, await `event.userChoice`, clear the stashed event.
4. On iOS, hide the button entirely (replaced by the modal flow).
5. On `display-mode: standalone`, hide the button entirely (already installed).
6. After the first user dismissal of the in-browser mini-infobar, Chrome enforces a ~30-day cooldown — apps cannot read or override this. The pattern of "user clicks our button → we call prompt()" bypasses the cooldown because it's the user's explicit gesture.

For BitWorth, the dev *is* the user, so engagement heuristics (≥30s dwell) are met trivially on the first authed visit.

### 11. Installed-state detection

Two reliable signals, used together:

- CSS: `@media (display-mode: standalone) { ... }` and `window.matchMedia('(display-mode: standalone)').matches`.
- iOS-specific: `window.navigator.standalone === true` is the only reliable iOS signal; the media query works since iOS 16.4 but `navigator.standalone` is the Apple-documented API.

Where: in `Layout.astro` as an inline `<script is:inline>` block in `<head>`, running before body render. Set `document.documentElement.dataset.installed = 'true' | 'false'`, then use CSS attribute selectors to avoid a flash of installable UI. SSR-safe because the data attribute is set client-side; the SSR markup defaults to `data-installed="false"` (installable UI shown), and the inline script promotes it to `data-installed="true"` before paint.

### 12. Manifest shape (recommendation)

```json
{
  "id": "/",
  "name": "BitWorth",
  "short_name": "BitWorth",
  "start_url": "/dashboard",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "description": "Privacy-first net worth tracker",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Notes:
- `id: "/"` is the W3C-recommended field (Chrome 109+) for matching the installed app's identity across manifest updates. Without it, a `start_url` change is treated as a new app. BitWorth has a single app on the dashboard's origin; `"/"` is correct.
- `theme_color` and `background_color` should be dark (matching the existing cosmic dark theme) but a future theme-color media query (`(prefers-color-scheme: light)`) for a light variant can be added in a `<meta name="theme-color" media="...">` block in the head if/when a light theme ships.
- `description` is recommended but not required.

### 13. Icon source — the one open user-owned prerequisite

`public/favicon.png` is 32×32 — too small to upscale. `public/template.png` is 1492×470 — wrong aspect ratio for a square icon. Options:

- **(a) Designer-provided 512×512 source** — ideal. Place under `public/icons/source-512.png` (or `design/` — wherever the team keeps design assets). Plan must wait for this before producing the maskable variant.
- **(b) Generated monogram from `favicon.png`** — defensible placeholder. The 32×32 favicon is a recognizable mark; a designer-quality monogram at 512×512 can be produced in an afternoon with the existing favicon as the seed. Roadmap S-08 unknown recommends this path. The plan should note that the 32×32 source limits the artistic detail (it is a single monogram, not a multi-element logo).
- **(c) Text/letter-based monogram** — ship an SVG with a "B" or the brand mark in the safe-zone inner 80% of a 512×512 canvas. Renders crisply at all sizes. Acceptable for a placeholder.

The plan should NOT silently upscale the 32×32 favicon. That's a quality regression visible to the user every time they see the home-screen icon.

### 14. Safe-area insets

`Layout.astro:18` viewport meta currently is `width=device-width` — missing `viewport-fit=cover`. S-08 must update to:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

CSS approach: define `--safe-top` / `--safe-bottom` in `:root` via `env(safe-area-inset-*)`, then apply `padding-top: var(--safe-top)` to the Topbar and `padding-bottom: max(env(safe-area-inset-bottom), 0px)` to the dashboard bottom-anchored content. Place in `src/styles/global.css` (which `Layout.astro:2` already imports) so the value is consistent across authed and unauthed pages.

The `black-translucent` status-bar style makes iOS's status bar float over the topbar — the topbar background must have enough contrast at the top edge.

### 15. Test seam implications

- `src/test-utils/supabase-mock.ts` is API-only; no UI/PWA seam exists.
- `test-plan.md:64` notes no DOM testing library is installed (`@testing-library/react` + `jsdom` deferred). A PWA install-banner unit test would need to drag that infrastructure in.
- `test-plan.md` has no PWA / install / offline / mobile-e2e rows in §2 (risk map) or §3 (phased rollout).
- `testing-critical-path-api-integration/plan.md:36` defers MSW (the HTTP-mock library — unrelated to PWA service workers) — no PWA test infrastructure is on the roadmap.

The plan should keep PWA testing minimal for the first ship: the Serwist integration is verified by `astro build` + DevTools inspection on a deploy preview (per roadmap S-08 risk callout). If the team wants a `vitest` unit test for the install-banner detection logic, that requires a new DOM-tooling decision (defer to a follow-up).

### 16. Adjacent prior decisions that enable this slice

- **Radix DropdownMenu** is the established menu primitive in S-06 — the Topbar install menu item is a natural extension. (`mobile-refactor/plan.md:154-157`).
- **CSS-only responsive swap pattern** (`mobile-refactor/plan.md:55`) — no `useMediaQuery`, no resize listener. The iOS-install banner should use the same `display-mode: standalone` media query pattern, not a JS event listener, to avoid hydration mismatch.
- **`Button size="icon"`** (`src/components/ui/button.tsx:25`) is already available for the install-button icon. No new component needed.
- **No responsive convention outside authed pages** (`mobile-refactor/plan.md:46`) — landing page `/` is unauthed and out of scope. S-08 must decide whether the iOS-install banner lives on the landing page or only on authed pages. **Recommendation**: only on authed pages, because the install flow is meaningful only after the user has seen the app's value (i.e. the dashboard). The landing page is for new visitors who haven't signed up yet — pushing install on them is premature.

### 17. Open user-owned prerequisite

The roadmap S-08 row at `context/foundation/roadmap.md:174` calls out:

> Brand icon source. The repo has only `public/favicon.png` (32×32) and a 1.2 MB marketing `template.png`. PWAs need a 192×192, 512×512, maskable variant, and a 180×180 Apple touch icon. (Owner: user, by: before S-08 planning) Recommendation: ship a placeholder monogram icon set generated from the existing favicon, designer can swap later.

This is the one item blocking `/10x-plan`. The plan should call out the decision explicitly and produce a placeholder set if no designer asset is available by then.

## Code References

- `src/layouts/Layout.astro:16-33` — single head emitter; every PWA tag lands here.
- `src/layouts/Layout.astro:18` — viewport meta `width=device-width`; needs `viewport-fit=cover` added.
- `src/layouts/Layout.astro:19` — only `<link rel="icon" type="image/png" href="/favicon.png" />`; manifest, apple-touch-icon, theme-color links must be added.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`; redirect-to-signin cascading failure on offline launches is the reason the SW must short-circuit.
- `src/middleware.ts:22-25` — `supabase.auth.getUser()` on every request; this is the network call that fails offline.
- `src/pages/dashboard.astro:16-18` — early-returns `Astro.redirect("/auth/signin")` if no user; same offline-cascade risk.
- `astro.config.mjs:12` — `integrations: [react(), sitemap()]`; add `serwist({...})` here.
- `wrangler.jsonc:5-8` — `assets.directory: ./dist`, `binding: "ASSETS"`; Serwist's `swDest: dist/sw.js` lands here. Update `public/.assetsignore` to exclude `sw.js` and friends.
- `wrangler.jsonc:4` — `compatibility_flags: ["nodejs_compat"]`; required for `@supabase/ssr`, not for Serwist.
- `tsconfig.json:11-12` — `paths: { "@/*": ["./src/*"] }`; SW source can use the alias or be in a dedicated `src/sw/` directory.
- `package.json:1-75` — no PWA deps; will add `@serwist/astro@10.0.0-preview.14`, `@serwist/window` (for the install button UI), `serwist` (peer of `@serwist/astro`).
- `public/favicon.png` — 32×32 RGBA, 733 B. Too small to upscale; a real 512×512 source is the open user-owned prerequisite.
- `public/template.png` — 1492×470, 1.2 MB. Wrong aspect ratio for a square PWA icon.
- `src/components/ui/button.tsx:25` — `Button size="icon"` variant already available for the install menu trigger.
- `src/components/Topbar.astro` + `TopbarMenu.tsx` — the Radix DropdownMenu seam for adding an "Install" menu item, established in S-06.

## Architecture Insights

1. **`output: "server"` is a feature, not a bug, for PWA.** The empty precache is the right outcome for an auth-gated SSR app. The SW becomes a thin offline-shell + install-prompt-facilitator, not a content cache.
2. **The Cloudflare Workers risk in the roadmap is mis-framed.** `Service-Worker-Allowed` is not the binding concern; the real concerns are (a) `Cache-Control` on `/sw.js` (handled by Serwist's `skipWaiting` + `clientsClaim`), (b) `.assetsignore` coverage of Serwist's emitted files, and (c) the manifest's `Content-Type` (Cloudflare default is correct; verify in E2E).
3. **Preview deps are a real cost.** `@serwist/astro` is at preview channel 14 with no docs page. The plan should pin the version, surface the risk explicitly, and have a fallback (hand-rolled `vite-plugin-serwist` + custom Astro integration, or a `@vite-pwa/astro` evaluation) if the preview breaks.
4. **The mobile-refactor's CSS-only responsive pattern is the right precedent for the iOS-install banner detection.** Use a `display-mode: standalone` media query, not a JS event listener, to stay consistent with the codebase's no-`useMediaQuery` convention.
5. **The Topbar Radix DropdownMenu seam is the right mount point for the Android/Chrome install button.** No new menu primitive needed; the S-06 plan specifically called this out as S-08's destination.
6. **No DOM testing library is installed, and the test plan's PWA coverage is empty.** The plan should keep testing scope to "build verifies, deploy preview verifies, manual smoke test verifies" for the first ship. A formal test rollout for PWA would be a separate slice (drag in `@testing-library/react` + `jsdom`).

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:38` — S-08 row in the At-a-glance table: *"install the app to a phone's home screen and launch it standalone at /dashboard"*. Prerequisites F-01, S-06, S-07 are all `done` (per the same table and the Done section at `roadmap.md:226-235`).
- `context/foundation/roadmap.md:165-178` — S-08 entry. The most detailed brief in the project for this slice. Lists unknowns (icon source, iOS banner UX, offline fallback, update strategy) with owners and recommended resolutions. Most of the recommendations are sound; the `@serwist/astro` stability claim is the one that needs adjusting.
- `context/foundation/roadmap.md:206` — Backlog handoff: *"PWA: installable mobile app via @serwist/astro"*. Confirms the planned change ID.
- `context/foundation/roadmap.md:174` — Open question: icon source. Owner: user, by: before S-08 planning. This is the one open user-owned prerequisite.
- `context/changes/mobile-refactor/plan-brief.md:8,29,52,96,97` — S-06 forward-references S-08: *"S-08 (PWA installable) may need a menu primitive for the iOS install banner… betting on `@radix-ui/react-dropdown-menu`."* Also: *"S-08 may revisit with `@serwist/astro` SW caching."*
- `context/changes/mobile-refactor/research.md:201,215,231` — Precedent logic for S-08 install-banner / first-authed-visit patterns reusing the Radix dropdown.
- `context/changes/mobile-refactor/plan.md:45,299` — Same forward-reference: Radix dropdown is the primitive S-08 will reuse.
- `context/changes/asset-list-mobile-reflow/plan-brief.md:45`, `plan.md:47` — *"PWA / install banner — out of scope (S-08)."* The S-07 slice explicitly defers PWA to S-08.
- `context/changes/mobile-refactor/plan.md:46` — *"No responsive convention outside authed pages."* This constrains S-08 to keep install-banner UI on authed routes only.
- `context/foundation/test-plan.md:64` — *"No DOM testing library, no jsdom, no happy-dom is installed."* Defers the §2 row #1 integration test on dashboard render to a follow-up phase. PWA testing would need to drag this in too.
- `context/changes/testing-critical-path-api-integration/plan.md:36` — Defers MSW (HTTP-mock library, unrelated to PWA service workers). No PWA test infrastructure is in the pipeline.
- `context/foundation/lessons.md` — All lessons are DB/API focused; no mobile/UI/PWA lessons to constrain S-08. The DB/API lessons do not apply.

## Open Questions

1. **Icon source** — owner: user. Three options in the design space (designer asset, favicon-derived monogram, SVG letterform). The plan should commit to one and surface the designer-swap-later escape hatch.
2. **`@serwist/astro` preview dep acceptance** — owner: planner. Pin to `10.0.0-preview.14` and accept the thin-docs risk, or fall back to a hand-rolled `vite-plugin-serwist` setup. The fallback is more code but uses the same stable underlying building blocks.
3. **Theme color for light vs dark mode** — the existing cosmic dark theme dominates; the manifest `theme_color` should be dark. A light-variant `theme-color` media query in `<head>` is optional and can be deferred to a future theme work.
4. **Install banner scope** — authed pages only (consistent with S-06's responsive scope) or also on the landing page (`/`)? The plan should pick one explicitly. Recommendation: authed-only.
5. **Offline shell content** — minimal "You're offline — open the app to see your data" message, or a more elaborate offline-first experience? The roadmap S-08 unknown recommends the former. The plan should commit to "static HTML + plain text message, no React islands, no Supabase calls".

## Related Research

This is the first research document for the `pwa-installable` change. Future related research (if the plan splits PWA into a sub-slice, e.g. an offline-content-cache follow-up) would link here.

Adjacent research from prior slices:
- `context/changes/mobile-refactor/research.md` — established the CSS-only responsive pattern, Radix dropdown seam, and Topbar architecture that S-08 will extend.
- `context/changes/asset-list-mobile-reflow/research.md` — most recent mobile work; explicitly defers PWA to S-08.
- `context/changes/crypto-price-fetch/research.md` — relevant only for the pattern of "verify external API from deployment target before committing" (the roadmap notes CoinGecko returned 403 from Workers; this slice uses Binance). The PWA plan should similarly verify Serwist's behavior in `wrangler dev` and on a deploy preview before shipping.

## Recommended Next Step

Run `/10x-plan pwa-installable`. The plan should:
- Pin `@serwist/astro@10.0.0-preview.14` with the preview-dep risk acknowledged.
- Decompose the slice into ~5-7 phases matching the file changes: (1) icon set + manifest, (2) SW + Serwist integration + `.assetsignore`, (3) `Layout.astro` head additions + viewport-fit, (4) offline shell, (5) Android/Chrome install button, (6) iOS install modal, (7) safe-area insets.
- Decide the icon source per the open user question; produce a placeholder set if no designer asset is available.
- Verify in `/10x-implement` with: `astro build` emits `dist/sw.js`, deploy preview's DevTools shows the SW active with scope `/`, `curl -I` on the manifest returns `Content-Type: application/manifest+json`, iOS Safari Share → Add to Home Screen produces a standalone launch at `/dashboard`, Android Chrome fires `beforeinstallprompt` on first authed visit.
- Not introduce a DOM testing library; rely on build + deploy-preview + manual smoke test for the first ship.
