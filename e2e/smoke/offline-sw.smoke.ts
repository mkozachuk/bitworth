import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { signInAs } from "./session.ts";

// NB-120 (offline option B): the service worker sends every navigation to the
// network and serves the precached /offline.html only when that request fails.
// One context for the whole file, because the SW installed in row a is the one
// that rows b-e test. Set SMOKE_SHOTS_DIR to save one PNG per row as evidence.

const OFFLINE_TITLE = "BitWorth — Offline";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

async function shot(name: string): Promise<void> {
  const dir = process.env.SMOKE_SHOTS_DIR;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext({ baseURL });
  page = await context.newPage();
  await signInAs(context, "fresh", baseURL ?? "");
});

test.afterAll(async () => {
  await context.close();
});

test("a. SW registers, activates and controls /dashboard after reload", async () => {
  await page.goto("/dashboard");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();

  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      registered: reg !== undefined,
      scope: reg?.scope ?? null,
      state: reg?.active?.state ?? null,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    };
  });
  expect(sw.registered).toBe(true);
  expect(sw.state).toBe("activated");
  expect(new URL(sw.controller ?? "", page.url()).pathname).toBe("/sw.js");
  expect(new URL(sw.scope ?? "", page.url()).pathname).toBe("/");
  await shot("a-sw-activated");
});

test("b. online navigations get the real page, not the offline page", async () => {
  for (const [url, title] of [
    ["/dashboard", "Dashboard"],
    ["/", "BitWorth"],
  ] as const) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page).toHaveTitle(title);
    await shot(`b-online-${url === "/" ? "root" : "dashboard"}`);
  }
  await expect(page).not.toHaveTitle(OFFLINE_TITLE);
});

test("c. offline navigation to /dashboard serves the offline page", async () => {
  await context.setOffline(true);
  try {
    const response = await page.goto("/dashboard");
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page).toHaveTitle(OFFLINE_TITLE);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await shot("c-offline-dashboard");
  } finally {
    await context.setOffline(false);
  }
});

test("d. logged out with the SW installed: /dashboard goes to sign-in, / is the landing page", async () => {
  await context.clearCookies();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth\/signin$/);
  await expect(page).toHaveTitle("Sign in");
  await shot("d-loggedout-dashboard");

  const root = await page.goto("/");
  expect(root?.status()).toBe(200);
  await expect(page).toHaveTitle("BitWorth");
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).not.toBeNull();
  await shot("d-loggedout-root");
});

test("e. /offline.html redirects 307 -> /offline, yet the precached entry is a 200 page", async () => {
  const raw = await context.request.get("/offline.html", { maxRedirects: 0 });
  expect(raw.status()).toBe(307);
  expect(raw.headers().location).toBe("/offline");

  const entry = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (!name.includes("precache")) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname !== "/offline.html") continue;
        const response = await cache.match(request);
        const html = (await response?.text()) ?? "";
        return {
          cache: name,
          status: response?.status ?? null,
          redirected: response?.redirected ?? null,
          title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null,
        };
      }
    }
    return null;
  });
  expect(entry).not.toBeNull();
  expect(entry?.status).toBe(200);
  expect(entry?.redirected).toBe(false);
  expect(entry?.title).toBe("BitWorth — Offline");
  await page.setContent(
    `<pre>${JSON.stringify({ offlineHtml: raw.status(), location: "/offline", entry }, null, 2)}</pre>`,
  );
  await shot("e-precache-entry");
});
