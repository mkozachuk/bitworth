import { test, expect } from "@playwright/test";
import { createTestUser } from "./helpers/auth";

test("empty account can save a zero-value snapshot", async ({ page }) => {
  await createTestUser(page);

  await page.goto("/dashboard");

  await expect(page.getByRole("button", { name: /save snapshot/i })).toBeVisible();

  const snapshotResponse = page.waitForResponse(
    (res) => res.url().includes("/api/snapshots") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: /save snapshot/i }).click();
  const response = await snapshotResponse;
  expect(response.status()).toBe(201);

  await page.waitForURL("/dashboard");

  const snapshotsRes = await page.request.get("/api/snapshots");
  const { data } = (await snapshotsRes.json()) as { data: { total_net_worth: number }[] };
  expect(data).toHaveLength(1);
  expect(data[0].total_net_worth).toBe(0);
});
