import type { Page } from "@playwright/test";

const TEST_PASSWORD = "TestPass123!";

export async function createTestUser(page: Page): Promise<{ email: string; password: string }> {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;

  await page.request.post("/api/auth/signup", {
    form: { email, password: TEST_PASSWORD },
  });

  await page.request.post("/api/auth/signin", {
    form: { email, password: TEST_PASSWORD },
  });

  return { email, password: TEST_PASSWORD };
}
