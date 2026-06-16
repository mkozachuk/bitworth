/**
 * README screenshot generator (not a behavioral test — a capture utility).
 *
 * Seeds a throwaway demo account in the LOCAL Supabase with a realistic,
 * multi-currency portfolio, backdated monthly snapshots (so the trend chart
 * has a curve) and FIRE inputs, then captures desktop + mobile PNGs into
 * docs/screenshots/.
 *
 * Run it:
 *   npx supabase start                       # local Supabase (Docker)
 *   export $(grep -v '^#' .env | xargs)      # SUPABASE_URL + SUPABASE_KEY
 *   npm run build && npm run preview         # serves on :4321
 *   npx playwright test e2e/capture-screenshots.spec.ts
 *
 * The backdated snapshots are inserted with an authenticated supabase-js client
 * (RLS lets a user write their own rows); the POST /api/snapshots route always
 * stamps created_at = now(), so it can't produce a multi-month history on its own.
 */
import { test, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTestUser } from "./helpers/auth";

const BASE_URL = process.env.PW_BASE_URL ?? "http://localhost:4321";
const SHOTS_DIR = join(process.cwd(), "docs", "screenshots");

// Realistic multi-currency portfolio. category_id values are the stable seed
// ids from supabase/seed.sql. Mixing USD/EUR/PLN showcases auto-conversion.
const ASSETS: {
  name: string;
  amount: number;
  currency: string;
  category_id: string;
  crypto_symbol?: string;
  quantity?: number;
}[] = [
  { name: "Main Checking", amount: 8500, currency: "USD", category_id: "checking_account" },
  { name: "Emergency Fund", amount: 95000, currency: "PLN", category_id: "savings_account" },
  { name: "Index Funds (VWCE)", amount: 62000, currency: "USD", category_id: "stocks" },
  { name: "Bitcoin", amount: 58000, currency: "USD", category_id: "crypto", crypto_symbol: "BTC", quantity: 0.85 },
  { name: "Ethereum", amount: 18000, currency: "USD", category_id: "crypto", crypto_symbol: "ETH", quantity: 6.2 },
  { name: "Apartment", amount: 240000, currency: "EUR", category_id: "real_estate" },
  { name: "Mortgage", amount: 120000, currency: "EUR", category_id: "loans_credit" },
];

// FIRE inputs (fractions for rates, per the user-preferences contract).
const FIRE = {
  fire_current_age: 32,
  fire_traditional_retirement_age: 65,
  fire_annual_income: 140000,
  fire_annual_expenses: 52000,
  // fire_starting_principal_override omitted → form seeds principal from live net worth
  fire_barista_income: 18000,
  fire_expected_return: 0.07,
  fire_inflation_rate: 0.025,
  fire_safe_withdrawal_rate: 0.04,
};

// Backdated monthly snapshots (USD), Jan 1 → last month, rising with one dip.
// Jan 1 of the current year drives the "Start" reference line + YTD delta.
const SNAPSHOT_NET_WORTHS = [350000, 362000, 357500, 375000, 388000];

async function seedAssets(request: import("@playwright/test").APIRequestContext): Promise<void> {
  for (const a of ASSETS) {
    const form = new URLSearchParams();
    form.set("name", a.name);
    form.set("amount", String(a.amount));
    form.set("currency", a.currency);
    form.set("category_id", a.category_id);
    if (a.crypto_symbol) form.set("crypto_symbol", a.crypto_symbol);
    if (a.quantity !== undefined) form.set("quantity", String(a.quantity));

    const res = await request.post("/api/assets", {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: form.toString(),
    });
    if (!res.ok()) throw new Error(`Seed asset "${a.name}" failed: ${res.status()} ${await res.text()}`);
  }
}

async function seedFire(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const res = await request.put("/api/user-preferences", {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify(FIRE),
  });
  if (!res.ok()) throw new Error(`Seed FIRE prefs failed: ${res.status()} ${await res.text()}`);
}

async function seedSnapshots(email: string, password: string): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_KEY must be exported to backdate snapshots. " +
        "Run: export $(grep -v '^#' .env | xargs)",
    );
  }

  const supabase = createClient(url, key);
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`supabase signin failed: ${authErr.message}`);
  const userId = auth.user.id;

  const year = new Date().getFullYear();
  const rows = SNAPSHOT_NET_WORTHS.map((netWorth, i) => ({
    user_id: userId,
    total_net_worth: netWorth,
    display_currency: "USD",
    base_currency: "USD",
    source: "auto",
    // Jan 1 at 00:00 UTC exactly so the chart's "Start" baseline (created_at <= Jan 1) matches.
    created_at: new Date(Date.UTC(year, i, 1, i === 0 ? 0 : 12, 0, 0)).toISOString(),
  }));

  const { error } = await supabase.from("snapshots").insert(rows);
  if (error) throw new Error(`Seed snapshots failed: ${error.message}`);
}

