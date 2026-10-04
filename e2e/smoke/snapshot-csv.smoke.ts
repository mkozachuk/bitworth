import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { STALE_ASSET_NAME } from "./fixtures.ts";
import { signInAs } from "./session.ts";

test("Download CSV saves the snapshot history", async ({ page, context, baseURL }) => {
  await signInAs(context, "stale", baseURL ?? "");

  await page.goto("/dashboard/settings");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^bitworth-snapshots-\d{4}-\d{2}-\d{2}\.csv$/);

  const path = await download.path();
  const lines = (await readFile(path, "utf8"))
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .filter((line) => line.length > 0);
  expect(lines[0]).toContain("snapshot_date");
  const dataRows = lines.slice(1);
  expect(dataRows.length).toBeGreaterThanOrEqual(1);
  expect(dataRows.some((row) => row.includes(STALE_ASSET_NAME))).toBe(true);
});
