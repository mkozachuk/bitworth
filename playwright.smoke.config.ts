import { defineConfig, devices } from "@playwright/test";
import { STUB_ANON_KEY, STUB_URL } from "./e2e/smoke/fixtures.ts";

// Smoke suite: real build + preview, but Supabase is a local fixture stub
// (e2e/smoke/supabase-stub.ts). Needs no secrets and no network backend; the
// calling shell's SUPABASE_URL / SUPABASE_KEY are deliberately overridden.
const APP_PORT = 4329;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

export default defineConfig({
  testDir: "./e2e/smoke",
  testMatch: "**/*.smoke.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    extraHTTPHeaders: { Origin: APP_URL },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node --experimental-strip-types --no-warnings e2e/smoke/supabase-stub.ts",
      url: `${STUB_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${APP_PORT}`,
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        // The preview worker (workerd) sees process env only when asked to.
        CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
        SUPABASE_URL: STUB_URL,
        SUPABASE_KEY: STUB_ANON_KEY,
      },
    },
  ],
});
