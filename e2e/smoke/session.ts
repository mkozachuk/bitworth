import { expect, type BrowserContext, type Locator } from "@playwright/test";
import { SCENARIOS, STUB_URL, userFor, type Scenario } from "./fixtures.ts";

const YEAR_S = 365 * 24 * 3600;

function base64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/**
 * Signs the browser in as a scenario's fake user by writing the cookie
 * @supabase/ssr reads: `sb-<first label of the SUPABASE_URL host>-auth-token`,
 * value `base64-` + base64url(session JSON). The stub decodes the unsigned
 * JWT's `sub` to pick fixtures; nothing here is a real credential.
 */
export async function signInAs(context: BrowserContext, scenario: Scenario, baseURL: string): Promise<void> {
  const nowS = Math.floor(Date.now() / 1000);
  const claims = { sub: SCENARIOS[scenario], role: "authenticated", aud: "authenticated", exp: nowS + YEAR_S };
  const accessToken = [base64url('{"alg":"HS256","typ":"JWT"}'), base64url(JSON.stringify(claims)), "smoke"].join(".");
  const session = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: YEAR_S,
    expires_at: nowS + YEAR_S,
    refresh_token: "smoke-refresh",
    user: userFor(scenario),
  };
  const host = new URL(STUB_URL).hostname.split(".")[0];
  await context.addCookies([
    {
      name: `sb-${host}-auth-token`,
      value: `base64-${base64url(JSON.stringify(session))}`,
      url: baseURL,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Waits until the Astro island around `locator` has hydrated. `client:load`
 * islands are server-rendered, so their buttons are visible before React
 * attaches handlers, and a click in that window is silently lost. Astro drops
 * the island's `ssr` attribute once hydration completes.
 */
export async function waitForHydration(locator: Locator): Promise<void> {
  const island = locator.locator("xpath=ancestor::astro-island[1]");
  await expect(island).toHaveCount(1);
  await expect(island).not.toHaveAttribute("ssr");
}
