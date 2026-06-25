/**
 * TEMPORARY capture utility for the new Asset Balancer "Buy plan" card.
 * Seeds a throwaway account + allocation targets, opens the balancer, enters a
 * cash budget, and screenshots the buy plan (desktop + mobile). Not a behavioral
 * test — delete after review.
 */
import { test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTestUser } from "./helpers/auth";

const SHOTS_DIR = join(process.cwd(), "docs", "screenshots", "buy-plan");

const ASSETS = [
  { name: "Index Funds (VWCE)", amount: 62000, currency: "USD", category_id: "stocks" },
  { name: "Bitcoin", amount: 58000, currency: "USD", category_id: "crypto" },
  { name: "Emergency Fund", amount: 95000, currency: "PLN", category_id: "savings_account" },
  { name: "Apartment", amount: 240000, currency: "EUR", category_id: "real_estate" },
];

// Targets sum to 100. Apartment is deliberately huge vs its 15% target, so the
// buy-only water-filling clamps it to 0 and redistributes — exercises the
// interesting path in the screenshot.
const TARGETS = [
  { name: "Index Funds (VWCE)", target_pct: 40 },
  { name: "Bitcoin", target_pct: 30 },
  { name: "Emergency Fund", target_pct: 15 },
  { name: "Apartment", target_pct: 15 },
];

test("capture buy plan card", async ({ page, browser }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS_DIR, { recursive: true });

  const { email, password } = await createTestUser(page);

  for (const a of ASSETS) {
    const form = new URLSearchParams();
    form.set("name", a.name);
    form.set("amount", String(a.amount));
    form.set("currency", a.currency);
    form.set("category_id", a.category_id);
    const res = await page.request.post("/api/assets", {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: form.toString(),
    });
    if (!res.ok()) throw new Error(`Seed asset "${a.name}" failed: ${res.status()} ${await res.text()}`);
  }

  // Resolve asset ids by name, then PUT targets through the real API.
  const supabase = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_KEY ?? "");
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`supabase signin failed: ${authErr.message}`);
  const { data: rows, error } = await supabase
    .from("assets")
    .select("id, name")
    .eq("user_id", auth.user.id)
    .overrideTypes<{ id: string; name: string }[], { merge: false }>();
  if (error) throw new Error(`Read assets failed: ${error.message}`);
  const idByName = new Map(rows.map((r) => [r.name, r.id]));
  const payload = TARGETS.map((t) => ({ asset_id: idByName.get(t.name), target_pct: t.target_pct }));
  const putRes = await page.request.put("/api/allocation-targets", {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify(payload),
  });
  if (!putRes.ok()) throw new Error(`Seed targets failed: ${putRes.status()} ${await putRes.text()}`);

  // Desktop dark.
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto("/dashboard/balancer");
  await page.getByRole("heading", { name: /asset balancer/i }).waitFor({ state: "visible" });
  await page.locator(".recharts-surface").first().waitFor({ state: "visible" });

  // Enter a cash budget into the new card and let the plan compute.
  const budget = page.getByLabel("Available money to invest");
  await budget.scrollIntoViewIfNeeded();
  await budget.fill("50000");
  await page.getByRole("heading", { name: /buy plan/i }).waitFor({ state: "visible" });
  await page.getByText(/^Deployed/).waitFor({ state: "visible" });

  await page.screenshot({ path: join(SHOTS_DIR, "balancer-full-dark.png"), fullPage: true });

  // Focused shot of just the buy plan card.
  const card = page.locator("div.rounded-2xl").filter({ has: page.getByRole("heading", { name: /buy plan/i }) });
  await card.screenshot({ path: join(SHOTS_DIR, "buy-plan-card-dark.png") });

  // Light theme focused card.
  await page.emulateMedia({ colorScheme: "light" });
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: join(SHOTS_DIR, "buy-plan-card-light.png") });

  // Mobile dark.
  const androidUa =
    "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  const mobileCtx = await browser.newContext({
    baseURL: "http://localhost:4321",
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: androidUa,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto("/dashboard/balancer");
  await mobilePage.getByRole("heading", { name: /asset balancer/i }).waitFor({ state: "visible" });
  await mobilePage.locator(".recharts-surface").first().waitFor({ state: "visible" });
  const mBudget = mobilePage.getByLabel("Available money to invest");
  await mBudget.scrollIntoViewIfNeeded();
  await mBudget.fill("50000");
  await mobilePage.getByText(/^Deployed/).waitFor({ state: "visible" });
  await mobilePage.screenshot({ path: join(SHOTS_DIR, "buy-plan-mobile-dark.png"), fullPage: true });
  await mobileCtx.close();
});
