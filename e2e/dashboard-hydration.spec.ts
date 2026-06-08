import { test, expect } from "@playwright/test";
import { createTestUser } from "./helpers/auth";

test("dashboard shows correct net worth total after hydration", async ({ page }) => {
  await createTestUser(page);

  const categoryRes = await page.request.get("/api/categories");
  const { data: categories } = (await categoryRes.json()) as {
    data: { id: string; is_liability: boolean }[];
  };
  const assetCategory = categories.find((c) => !c.is_liability)!;

  const amounts = [1500, 2500, 1000];
  const assetIds: string[] = [];

  for (const amount of amounts) {
    const form = new URLSearchParams();
    form.set("name", `E2E Asset ${amount}`);
    form.set("amount", String(amount));
    form.set("currency", "USD");
    form.set("category_id", assetCategory.id);

    const res = await page.request.post("/api/assets", {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: form.toString(),
    });
    const { data } = (await res.json()) as { data: { id: string } };
    assetIds.push(data.id);
  }

  await page.goto("/dashboard");

  const expectedTotal = amounts.reduce((sum, a) => sum + a, 0);
  const formatted = expectedTotal.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  await expect(page.getByText(`${formatted} USD`).first()).toBeVisible();

  for (const id of assetIds) {
    await page.request.delete(`/api/assets/${id}`);
  }
});
