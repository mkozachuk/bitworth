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
//
// `show_on_chart` opts an asset into the Asset Trends chart (S-12). `trend` is a
// per-snapshot multiplier (one per SNAPSHOT_NET_WORTHS entry) applied to `amount`
// to backdate each asset's snapshot_items value, so trend lines actually move and
// Top Movers (S-11) has a real baseline. Last multiplier < 1 (or > 1 for the
// liability) makes the live value differ from the last snapshot → Top Movers shows
// movement. The opted-in set is a deliberate mix: a steady grower, a volatile coin,
// a large stable asset, and a paid-down liability (rises in indexed mode).
const ASSETS: {
  name: string;
  amount: number;
  currency: string;
  category_id: string;
  crypto_symbol?: string;
  quantity?: number;
  show_on_chart?: boolean;
  trend: number[];
}[] = [
  {
    name: "Main Checking",
    amount: 8500,
    currency: "USD",
    category_id: "checking_account",
    trend: [0.9, 0.95, 0.88, 0.97, 0.99],
  },
  {
    name: "Emergency Fund",
    amount: 95000,
    currency: "PLN",
    category_id: "savings_account",
    trend: [0.85, 0.9, 0.93, 0.96, 0.98],
  },
  {
    name: "Index Funds (VWCE)",
    amount: 62000,
    currency: "USD",
    category_id: "stocks",
    show_on_chart: true,
    trend: [0.78, 0.85, 0.89, 0.93, 0.96],
  },
  {
    name: "Bitcoin",
    amount: 58000,
    currency: "USD",
    category_id: "crypto",
    crypto_symbol: "BTC",
    quantity: 0.85,
    show_on_chart: true,
    trend: [0.65, 0.92, 0.8, 1.04, 0.95],
  },
  {
    name: "Ethereum",
    amount: 18000,
    currency: "USD",
    category_id: "crypto",
    crypto_symbol: "ETH",
    quantity: 6.2,
    trend: [0.6, 0.88, 0.78, 1.02, 0.94],
  },
  {
    name: "Apartment",
    amount: 240000,
    currency: "EUR",
    category_id: "real_estate",
    show_on_chart: true,
    trend: [0.93, 0.94, 0.95, 0.96, 0.98],
  },
  {
    name: "Mortgage",
    amount: 120000,
    currency: "EUR",
    category_id: "loans_credit",
    show_on_chart: true,
    trend: [1.2, 1.15, 1.1, 1.05, 1.03],
  },
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

// Asset Balancer (S-15) target set: a subset of non-liability assets with a
// declared target % each, summing to 100 so the "Balance" shot shows a clean
// declared-vs-real comparison. Matched to ASSETS by name at seed time.
const ALLOCATION_TARGETS: { name: string; target_pct: number }[] = [
  { name: "Index Funds (VWCE)", target_pct: 35 },
  { name: "Apartment", target_pct: 30 },
  { name: "Bitcoin", target_pct: 25 },
  { name: "Emergency Fund", target_pct: 10 },
];

async function seedAssets(request: import("@playwright/test").APIRequestContext): Promise<void> {
  for (const a of ASSETS) {
    const form = new URLSearchParams();
    form.set("name", a.name);
    form.set("amount", String(a.amount));
    form.set("currency", a.currency);
    form.set("category_id", a.category_id);
    if (a.crypto_symbol) form.set("crypto_symbol", a.crypto_symbol);
    if (a.quantity !== undefined) form.set("quantity", String(a.quantity));
    if (a.show_on_chart) form.set("show_on_chart", "true");

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

  const { data: inserted, error } = await supabase
    .from("snapshots")
    .insert(rows)
    .select("id, created_at")
    .overrideTypes<{ id: string; created_at: string }[], { merge: false }>();
  if (error) throw new Error(`Seed snapshots failed: ${error.message}`);

  // Backdate per-asset snapshot_items so the Asset Trends chart (S-12) draws real
  // lines and Top Movers (S-11) has a baseline. Snapshots are ordered by created_at
  // ascending; the i-th snapshot uses each asset's i-th trend multiplier.
  const ordered = [...inserted].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (ordered.length === 0) throw new Error("Seed snapshots returned no rows");
  const items = ordered.flatMap((snap, i) =>
    ASSETS.map((a) => {
      const amount = Math.round(a.amount * a.trend[i]);
      return {
        snapshot_id: snap.id,
        name: a.name,
        category_id: a.category_id,
        original_amount: amount,
        original_currency: a.currency,
        // converted_amount is required + NOT NULL but unused by the trends chart and
        // Top Movers (both recompute from original_* at today's rates); a nominal
        // value keeps the row valid without pretending to be an exact conversion.
        converted_amount: amount,
        display_currency: "USD",
      };
    }),
  );

  const { error: itemsError } = await supabase.from("snapshot_items").insert(items);
  if (itemsError) throw new Error(`Seed snapshot_items failed: ${itemsError.message}`);
}

// Seed the Asset Balancer target set (S-15). Asset ids are generated at insert
// time, so resolve them by name via an authenticated supabase-js read, then PUT
// the targets through the same API the Balance page uses.
async function seedAllocationTargets(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be exported to seed allocation targets.");
  }

  const supabase = createClient(url, key);
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`supabase signin failed: ${authErr.message}`);

  const { data: rows, error } = await supabase
    .from("assets")
    .select("id, name")
    .eq("user_id", auth.user.id)
    .overrideTypes<{ id: string; name: string }[], { merge: false }>();
  if (error) throw new Error(`Read assets for allocation targets failed: ${error.message}`);

  const idByName = new Map(rows.map((r) => [r.name, r.id]));
  const payload = ALLOCATION_TARGETS.map((t) => {
    const asset_id = idByName.get(t.name);
    if (!asset_id) throw new Error(`Allocation target asset not found by name: ${t.name}`);
    return { asset_id, target_pct: t.target_pct };
  });

  const res = await request.put("/api/allocation-targets", {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify(payload),
  });
  if (!res.ok()) throw new Error(`Seed allocation targets failed: ${res.status()} ${await res.text()}`);
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

// The Asset Trends card (S-12) is collapsed by default; click its master toggle
// to reveal the chart, then wait for the lines to render. Returns the card
// locator so callers can capture a focused shot. Ephemeral state — re-reveal
// after every navigation.
async function revealAssetTrends(page: import("@playwright/test").Page) {
  const toggle = page.getByRole("button", { name: "Show asset trends" });
  await toggle.waitFor({ state: "visible" });
  await toggle.click();
  const card = page.locator("div.rounded-2xl").filter({ has: page.getByRole("heading", { name: "Asset Trends" }) });
  await card.locator(".recharts-line-curve").first().waitFor({ state: "visible" });
  await card.scrollIntoViewIfNeeded();
  return card;
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
  await seedAllocationTargets(page.request, email, password);

  // 3. Desktop product screenshots — dark (primary).
  await page.setViewportSize({ width: 1280, height: 1000 });

  await page.goto("/dashboard");
  await settleChart(page, /net worth trend/i);
  const trendsCard = await revealAssetTrends(page);
  await trendsCard.screenshot({ path: join(SHOTS_DIR, "asset-trends.png") });
  await page.screenshot({ path: join(SHOTS_DIR, "dashboard.png"), fullPage: true });

  await page.goto("/dashboard/assets");
  await page.getByRole("heading", { name: /assets/i }).waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(SHOTS_DIR, "assets.png"), fullPage: true });

  await page.goto("/dashboard/fire");
  await settleChart(page, /projected portfolio/i);
  await page.screenshot({ path: join(SHOTS_DIR, "fire.png"), fullPage: true });

  await page.goto("/dashboard/balancer");
  await page.getByRole("heading", { name: /asset balancer/i }).waitFor({ state: "visible" });
  await page.locator(".recharts-surface").first().waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(SHOTS_DIR, "balancer.png"), fullPage: true });

  await page.goto("/dashboard/settings");
  await page.getByRole("heading", { name: /settings/i }).waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(SHOTS_DIR, "settings.png"), fullPage: true });

  // 4. A few light-theme shots (dashboard + FIRE) to showcase the light theme.
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/dashboard");
  await settleChart(page, /net worth trend/i);
  await revealAssetTrends(page);
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
  await revealAssetTrends(mobilePage);
  await mobilePage.screenshot({ path: join(SHOTS_DIR, "mobile-dashboard.png"), fullPage: true });

  await mobilePage.goto("/dashboard/assets");
  await mobilePage.getByRole("heading", { name: /assets/i }).waitFor({ state: "visible" });
  await mobilePage.waitForLoadState("networkidle");
  await mobilePage.screenshot({ path: join(SHOTS_DIR, "mobile-assets.png"), fullPage: true });

  await mobilePage.goto("/dashboard/balancer");
  await mobilePage.getByRole("heading", { name: /asset balancer/i }).waitFor({ state: "visible" });
  await mobilePage.locator(".recharts-surface").first().waitFor({ state: "visible" });
  await mobilePage.waitForLoadState("networkidle");
  await mobilePage.screenshot({ path: join(SHOTS_DIR, "mobile-balancer.png"), fullPage: true });
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
