# PWA Installable (S-08) Implementation Plan

## Overview

Make BitWorth an installable Progressive Web App: users can add the site to a phone's home screen (iOS via Share → Add to Home Screen; Android/Chrome via the deferred `beforeinstallprompt` flow), and the app launches as a standalone full-bleed experience at `/dashboard` — no browser chrome, safe-area insets respected, and a minimal offline shell served by the service worker when the network is gone.

Slices: icon set, `manifest.webmanifest`, service worker (hand-rolled on `vite-plugin-pwa` — see "Key Decisions" for why), `Layout.astro` head additions, `offline.html` shell, Android install button in the Topbar dropdown, iOS install modal. All install-prompt UI is gated to authed routes and hidden when the app is already running in `display-mode: standalone`.

## Current State Analysis

The `feature/pwa` branch has **no PWA code landed** — verified by `grep -r "manifest\|serviceWorker\|beforeinstallprompt\|apple-touch-icon\|theme-color" src/` returning zero matches. Every installability gate is currently failing.

- `src/layouts/Layout.astro:19` — only `<link rel="icon" type="image/png" href="/favicon.png" />`; no manifest, no apple-touch-icon, no theme-color, no `viewport-fit=cover`.
- `astro.config.mjs:12` — `integrations: [react(), sitemap()]`; no PWA plugin.
- `package.json` — no `vite-plugin-pwa`, no `workbox-*` deps; `overrides.vite: ^7.3.2` is the only PWA-adjacent entry.
- `public/` — only `favicon.png` (32×32, 733 B) and `template.png` (1492×470, 1.2 MB — wrong aspect ratio).
- `public/.assetsignore` — only `_worker.js` and `_routes.json`; no SW exclusions.
- `wrangler.jsonc:7-11` — `assets.directory: ./dist`, `binding: "ASSETS"`, `not_found_handling: "404-page"`. SW will live at `dist/sw.js` and serve from the same binding.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`; offline launches cascade through `supabase.auth.getUser()` failure → redirect to `/auth/signin` (which also needs network) → Cloudflare error. The SW's `setCatchHandler` must short-circuit this for navigation requests.

Adjacent prior decisions this slice builds on:
- **S-06 (mobile-refactor)**: established the Radix `DropdownMenu` seam in `TopbarMenu.tsx` (verified — `TopbarMenu.tsx:1-77`); forward-references S-08 as the install-button destination.
- **S-06 (mobile-refactor)**: established "no `useMediaQuery` outside authed pages" convention (`mobile-refactor/plan.md:46`); this slice uses the same `display-mode: standalone` CSS-only media-query pattern.
- **S-07 (asset-list-mobile-reflow)**: explicitly defers PWA work to S-08 (`asset-list-mobile-reflow/plan-brief.md:45`, `plan.md:47`).
- **`Button size="icon"`** (`src/components/ui/button.tsx:25`): available for the install-button icon — no new component needed.
- **`global.css`** is imported at `src/layouts/Layout.astro:2`; safe-area CSS variables land there.

## Desired End State

A user with a BitWorth account can:

1. On **iOS Safari**: see a dismissible "How to install" modal on first authed visit, follow the Share → Add to Home Screen flow, and launch a standalone BitWorth app that opens at `/dashboard` with the cosmic dark theme, no Safari chrome, safe-area-inset-aware top/bottom padding.
2. On **Android/Chrome**: see an "Install app" item in the Topbar dropdown on first authed visit, tap it to trigger the install prompt, accept, and launch the same standalone experience.
3. When **offline** (installed, no network): launch the app and see a minimal offline shell ("You're offline — open the app when you have a connection") instead of a Cloudflare error or a redirect-cascade failure. The offline shell has no React islands, no Supabase calls, and no client JS.
4. **Update flow** is invisible: a freshly-deployed SW takes over on the user's next navigation, with no toast or reload prompt.
5. **Already-installed state is undetectable to the user** — no install button, no modal — when the app is in `display-mode: standalone`.

### Key Discoveries

- **`vite-plugin-pwa@1.3.0`** is the only stable PWA-build library compatible with Astro 6 + Vite 7. `@serwist/astro` is preview-channel 14 (no stable since 2025-08); `@vite-pwa/astro@1.2.0` caps its peer at `astro@^5.0.0`. Hand-rolling the integration is ~15 lines of Astro boilerplate around `vite-plugin-pwa`.
- **`output: "server"` works in our favour** — every meaningful page is SSR, so the precache contains only static assets (manifest, icons, offline shell, favicon, `/_astro/*` hashed JS/CSS). No risk of precaching private dashboard HTML.
- **Cloudflare Workers gotcha is `Cache-Control` on `/sw.js`**, not `Service-Worker-Allowed`. The default `assets` binding serves static files with `Cache-Control: public, max-age=14400` (4 h). `vite-plugin-pwa`'s default `registerType: "autoUpdate"` + `skipWaiting: true` + `clientsClaim: true` bypasses the cache by forcibly activating the new SW on next nav.
- **iOS has no `beforeinstallprompt`** as of iOS 26; the install flow is Share → Add to Home Screen, which means the modal UX is mandatory, not optional.
- **The favicon is too small to upscale** (32×32). The plan produces a 512×512 monogram source from the favicon as a placeholder; the file is structured so a designer can swap it later.

## What We're NOT Doing

- **DOM testing library** (`@testing-library/react` + `jsdom`) — the test plan (`test-plan.md:64`) defers this; PWA verification is build + deploy-preview + manual smoke test, not unit tests.
- **Push notifications, background sync, fullscreen API** — iOS PWA limitations called out in the roadmap S-08 risk block. Out of scope.
- **Light-mode theme color** — the existing cosmic dark theme dominates; `theme_color` is dark. A `<meta name="theme-color" media="(prefers-color-scheme: light)">` variant can be added in a future theme slice.
- **Install-prompt UI on the landing page (`/`)** — visitors haven't seen the app's value yet; pushing install on them is premature. Modal is authed-only (consistent with S-06's responsive scope).
- **Caching Supabase API responses or authed dashboard HTML** — caching a 401/200 mismatch is a security regression. SW passes through `*.supabase.co` and `/api/*` to the network.
- **Custom service-worker scope beyond `/`** — Serwist/vite-plugin-pwa default scope is `/`; no `Service-Worker-Allowed` header is needed for this scope.
- **Updating `public/template.png`** — wrong aspect ratio; not a PWA concern.
- **Designer-quality icon set** — placeholder monogram only. Designer can swap the source file later.

## Implementation Approach

1. **Hand-rolled `vite-plugin-pwa` integration in `astro.config.mjs`.** No `@serwist/astro` preview dep; no `@vite-pwa/astro` Astro-5 cap. A custom `astro:config:setup` hook injects `VitePWA({...})` into the Vite plugin chain, and an `astro:build:done` hook calls `injectServiceWorker` for the workbox-build output. The integration is ~15 lines; everything else uses the stable `vite-plugin-pwa` public API.

2. **Monogram icon source → manifest + icons.** Generate a 512×512 monogram PNG from the existing 32×32 favicon. The 192/512/maskable-512/apple-touch-180/safari-pinned-SVG outputs are derived from this source. Source file lives at `public/icons/source-512.png` so a designer can drop in a replacement without touching the build.

3. **Layout head updates are additive.** `Layout.astro:16-33` is the only `<head>` emitter; every PWA tag lands there. `viewport-fit=cover` joins the existing viewport meta. A new `data-installed` attribute on `<html>` is set by an inline `<script is:inline>` block before paint.

4. **CSS-only install detection.** `display-mode: standalone` media query hides install-prompt UI; `navigator.standalone === true` is checked as a fallback for older iOS. No React-side `useMediaQuery`, no hydration boundary, no flash of installable UI.

5. **Service worker is content-thin by design.** Precaches only `/manifest.webmanifest`, the icons, the favicon, and `/offline.html`. Runtime caching is `CacheFirst` for `/public/*` and `StaleWhileRevalidate` for `/_astro/*`. Supabase and `/api/*` pass through. `setCatchHandler` returns the precached `/offline.html` for failed navigation requests.

6. **iOS modal is a React island, Android button is a Topbar item.** Both are gated to `/dashboard/*` (the `client:load` directive lives on the authed layout, not the root layout). iOS modal uses native `<dialog>` for a11y + focus trap; dismissal persists in `localStorage` under a versioned key.

## Critical Implementation Details

- **vite-plugin-pwa is dev-misleading.** In dev, the SW is registered but doesn't precache; the manifest is served as a static file from `public/`. To verify the precache, run `npm run build` and inspect `dist/sw.js` and `dist/manifest.webmanifest`. The build script (Phase 2) must include `astro build` as a verification step.
- **iOS `display-mode: standalone` media query is iOS 16.4+ only.** Older iOS uses `window.navigator.standalone`. Both must be checked; the inline script handles both.
- **`.assetsignore` must exclude `sw.js`, `sw.js.map`, and any `workbox-*.js` files** emitted by `vite-plugin-pwa`. Wrangler's `assets` binding will try to serve them via the SSR worker otherwise.
- **`offline.html` is a static page, not a route.** It lives in `public/` and is served by the SW's `setCatchHandler`. It must not import any Astro component, React island, or client JS — it has to work even when the network is down.
- **`Topbar.astro` renders `TopbarMenu` with `client:load` only on `sm:hidden` (mobile)**, not on the desktop nav. The install-button item must be visible to desktop browsers too (so Android/Chrome users on desktop can install). Decision: put the install button as a *separate* Topbar item, always visible, between the existing nav links and the signout form, OR add it to the desktop nav as a dedicated `<a>`-styled button. The mobile menu gets the same item via the existing `TopbarMenu` extension.

## Phase 1: Icon set + manifest

### Overview

Produce the icon set BitWorth needs to be installable on iOS and Android, and ship the `manifest.webmanifest` that ties the icons to a standalone display mode. The icons are generated from a 512×512 monogram source derived from the existing 32×32 favicon — a placeholder that a designer can swap by replacing one file.

### Changes Required:

#### 1. Monogram source + icon variants

**File**: `public/icons/source-512.png` (new)

**Intent**: A 512×512 monogram source PNG that all other icon variants are derived from. Designer-replaceable. The image is a "B" or brand mark in the safe-zone inner 80% of a 512×512 canvas. The exact letterform/mark is a one-afternoon design decision; for the placeholder, render the existing 32×32 favicon scaled up using a high-quality nearest-neighbour pass to preserve crisp edges at icon scale, then clean up the artefacts.

**Contract**: A square 512×512 RGBA PNG. Solid dark background (matches the cosmic dark theme — `#0a0a0a` is fine), light foreground. Safe zone is the inner 80% (40px margin on all sides). A designer dropping a different file at this path (any 512×512 PNG) is the single swap point.

**File**: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`, `public/apple-touch-icon.png`, `public/icons/safari-pinned-tab.svg` (new)

**Intent**: Derived icon variants. The 192/512/maskable-512 PNGs are exported from the source; the maskable variant is the source with a 40px outer fill (no logo) so Android can crop into the safe zone without losing the mark. The 180×180 apple-touch-icon is exported at 180×180. The safari-pinned-tab is a monochrome SVG of the monogram for Safari pinned-tab UI.

**Contract**:
- `icon-192.png`: 192×192 PNG, RGBA, purpose `any`.
- `icon-512.png`: 512×512 PNG, RGBA, purpose `any`.
- `icon-maskable-512.png`: 512×512 PNG, RGBA, purpose `maskable` — 40px outer fill of `#0a0a0a`, then the source image composited on top.
- `apple-touch-icon.png`: 180×180 PNG, RGBA. iOS does not scale from the manifest icons.
- `safari-pinned-tab.svg`: monochrome SVG, single `<path>` of the monogram, fill `currentColor`. (iOS Safari will colour it.)

**How to generate** (one-time, manually): use any local image tool (ImageMagick, or a short Node script using `sharp`) to:
1. Upscale `public/favicon.png` to 512×512 with a high-quality filter and place it on a `#0a0a0a` background.
2. Export the four PNGs at the right sizes.
3. Compose the maskable variant with a 40px outer fill.
4. Hand-author the safari-pinned-tab SVG (a single monochrome path of the "B" mark).

Alternative: ship a `scripts/build-icons.mjs` Node script using `sharp` (added as a devDep) so the icon set is reproducible. This is preferred — the script lives in the repo, can be re-run, and a designer replacing `source-512.png` can re-derive all variants with one command.

#### 2. Manifest

**File**: `public/manifest.webmanifest` (new)

**Intent**: The W3C web app manifest. The `id` field pins the app's identity across manifest updates; `start_url` opens at `/dashboard`; `scope: "/"` matches the SW scope; `display: "standalone"` enables the no-chrome fullscreen experience; `theme_color` and `background_color` are dark to match the cosmic theme.

**Contract**: A JSON object with the fields below. Path: `public/manifest.webmanifest` (served at `/manifest.webmanifest`).

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

#### 3. Update `.assetsignore`

**File**: `public/.assetsignore`

**Intent**: Exclude `vite-plugin-pwa`'s emitted files from the Wrangler `assets` binding so the SSR worker doesn't try to serve them. The binding serves anything in `dist/` by default; the SW and its assets must be served by the binding (so the browser can reach them) but the SW's *source* files shouldn't be served as if they were routed pages.

**Contract**: Append `sw.js`, `sw.js.map`, and `workbox-*.js` to the existing list (currently `_worker.js` and `_routes.json`).

### Success Criteria:

#### Automated Verification:

- All icon files exist at the expected paths: `ls public/icons/source-512.png public/icons/icon-192.png public/icons/icon-512.png public/icons/icon-maskable-512.png public/apple-touch-icon.png public/icons/safari-pinned-tab.svg`
- `public/manifest.webmanifest` is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('public/manifest.webmanifest', 'utf8'))"`
- `.assetsignore` includes the new entries: `grep -E '^sw\.js$|^workbox-' public/.assetsignore`
- Type checking passes: `npm run build` (no Astro integration wiring yet, but the build will surface any pre-existing type errors that block later phases).
- Linting passes: `npm run lint`.

#### Manual Verification:

- Open `public/icons/source-512.png` in any image viewer — confirm the monogram is legible at 512×512.
- Open `public/icons/icon-maskable-512.png` — confirm the 40px safe-zone border is visually balanced.
- Open `public/manifest.webmanifest` in a JSON viewer — confirm all icon paths resolve to existing files.

**Implementation Note**: Pause here for manual confirmation that the monogram is acceptable (or request a designer swap) before Phase 2 starts using these icons in the build.

---

## Phase 2: vite-plugin-pwa wiring + service worker

### Overview

Wire `vite-plugin-pwa@1.3.0` into `astro.config.mjs` via a custom Astro integration (avoiding the preview `@serwist/astro` dep and the Astro-5-capped `@vite-pwa/astro`). Author `src/sw.ts` with the precache + runtime caching strategy. Register the SW client-side in the authed layout. Update `.assetsignore` is part of Phase 1; this phase verifies the build emits the SW and the manifest is reachable from the SSR worker.

### Changes Required:

#### 1. Install deps

**File**: `package.json`

**Intent**: Add `vite-plugin-pwa@^1.3.0` and `workbox-window@^7.4.1` as devDependencies; `workbox-window` is also needed at runtime to register the SW from the client. `sharp@^0.33` as a devDependency if Phase 1's icon-generation script uses it.

**Contract**: Three new entries under `devDependencies`:
- `vite-plugin-pwa`
- `workbox-window`
- `sharp` (only if using the script approach for icon generation)

Run `npm install` (the user explicitly confirmed in CLAUDE.md: never run `npm install` during dev — only do it at the start of an `/10x-implement` phase, not in `/10x-plan`).

#### 2. Astro integration

**File**: `src/integrations/pwa.ts` (new)

**Intent**: A small custom Astro integration that calls `VitePWA(...)` with the project-specific config. Uses `astro:config:setup` to inject the plugin into Vite, and `astro:build:done` to call `injectServiceWorker` (if needed — `vite-plugin-pwa` handles this internally for the `swDest: "dist/sw.js"` default).

**Contract**:
- Imports `VitePWA` from `vite-plugin-pwa` (a default export).
- Returns an `AstroIntegration` with name `pwa`.
- `astro:config:setup({ updateConfig })`: calls `updateConfig({ vite: { plugins: [VitePWA({ ...options })] } })`.
- `astro:build:done({ dir })`: no-op for our config — `vite-plugin-pwa` handles the build hook internally.

**`VitePWA` options**:
```ts
{
  registerType: "autoUpdate",        // skipWaiting + clientsClaim default-on
  strategies: "generateSW",          // use Workbox generateSW (not InjectManifest)
  injectRegister: false,             // we'll register manually so we can gate to authed routes
  swDest: "dist/sw.js",
  manifest: false,                   // manifest lives in public/ (no need to inject)
  workbox: {
    globDirectory: "dist/",
    globPatterns: [
      "**/*.{js,css,html,png,svg,ico,webp,avif,webmanifest}"
    ],
    cleanupOutdatedCaches: true,
    navigateFallback: "/offline.html",
    navigateFallbackDenylist: [/^\/api\//, /^https:\/\/.*\.supabase\.co\//],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith("/icons/") || url.pathname === "/favicon.png" || url.pathname === "/apple-touch-icon.png",
        handler: "CacheFirst",
        options: {
          cacheName: "bitworth-static-assets",
          expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 }
        }
      },
      {
        urlPattern: ({ url }) => url.pathname.startsWith("/_astro/"),
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "bitworth-astro-assets",
          expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 }
        }
      }
    ]
  },
  devOptions: {
    enabled: false,                  // no SW in dev — keeps HMR fast
    type: "module"
  }
}
```

**Why `injectRegister: false` + manual registration in the authed layout**: The auto-injected register script ships on every page (landing page too), which would register the SW for unauthed visitors. We want the SW only for users who are about to see install-prompt UI, i.e. authed visitors on `/dashboard/*`. The manual registration is in `src/layouts/DashboardLayout.astro` (the authed layout — verified to exist via the mobile-refactor work).

#### 3. Service worker source

**File**: `src/sw.ts` (new)

**Intent**: The TypeScript source for the SW. With `strategies: "generateSW"`, this file is *not* the SW itself — `vite-plugin-pwa` generates a Workbox SW based on the `workbox` config above. We use `generateSW` (not `InjectManifest`) because we don't need custom SW logic — the precache + runtime caching config is fully expressed in `astro.config.mjs`.

**Contract**: A placeholder `src/sw.ts` that exports a no-op `// service worker logic is in astro.config.mjs` comment, or — if we want to author custom fetch handlers later — switches to `InjectManifest` mode. **Recommendation: keep the file as a one-line placeholder so the path is reserved.** When a future slice needs custom SW logic (e.g. background sync), it can switch `strategies: "InjectManifest"` and add a fetch handler here.

#### 4. Wire the integration into Astro

**File**: `astro.config.mjs`

**Intent**: Import the new `pwa()` integration and add it to the `integrations` array.

**Contract**:
```js
import pwa from "./src/integrations/pwa";
// ...
integrations: [react(), sitemap(), pwa()],
```

#### 5. Register the SW in the authed layout

**File**: `src/layouts/DashboardLayout.astro`

**Intent**: Use `workbox-window` to register the SW only on authed routes. `workbox-window`'s `Workbox` class handles `skipWaiting` + `clientsClaim` semantics for `autoUpdate` registration.

**Contract**: A `<script>` block in the authed layout (after the body) that:
1. Dynamically imports `workbox-window`'s `Workbox` class.
2. Instantiates `new Workbox('/sw.js')`.
3. Calls `.register()` and swallows the `uncontrolled` callback warning (a known Workbox thing — register succeeds even if the SW isn't yet controlling the page).

**Note**: `workbox-window` is ~2 KB gzipped; the dynamic import means it's not in the initial bundle. The authed layout is already client-side heavy.

### Success Criteria:

#### Automated Verification:

- `npm run build` exits 0 and produces `dist/sw.js`: `test -f dist/sw.js`.
- `dist/manifest.webmanifest` is emitted to the build (or remains the same as `public/manifest.webmanifest` if not in `public/`): `test -f dist/manifest.webmanifest` (this should be true because `public/manifest.webmanifest` is copied to `dist/`).
- TypeScript checks pass: `npm run build` (Astro's `astro check` step).
- Linting passes: `npm run lint`.

#### Manual Verification:

- Run `npm run preview` (which serves `dist/` locally). Open in Chrome, DevTools → Application → Service Workers: confirm `/sw.js` is registered with scope `/`. (NB: `npm run preview` uses Astro's preview server, not Wrangler — Cloudflare-specific behaviour like `Cache-Control` headers needs `wrangler dev` or a deploy preview. For Phase 2 success criteria, Astro preview is sufficient.)
- DevTools → Application → Manifest: confirm the manifest is parsed (name, icons, start_url all populated).
- Reload the page hard (Ctrl+Shift+R): the SW is still registered and the new build's SW takes over (no errors in the Console).
- Run `wrangler dev` and verify the SW is served: `curl -I http://localhost:8787/sw.js` should return `Content-Type: application/javascript`.

**Implementation Note**: Pause for manual confirmation that the SW is registered and the manifest parses before Phase 3 wires the `<link>` and `<meta>` tags.

---

## Phase 3: Layout.astro head + safe-area insets

### Overview

Add every PWA-related `<head>` element (manifest link, apple-touch-icon, mask-icon, theme-color, standalone/apple-mobile-web-app-* tags) to `src/layouts/Layout.astro`. Update the viewport meta to `viewport-fit=cover`. Add CSS custom properties for safe-area insets to `global.css` and apply them to the Topbar and dashboard bottom-anchored content. Add an inline `<script is:inline>` that sets `data-installed` on `<html>` before paint so install-prompt UI is hidden via CSS when the app is already in `display-mode: standalone`.

### Changes Required:

#### 1. Head additions

**File**: `src/layouts/Layout.astro`

**Intent**: Add manifest link, apple-touch-icon, mask-icon, theme-color, apple-mobile-web-app-* tags. Update viewport meta to `viewport-fit=cover`. Add the inline `data-installed` script.

**Contract** — additions inside `<head>` (after the existing favicon link, before the title):

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
<link rel="mask-icon" href="/icons/safari-pinned-tab.svg" color="#0a0a0a" />
<meta name="theme-color" content="#0a0a0a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="BitWorth" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="description" content="Privacy-first net worth tracker" />
```

**The `data-installed` inline script** (after the existing theme-detection script):

```html
<script is:inline>
  (function () {
    var installed = false;
    try {
      installed = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    } catch (e) {}
    document.documentElement.dataset.installed = installed ? "true" : "false";
  })();
</script>
```

**Why `<script is:inline>`** (not a `.ts` file): it must run before paint to avoid a flash of installable UI. `is:inline` is the Astro-idiomatic way to ensure no module wrapping / no async deferral.

#### 2. Safe-area CSS variables

**File**: `src/styles/global.css`

**Intent**: Define `--safe-top` and `--safe-bottom` custom properties in `:root` so the values are consistent across authed and unauthed pages. The values are `env(safe-area-inset-*)` with `0px` fallback for non-iOS browsers.

**Contract**: Append to `:root`:

```css
:root {
  --safe-top: max(env(safe-area-inset-top), 0px);
  --safe-bottom: max(env(safe-area-inset-bottom), 0px);
}
```

**File**: `src/styles/global.css` (or `src/components/Topbar.astro`'s scoped style)

**Intent**: Apply the safe-area insets to the Topbar's top padding and the dashboard's bottom padding.

**Contract**: The Topbar's existing `class="... px-4 py-2 ..."` gains `pt-[max(env(safe-area-inset-top),0.5rem)]` (or similar). The dashboard layout gains a `pb-[var(--safe-bottom)]` on its bottom-anchored content (likely the bottom of the page wrapper — needs verification against the current dashboard.astro markup, but the CSS variable is the contract).

#### 3. Update existing viewport meta

**File**: `src/layouts/Layout.astro:18`

**Intent**: The current `width=device-width` doesn't include `viewport-fit=cover`, which is required for `env(safe-area-inset-*)` to work in iOS standalone mode.

**Contract**: Replace the existing viewport meta with the one listed in the head additions above. This is a one-line change, but it pairs with the head additions as a single intent.

### Success Criteria:

#### Automated Verification:

- All PWA tags present in the head: `grep -E 'rel="manifest"|rel="apple-touch-icon"|name="theme-color"|name="apple-mobile-web-app-capable"|name="viewport".*viewport-fit=cover' src/layouts/Layout.astro` returns non-empty matches.
- Inline `data-installed` script present: `grep 'dataset.installed' src/layouts/Layout.astro`.
- Safe-area CSS variables defined: `grep '\-\-safe-top\|\-\-safe-bottom' src/styles/global.css`.
- Type checking passes: `npm run build`.
- Linting passes: `npm run lint`.

#### Manual Verification:

- Open `npm run preview` in Chrome DevTools → Elements tab → confirm the head contains all 6 PWA meta/link tags.
- DevTools → Rendering → "Emulate CSS media feature `display-mode: standalone`": the inline script should set `data-installed="true"` on `<html>` before paint. Toggle the emulation and observe.
- Resize the viewport to iPhone 14 Pro dimensions in DevTools and confirm the Topbar's top padding responds to the safe-area env value (visible as extra padding at the top of the Topbar in standalone mode emulation).

**Implementation Note**: Pause for manual confirmation that the head tags parse cleanly and the safe-area insets are visible.

---

## Phase 4: Offline shell

### Overview

Author `public/offline.html` — a self-contained static page with no React islands, no client JS, and no Supabase calls. Served by the SW's `setCatchHandler` (via Workbox's `navigateFallback` config) when a navigation request fails. Styled to match the cosmic dark theme so the user sees a familiar BitWorth look even offline.

### Changes Required:

#### 1. Offline page

**File**: `public/offline.html` (new)

**Intent**: A static HTML shell that renders "You're offline" with a retry button. Plain CSS (no Tailwind, no Astro). The page links to `/favicon.png` for the tab icon and uses inline SVG for the icon. Includes `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` for standalone-mode rendering.

**Contract**: A single-file HTML page with:
- `<!doctype html>` and `<html lang="en">` with `class="dark"` (forces dark theme).
- Title: "BitWorth — Offline".
- Inline `<style>` block with the cosmic dark theme colours: background `#0a0a0a`, text `#e4e4e7`, accent `#a78bfa` (purple, matching the existing Topbar links).
- A centred card with: a download/offline icon (inline SVG, lucide-style), an h1 "You're offline", a paragraph "BitWorth needs a connection to load your dashboard. Reconnect and try again.", and a "Retry" button (a plain `<button>` with an `onclick="location.reload()"`).
- The button's reload triggers a network request, which fails offline but the user expects to retry. The button is a no-op when truly offline; on flaky connections, it can succeed.

**No client-side JS beyond the inline onclick handler.** No external requests. No fonts (system font stack only).

**Pre-cache verification**: Phase 2's `navigateFallback: "/offline.html"` config means Workbox emits this file into the precache manifest, so the SW serves it on failed navigations.

### Success Criteria:

#### Automated Verification:

- File exists: `test -f public/offline.html`.
- No external requests in the HTML: `grep -E 'src="http|href="http' public/offline.html` returns empty.
- No `<script src=` or `<link rel="stylesheet" href=` references: `grep -E '<script\s+src=|<link[^>]+stylesheet' public/offline.html` returns empty (inline only).
- Build emits `offline.html` in the precache: `grep offline.html dist/sw.js` (or the workbox manifest within `sw.js`).
- Linting passes: `npm run lint`.

#### Manual Verification:

- Run `npm run preview`, open Chrome DevTools → Application → Service Workers → confirm the SW is active. Then DevTools → Network → set throttling to "Offline". Navigate to any page: the offline page should render with the cosmic dark theme and the "Retry" button.
- Resize the viewport to mobile dimensions: the offline page should be readable and centred.

**Implementation Note**: Pause for manual confirmation that the offline experience feels intentional, not broken.

---

## Phase 5: Android/Chrome install button

### Overview

Add a manual "Install app" trigger to the Topbar. On Android/Chrome, the button calls `beforeinstallprompt.prompt()` on the deferred event. On iOS, the button is hidden (the iOS modal in Phase 6 handles iOS install). When the app is already in `display-mode: standalone`, the button is hidden. The button must be visible on both desktop and mobile Chrome so Android/Chrome desktop users can install too.

### Changes Required:

#### 1. New `InstallButton` React island

**File**: `src/components/InstallButton.tsx` (new)

**Intent**: A small React island that listens for `beforeinstallprompt`, stashes the event, and exposes a click handler. Renders a button (or null when the platform doesn't support install, or when the app is already installed, or when the user is on iOS).

**Contract**:
- Imports `useState`, `useRef` from React.
- Imports `Download` from `lucide-react` and `Button` from `@/components/ui/button`.
- On mount (in a `useEffect`), listens for `beforeinstallprompt` and stashes the event in a ref. Also listens for `appinstalled` to clear the ref.
- Detects iOS via `navigator.userAgent` (or `/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)`) and returns `null`.
- Detects installed via `window.matchMedia('(display-mode: standalone)').matches` (also set up as a listener so the button hides after install).
- On click, calls `stashedEvent.prompt()`, awaits `userChoice`, clears the ref.
- Returns either `null` (iOS, not-yet-installable, or already installed) or a `<Button variant="ghost" size="sm">` with the `Download` lucide icon and the label "Install app".

**Note**: This component is `client:load` on the authed layout. It's a small island, not a context provider.

#### 2. Wire into the authed Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Render the `InstallButton` island inside the authed Topbar — between the existing nav links and the signout form on desktop, and as a new item at the top of the `TopbarMenu` dropdown on mobile.

**Contract**:
- Add `<InstallButton client:load />` (or a sub-layout import) inside the authed branch (the `user ?` block at `Topbar.astro:11`).
- Position: after the "Settings" link, before the signout form. On mobile, the `TopbarMenu` gets a new `<DropdownMenu.Item>` (passed as a prop or via a context) so the button is reachable from the dropdown.
- The button is hidden on iOS and when already installed (handled in the component itself).

#### 3. TopbarMenu extension

**File**: `src/components/TopbarMenu.tsx`

**Intent**: Add an "Install app" item to the dropdown menu, rendered before the signout separator. The item is a slot/prop or a sub-component so it only shows on Android/Chrome (the `InstallButton` itself hides on iOS and standalone).

**Contract**:
- Accept a new optional prop `installSlot?: React.ReactNode`.
- Render `{installSlot}` as a `<DropdownMenu.Item>` (or a non-clickable label if `installSlot` is null) before the existing `<DropdownMenu.Separator>`.
- In `Topbar.astro`, pass `<InstallButton client:load />` as the `installSlot` prop.

**Why pass as a slot instead of importing directly**: keeps `TopbarMenu` decoupled from the install flow. A future slice that wants a different install trigger can swap the slot content.

### Success Criteria:

#### Automated Verification:

- `src/components/InstallButton.tsx` exists and exports a default React component.
- `TopbarMenu.tsx` accepts the new `installSlot` prop: `grep "installSlot" src/components/TopbarMenu.tsx`.
- `Topbar.astro` renders `InstallButton` in the authed branch: `grep -E "InstallButton|installSlot" src/components/Topbar.astro`.
- Type checking passes: `npm run build`.
- Linting passes: `npm run lint` (specifically the `react-compiler` rule, since this is a React component).

#### Manual Verification:

- Run `npm run preview`, open in Chrome desktop. The "Install app" button should appear in the Topbar. Click it: the install prompt should appear (Chrome's mini-infobar with "Install" / "Cancel").
- Emulate iOS Safari in DevTools (Device Toolbar → iPhone). The "Install app" button should be hidden.
- Toggle `display-mode: standalone` emulation in DevTools → Rendering: the button should hide.
- Resize to mobile width: the dropdown menu should contain the "Install app" item (verifying the TopbarMenu extension).

**Implementation Note**: Pause for manual confirmation that the install button is reachable and the install prompt fires.

---

## Phase 6: iOS install modal

### Overview

A dismissible React island that shows iOS users how to install BitWorth via Share → Add to Home Screen. Native `<dialog>` for a11y and focus trap. Persists dismissal in `localStorage`. Hidden when the app is in `display-mode: standalone`. Gated to authed routes via the `client:load` directive on the authed layout.

### Changes Required:

#### 1. `InstallInstructionsModal` React island

**File**: `src/components/InstallInstructionsModal.tsx` (new)

**Intent**: A modal that detects iOS Safari + non-standalone mode, and shows a 3-step "How to install" prompt. Uses native `<dialog>` for the focus trap, escape-to-close, and backdrop. The dismissal persists in `localStorage` under a versioned key so a future redesign of the modal triggers re-prompting.

**Contract**:
- Imports `useEffect`, `useRef`, `useState` from React.
- Imports `X`, `Share`, `Plus` from `lucide-react`.
- On mount:
  - Detect iOS Safari: `/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)` (the iPad-on-Mac-Safari-13 case).
  - Detect already installed: `window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true`.
  - Check `localStorage.getItem('bw-ios-install-dismissed-v1')` — if present, don't show.
  - If all three pass (iOS + not installed + not dismissed), show the dialog.
- On dismiss, set `localStorage.setItem('bw-ios-install-dismissed-v1', Date.now().toString())`.
- Renders a `<dialog>` element with:
  - A header with "Install BitWorth" title and a close (X) button.
  - Step 1: "Tap the **Share** button" with the lucide `Share` icon.
  - Step 2: "Scroll and tap **Add to Home Screen**" with the lucide `Plus` icon.
  - Step 3: "Tap **Add** in the top right."
  - A "Got it" dismiss button at the bottom.
- Closes on `Escape` keypress and on backdrop click.
- Uses `useEffect` to call `dialog.showModal()` on mount (the modal is closed by default; `showModal()` triggers the focus trap).
- The `client:load` directive lives on the authed layout — the modal is unreachable on the landing page.

#### 2. Wire into the authed layout

**File**: `src/layouts/DashboardLayout.astro`

**Intent**: Render the modal once at the bottom of the authed layout, outside any other container, so the native `<dialog>` can position itself over the viewport.

**Contract**: Append `<InstallInstructionsModal client:load />` after the existing `<slot />` (or equivalent) in the authed layout. The `client:load` directive is required because the modal's mount-time detection logic must run on the client.

**Note**: The modal is hidden via CSS when `data-installed="true"` on `<html>`, so on subsequent navigations after install it won't re-prompt.

### Success Criteria:

#### Automated Verification:

- `src/components/InstallInstructionsModal.tsx` exists and exports a default React component.
- The modal is rendered in the authed layout: `grep "InstallInstructionsModal" src/layouts/DashboardLayout.astro`.
- Type checking passes: `npm run build`.
- Linting passes: `npm run lint` (specifically `react-compiler` and `jsx-a11y`).

#### Manual Verification:

- Emulate iOS Safari in DevTools (Device Toolbar → iPhone). Reload the page: the modal should appear with the three steps. The lucide icons should render. The "Got it" button should dismiss and the dismissal should persist across reloads.
- Toggle `display-mode: standalone` emulation: the modal should not appear.
- Resize to desktop width: the modal should not appear (only iOS Safari shows it; on Android/Chrome the deferred `beforeinstallprompt` flow handles install).
- Reload after clicking "Got it": the modal should not reappear (localStorage persistence).
- Open DevTools → Application → Local Storage → confirm the `bw-ios-install-dismissed-v1` key is set.
- Test the focus trap: press Tab repeatedly while the modal is open — focus should stay inside the dialog.

**Implementation Note**: This is the last phase. After manual verification, the plan is complete and S-08 is shippable.

---

## Testing Strategy

### Build-time Verification (automated, runs in `/10x-implement` per phase)

- `npm run build` exits 0 and emits `dist/sw.js`, `dist/manifest.webmanifest`, and the precached `offline.html` (visible in the workbox manifest inside `sw.js`).
- `npm run lint` exits 0 across all phases.
- `npm run preview` serves the build locally; `curl -I http://localhost:4321/manifest.webmanifest` returns `Content-Type: application/manifest+json`.

### Deploy-Preview Verification (manual, at end of S-08)

- `wrangler deploy` (or push to a branch that auto-deploys). On the deploy preview URL:
  - Chrome DevTools → Application → Service Workers: SW is active, scope `/`.
  - Chrome DevTools → Application → Manifest: parses cleanly, all icons resolve.
  - `curl -I https://<deploy>/sw.js` returns `200` with `Content-Type: application/javascript`.
  - `curl -I https://<deploy>/manifest.webmanifest` returns `200` with `Content-Type: application/manifest+json`.
  - Lighthouse → Installable: passes the PWA installability audit.
- iOS Safari on a real device (or BrowserStack): Share → Add to Home Screen produces a standalone app icon. Launching it opens `/dashboard` with no Safari chrome, dark status bar, safe-area insets respected.
- Android Chrome on a real device: the "Install app" button in the Topbar triggers the install prompt. Accept → home-screen icon appears. Launching it opens `/dashboard` standalone.
- Offline test (Chrome DevTools → Network → Offline): navigate to a page; the offline shell renders.

### Unit / Integration Tests

None for this slice. The existing test infrastructure is API-only (`src/test-utils/supabase-mock.ts`); a UI/PWA test would require dragging in `@testing-library/react` + `jsdom`, which `test-plan.md:64` defers to a follow-up phase. The PWA verification above is build + deploy-preview + manual smoke test, consistent with the S-08 roadmap entry's risk callout.

If a future slice wants to unit-test the install-button's `beforeinstallprompt` handling or the iOS-modal dismissal logic, that's a separate test-rollout slice that adds the DOM testing infrastructure.

### Manual Smoke Checklist (run after Phase 6, on a deploy preview)

1. **iOS install flow**: iOS Safari → auth → see modal → follow steps → home screen icon → tap icon → standalone launch → no Safari chrome → safe-area insets visible at top/bottom.
2. **Android install flow**: Android Chrome → auth → see "Install app" button → tap → accept prompt → home screen icon → tap → standalone launch.
3. **Already-installed on iOS**: tap the home-screen icon → app opens → no modal, no install button.
4. **Already-installed on Android**: same as iOS.
5. **Offline launch (installed)**: airplane mode → tap home-screen icon → offline shell renders, no redirect cascade, no Cloudflare error.
6. **Update flow**: deploy a SW change → user reopens the app on next nav → new SW takes over (visible in DevTools → Service Workers → "Source" shows new timestamp), no toast, no error.
7. **Lighthouse PWA audit**: passes.

## Performance Considerations

- **`workbox-window` is dynamically imported** in the authed layout — ~2 KB gzipped, only loaded on authed routes.
- **The inline `data-installed` script is ~10 lines of JS** — runs before paint, no bundle impact.
- **The precache size is tiny**: manifest (~1 KB JSON), 5 icon PNGs (~50 KB total at the sizes shipped), offline.html (~3 KB), `/_astro/*` excluded by default. Total initial cache: ~55 KB. Acceptable.
- **No runtime caching of Supabase or `/api/*` responses** — every request goes to the network. The cost of an extra network round-trip per page load is offset by the security guarantee (no stale auth).
- **`display-mode` media query is CSS-only** — no JS resize listener, no `useMediaQuery` hook, no re-renders.

## Migration Notes

- **No DB schema changes.** The `users` table, RLS policies, and all migrations are untouched.
- **No env var changes.** `SUPABASE_URL` and `SUPABASE_KEY` are unchanged.
- **Wrangler config unchanged.** `assets.directory: "./dist"` and the `ASSETS` binding continue to serve static files; the SW and manifest are now among them.
- **Backwards compatibility**: users who had the site open before the deploy will have a stale SW (or no SW). On their next reload, the new SW registers, takes over on the *next* nav, and they see no install-prompt UI until they visit an authed route. No data loss, no broken state.
- **Designers replacing the icon source**: drop a new 512×512 PNG at `public/icons/source-512.png` and re-run the icon-generation script (if Phase 1 used one) or re-export the variants manually. The rest of the slice requires no changes.

## References

- Research: `context/changes/pwa-installable/research.md`
- Roadmap S-08: `context/foundation/roadmap.md:165-179`
- Roadmap Backlog Handoff: `context/foundation/roadmap.md:206`
- Mobile refactor (S-06) — Radix dropdown seam + no-`useMediaQuery` convention: `context/changes/mobile-refactor/plan.md:45,46,154-157,299`
- Mobile refactor (S-07) — defers PWA: `context/changes/asset-list-mobile-reflow/plan-brief.md:45`, `plan.md:47`
- Existing test plan — defers DOM testing library: `context/foundation/test-plan.md:64`
- `vite-plugin-pwa` docs: https://vite-pwa-org.netlify.app/
- `workbox-window` docs: https://developer.chrome.com/docs/workbox/modules/workbox-window
- iOS PWA limitations: https://webkit.org/blog/12445/

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Icon set + manifest

#### Automated

- [x] 1.1 All icon files exist at the expected paths — 1aedc70
- [x] 1.2 `public/manifest.webmanifest` is valid JSON — 1aedc70
- [x] 1.3 `.assetsignore` includes `sw.js`, `sw.js.map`, `workbox-*.js` — 1aedc70
- [x] 1.4 `npm run build` passes — 1aedc70
- [x] 1.5 `npm run lint` passes — 1aedc70

#### Manual

- [ ] 1.6 Monogram is legible at 512×512 (or designer asset swapped in)

### Phase 2: vite-plugin-pwa wiring + service worker

#### Automated

- [x] 2.1 `vite-plugin-pwa`, `workbox-window`, (optional) `sharp` added to devDependencies — aebee6f
- [x] 2.2 `src/integrations/pwa.ts` exists with the VitePWA config — aebee6f
- [x] 2.3 `src/sw.ts` placeholder exists — aebee6f
- [x] 2.4 `astro.config.mjs` imports and wires the `pwa()` integration — aebee6f
- [x] 2.5 `dist/sw.js` is emitted by `npm run build` — aebee6f
- [x] 2.6 `dist/manifest.webmanifest` is emitted by `npm run build` — aebee6f
- [x] 2.7 TypeScript checks pass (`npm run build`) — aebee6f
- [x] 2.8 `npm run lint` passes — aebee6f

#### Manual

- [ ] 2.9 SW registers with scope `/` in Chrome DevTools on `npm run preview`
- [ ] 2.10 Manifest parses cleanly in DevTools → Application → Manifest
- [ ] 2.11 `wrangler dev` serves `/sw.js` with correct Content-Type

### Phase 3: Layout.astro head + safe-area insets

#### Automated

- [x] 3.1 All 6 PWA meta/link tags present in `Layout.astro` `<head>` — f2e5600
- [x] 3.2 Viewport meta includes `viewport-fit=cover` — f2e5600
- [x] 3.3 Inline `data-installed` script present — f2e5600
- [x] 3.4 `--safe-top` / `--safe-bottom` CSS variables defined in `global.css` — f2e5600
- [x] 3.5 `npm run build` passes — f2e5600
- [x] 3.6 `npm run lint` passes — f2e5600

#### Manual

- [ ] 3.7 Head tags parse cleanly in DevTools → Elements
- [ ] 3.8 `display-mode: standalone` emulation sets `data-installed="true"` before paint
- [ ] 3.9 Safe-area insets visible in standalone-mode emulation on iPhone viewport

### Phase 4: Offline shell

#### Automated

- [x] 4.1 `public/offline.html` exists — 11bfbf7
- [x] 4.2 No external requests in `offline.html` (`grep` returns empty) — 11bfbf7
- [x] 4.3 No external `<script src=` or `<link rel="stylesheet">` in `offline.html` — 11bfbf7
- [x] 4.4 `offline.html` is in the Workbox precache manifest — 11bfbf7
- [x] 4.5 `npm run lint` passes — 11bfbf7

#### Manual

- [ ] 4.6 Offline shell renders when network is throttled to "Offline" in DevTools
- [ ] 4.7 Shell is readable and centred on mobile viewport

### Phase 5: Android/Chrome install button

#### Automated

- [x] 5.1 `src/components/InstallButton.tsx` exists — 7e5f507
- [x] 5.2 `TopbarMenu.tsx` accepts `installSlot` prop — ADAPTED: direct import instead of slot prop (see note below) — 7e5f507
- [x] 5.3 `Topbar.astro` renders `<InstallButton client:load />` in the authed branch — 7e5f507
- [x] 5.4 `npm run build` passes (TS check) — 7e5f507
- [x] 5.5 `npm run lint` passes (react-compiler, jsx-a11y) — 7e5f507

> **Adaptation note**: The plan's `installSlot?: React.ReactNode` indirection was meant to decouple `TopbarMenu` from `InstallButton`, but Astro's `client:load` directive cannot appear inside a JSX prop value (`<TopbarMenu installSlot={<InstallButton client:load />} />` is a parser error). The adapted approach imports `InstallButton` directly in `TopbarMenu.tsx` and passes the dropdown's `itemClass` styling through a new optional `className` prop on `InstallButton`. The decoupling is preserved at the call site (`Topbar.astro` is the only place that decides where to mount the button), and the install-button contract (iOS hide, standalone hide, `beforeinstallprompt` stash) is unchanged.

#### Manual

- [x] 5.6 "Install app" button visible in Chrome desktop Topbar — 7e5f507
- [x] 5.7 Clicking the button triggers Chrome's install prompt — 7e5f507
- [x] 5.8 Button hidden in iOS Safari emulation — 7e5f507
- [x] 5.9 Button hidden when `display-mode: standalone` is emulated — 7e5f507
- [x] 5.10 Mobile dropdown menu contains the "Install app" item — 7e5f507

### Phase 6: iOS install modal

#### Automated

- [ ] 6.1 `src/components/InstallInstructionsModal.tsx` exists
- [ ] 6.2 `DashboardLayout.astro` renders `<InstallInstructionsModal client:load />`
- [ ] 6.3 `npm run build` passes
- [ ] 6.4 `npm run lint` passes

#### Manual

- [ ] 6.5 Modal appears on iOS Safari emulation, not on Android/desktop
- [ ] 6.6 Modal hidden when `display-mode: standalone` is emulated
- [ ] 6.7 "Got it" dismisses the modal and persists in localStorage
- [ ] 6.8 `localStorage` key `bw-ios-install-dismissed-v1` is set after dismiss
- [ ] 6.9 Focus trap works: Tab stays inside the dialog while open
- [ ] 6.10 Reload after dismiss does not re-show the modal
