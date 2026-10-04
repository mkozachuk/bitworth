import { test, expect } from "@playwright/test";
import { signInAs } from "./session.ts";

test("stale priced holding shows the banner and Reprice now posts once", async ({ page, context, baseURL }) => {
  await signInAs(context, "stale", baseURL ?? "");

  // Fulfilled in the browser: the real endpoint would call a price API.
  let repriceCalls = 0;
  await page.route("**/api/assets/reprice", async (route) => {
    if (route.request().method() === "POST") repriceCalls += 1;
    await route.fulfill({ json: { data: { repriced: [], unchanged: [], failed: [] } } });
  });

  await page.goto("/dashboard");

  await expect(page.getByText("Price for 1 holding is 10 days old")).toBeVisible();
  const button = page.getByRole("button", { name: "Reprice now" });
  await expect(button).toBeVisible();

  const request = page.waitForRequest((req) => req.url().endsWith("/api/assets/reprice") && req.method() === "POST");
  await button.click();
  await request;

  // Nothing was refreshed, so the banner returns to idle without a reload.
  await expect(button).toBeEnabled();
  expect(repriceCalls).toBe(1);
});

test("only fresh priced holdings show no stale banner", async ({ page, context, baseURL }) => {
  await signInAs(context, "fresh", baseURL ?? "");

  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // The fresh fixture's net worth (6,000 ETH + 10,000 cash) proves the stub's data rendered.
  await expect(page.getByText("16,000.00 USD").first()).toBeVisible();
  await expect(page.getByText("days old")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reprice now" })).toHaveCount(0);
});
