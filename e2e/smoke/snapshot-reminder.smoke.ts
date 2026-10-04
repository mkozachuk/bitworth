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
  // Known product bug, measured on 8de6262: after a reload the banner is still
  // in the DOM although localStorage holds the exact latest created_at and every
  // island has hydrated; a second Dismiss click is inert. SnapshotReminderBanner
  // reads localStorage in its useState initializer, so hydration disagrees with
  // the server HTML. Remove this marker once the component is fixed: an
  // unexpected pass fails the suite on purpose.
  test.fail(true, "SnapshotReminderBanner dismissal does not survive reload (hydration mismatch)");

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
