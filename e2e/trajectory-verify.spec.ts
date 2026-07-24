// Re-runs the net-worth-trajectory plan's manual verification steps (2.5, 2.6,
// 3.5-3.10) against the running app, so the Progress ticks rest on observed
// behavior rather than recollection.
//
// Each test provisions its own user and seeds its own snapshot history directly
// in Postgres — snapshot `created_at` is server-defaulted through the API, and a
// trend needs points spread across real calendar days, so the seed goes in via
// SQL rather than POST /api/snapshots.
//
// NetWorthChart is a `client:load` island: its controls exist in the SSR HTML
// before React attaches handlers, so a bare fill()/click() can land on markup
// that no longer has state behind it. Every interaction below is wrapped in
// `toPass()` and gated on a state signal that only appears once React owns the
// DOM — never a fixed timeout.
import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { createTestUser } from "./helpers/auth";

const DB_CONTAINER = "supabase_db_bitworth";

/**
 * These tests seed snapshot history through the local Postgres container, so
 * they only make sense against `npx supabase start`. CI runs the e2e suite
 * against a remote Supabase, where that container does not exist — detect it and
 * skip rather than fail.
 */
function hasLocalDb(): boolean {
  try {
    execFileSync("docker", ["inspect", DB_CONTAINER], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function sql(query: string): string {
  return execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tAc", query], {
    encoding: "utf8",
  }).trim();
}

interface SeedPoint {
  daysAgo: number;
  value: number;
}

/** Insert snapshots for `email`, dated relative to now so the fit has a real time axis. */
function seedSnapshots(email: string, points: SeedPoint[], currency = "USD"): string {
  const userId = sql(`SELECT id FROM auth.users WHERE email = '${email}'`);
  if (!userId) throw new Error(`no auth user for ${email}`);
  for (const p of points) {
    sql(
      `INSERT INTO snapshots (user_id, total_net_worth, display_currency, base_currency, source, created_at) ` +
        `VALUES ('${userId}', ${p.value}, '${currency}', 'USD', 'manual', NOW() - INTERVAL '${p.daysAgo} days')`,
    );
  }
  return userId;
}

/**
 * Type into the target field, retrying until React has the value.
 *
 * Clearing first is load-bearing, not defensive: if the island hydrates *after*
 * a fill, React initialises its value tracker to the text already sitting in the
 * DOM, so re-filling the same string is not a change and onChange never fires.
 * Retrying a bare fill() would spin forever. Blanking the field guarantees a
 * real value transition on every attempt.
 */
async function setTarget(page: Page, value: string) {
  const input = page.getByLabel("Target (USD)");
  await expect(async () => {
    await input.fill("");
    await input.fill(value);
    await expect(page.getByText(/You'll reach|won't reach this/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

/** A clean, strongly-rising USD history: 4 points, 30 days apart, +5000 each. */
const RISING: SeedPoint[] = [
  { daysAgo: 90, value: 10000 },
  { daysAgo: 60, value: 15000 },
  { daysAgo: 30, value: 20000 },
  { daysAgo: 0, value: 25000 },
];

test.describe("net-worth-trajectory manual verification", () => {
  test.skip(!hasLocalDb(), "requires the local Supabase container (npx supabase start)");

  test("3.5 dotted projection joins the solid history and reads out a pace", async ({ page }, testInfo) => {
    const { email } = await createTestUser(page);
    seedSnapshots(email, RISING);

    await page.goto("/dashboard");

    await expect(page.getByRole("group", { name: "Projection model" })).toBeVisible();
    await expect(page.getByText(/At your current pace you'll reach/)).toBeVisible();
    await expect(page.getByText(/estimate, not financial advice/)).toBeVisible();

    await testInfo.attach("chart-linear", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("3.6 the Linear/CAGR toggle moves the line and the readout together", async ({ page }, testInfo) => {
    const { email } = await createTestUser(page);
    seedSnapshots(email, RISING);

    await page.goto("/dashboard");

    const linear = page.getByRole("button", { name: "Linear" });
    const cagr = page.getByRole("button", { name: "CAGR" });
    await expect(linear).toHaveAttribute("aria-pressed", "true");
    await expect(cagr).toBeEnabled();

    const pace = page.getByText(/At your current pace you'll reach/);
    const linearPace = await pace.textContent();

    // Retry the click until React owns the button and the pressed state flips.
    await expect(async () => {
      await cagr.click();
      await expect(cagr).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await expect(linear).toHaveAttribute("aria-pressed", "false");

    // The readout must track the model, not just the button styling.
    await expect(pace).not.toHaveText(linearPace ?? "");

    await testInfo.attach("chart-cagr", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("3.7 reachable and unreachable targets produce the right copy", async ({ page }) => {
    const { email } = await createTestUser(page);
    seedSnapshots(email, RISING);

    await page.goto("/dashboard");

    // Ahead of the last point but on the trend — reachable, so an ETA date.
    await setTarget(page, "100000");
    await expect(page.getByText(/You'll reach 100,000\.00 USD around /)).toBeVisible();

    // Behind the last historical point — the crossing is in the past, not ahead.
    await setTarget(page, "100");
    await expect(page.getByText("On your current trend, you won't reach this.")).toBeVisible();
  });

  test("3.8 negative net worth disables CAGR but keeps the linear projection", async ({ page }, testInfo) => {
    const { email } = await createTestUser(page);
    seedSnapshots(email, [
      { daysAgo: 90, value: -5000 },
      { daysAgo: 60, value: -3000 },
      { daysAgo: 30, value: -1000 },
      { daysAgo: 0, value: 1000 },
    ]);

    await page.goto("/dashboard");

    await expect(page.getByRole("button", { name: "CAGR" })).toBeDisabled();
    await expect(page.getByText("Compound projection needs positive history.")).toBeVisible();
    // Linear survives: still selected, still projecting.
    await expect(page.getByRole("button", { name: "Linear" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/At your current pace you'll reach/)).toBeVisible();

    await testInfo.attach("chart-negative", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("3.9 a single snapshot suppresses the projection and explains why", async ({ page }) => {
    const { email } = await createTestUser(page);
    seedSnapshots(email, [{ daysAgo: 0, value: 10000 }]);

    await page.goto("/dashboard");

    await expect(page.getByText("Not enough history yet — save more snapshots to see a projection.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Projection model" })).toHaveCount(0);
  });

  test("2.5 / 2.6 / 3.10 the settings toggle persists and gates the projection", async ({ page }) => {
    const { email } = await createTestUser(page);
    seedSnapshots(email, RISING);

    // Default on: the projection is present before we touch anything.
    await page.goto("/dashboard");
    await expect(page.getByRole("group", { name: "Projection model" })).toBeVisible();

    await page.goto("/dashboard/settings");
    const toggle = page.getByLabel("Show net-worth projection on dashboard");
    const save = page.getByRole("button", { name: "Save" });
    await expect(toggle).toBeChecked();

    // Save is `disabled={pending || !hasChanges}`, so it enabling is proof React
    // registered the uncheck rather than the DOM merely flipping pre-hydration.
    await expect(async () => {
      if (await toggle.isChecked()) await toggle.uncheck();
      await expect(save).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 15000 });

    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/user-preferences") && r.request().method() === "PUT",
    );
    await save.click();
    expect((await saved).ok()).toBe(true);

    // 2.5 — persists across a reload. The form reloads itself on success, so wait
    // that navigation out rather than racing it with a second reload.
    await page.waitForLoadState("load");
    await expect(page.getByLabel("Show net-worth projection on dashboard")).not.toBeChecked();

    // And again on a fresh request, proving it came back from the server.
    await page.goto("/dashboard/settings");
    await expect(page.getByLabel("Show net-worth projection on dashboard")).not.toBeChecked();

    // 3.10 / 2.6 — projection gone, but the chart itself renders as before.
    await page.goto("/dashboard");
    await expect(page.getByText("Net Worth Trend")).toBeVisible();
    await expect(page.getByRole("group", { name: "Projection model" })).toHaveCount(0);
    await expect(page.getByText(/At your current pace you'll reach/)).toHaveCount(0);
    await expect(page.getByText(/Not enough history yet/)).toHaveCount(0);
  });
});
