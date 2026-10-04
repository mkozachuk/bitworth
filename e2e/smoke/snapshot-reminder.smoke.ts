import { test, expect } from "@playwright/test";
import { signInAs } from "./session.ts";

const REMINDER = "It's been 40 days since your last snapshot";

test("overdue snapshot reminder shows and Dismiss hides it", async ({ page, context, baseURL }) => {
  await signInAs(context, "stale", baseURL ?? "");

  await page.goto("/dashboard");

  const reminder = page.getByText(REMINDER);
  await expect(reminder).toBeVisible();

  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(reminder).toBeHidden();
});

test("dismissed snapshot reminder stays hidden after reload", async ({ page, context, baseURL }) => {
  await signInAs(context, "stale", baseURL ?? "");

  await page.goto("/dashboard");
  const reminder = page.getByText(REMINDER);
  await expect(reminder).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(reminder).toBeHidden();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(reminder).toBeHidden();
});