// Recharts draws its line with a ~1.5s reveal animation. This is a render-settle
// for image capture, not a behavioral wait — hence the bounded timeout below.
async function settleChart(page: import("@playwright/test").Page, heading: RegExp): Promise<void> {
  await page.getByRole("heading", { name: heading }).waitFor({ state: "visible" });
  const surface = page.locator(".recharts-surface").first();
  await surface.waitFor({ state: "visible" });
  await surface.scrollIntoViewIfNeeded();
  // Recharts' line reveal animation can leave the path clipped to a stale width
  // when the chart mounts below the fold. Pages here run with reducedMotion:"reduce",
  // which (Line defaults to isAnimationActive:"auto") draws the line statically —
  // so we just wait for the curve to be present.
  await page.locator(".recharts-line-curve").first().waitFor({ state: "visible" });
}

test("capture README screenshots", async ({ page, browser }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS_DIR, { recursive: true });

  // Theme follows prefers-color-scheme (seeded account keeps theme="system"), so
  // emulating colorScheme dark/light picks the theme. Dark is the primary set;
  // a couple of light shots showcase the light theme. reducedMotion disables
  // Recharts' reveal animation so lines render statically (see settleChart).
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });

  // 1. Public landing page (unauthenticated, desktop) — dark.
  const landingCtx = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const landingPage = await landingCtx.newPage();
  await landingPage.goto("/");
  await landingPage.waitForLoadState("networkidle");
  await landingPage.screenshot({ path: join(SHOTS_DIR, "landing.png"), fullPage: true });
  await landingCtx.close();

  // 2. Seed an authenticated demo account on the default (desktop) context.
  const { email, password } = await createTestUser(page);
  await seedAssets(page.request);
  await seedFire(page.request);
  await seedSnapshots(email, password);

  // 3. Desktop product screenshots — dark (primary).
  await page.setViewportSize({ width: 1280, height: 1000 });

  await page.goto("/dashboard");
  await settleChart(page, /net worth trend/i);
  await page.screenshot({ path: join(SHOTS_DIR, "dashboard.png"), fullPage: true });

  await page.goto("/dashboard/assets");
  await page.getByRole("heading", { name: /assets/i }).waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(SHOTS_DIR, "assets.png"), fullPage: true });

  await page.goto("/dashboard/fire");
  await settleChart(page, /projected portfolio/i);
  await page.screenshot({ path: join(SHOTS_DIR, "fire.png"), fullPage: true });

  // 4. A few light-theme shots (dashboard + FIRE) to showcase the light theme.
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/dashboard");
  await settleChart(page, /net worth trend/i);
  await page.screenshot({ path: join(SHOTS_DIR, "dashboard-light.png"), fullPage: true });

  await page.goto("/dashboard/fire");
  await settleChart(page, /projected portfolio/i);
  await page.screenshot({ path: join(SHOTS_DIR, "fire-light.png"), fullPage: true });

  // Reuse the authenticated session for the mobile contexts.
  const storageState = await page.context().storageState();

  // 5. Mobile product screenshots — dark (Pixel 5 → Android UA, no iOS install modal).
  const androidUa =
    "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  const mobileCtx = await browser.newContext({
    baseURL: BASE_URL,
    storageState,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: androidUa,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const mobilePage = await mobileCtx.newPage();

  await mobilePage.goto("/dashboard");
  await settleChart(mobilePage, /net worth trend/i);
  await mobilePage.screenshot({ path: join(SHOTS_DIR, "mobile-dashboard.png"), fullPage: true });

  await mobilePage.goto("/dashboard/assets");
  await mobilePage.getByRole("heading", { name: /assets/i }).waitFor({ state: "visible" });
  await mobilePage.waitForLoadState("networkidle");
  await mobilePage.screenshot({ path: join(SHOTS_DIR, "mobile-assets.png"), fullPage: true });
  await mobileCtx.close();

  // 6. iOS install instructions modal — dark (iPhone UA → InstallInstructionsModal shows).
  const iosCtx = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: BASE_URL,
    storageState,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const iosPage = await iosCtx.newPage();
  await iosPage.goto("/dashboard");
  await iosPage.getByRole("heading", { name: /install bitworth/i }).waitFor({ state: "visible" });
  await iosPage.screenshot({ path: join(SHOTS_DIR, "mobile-install.png") });
  await iosCtx.close();
});
