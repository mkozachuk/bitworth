import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Walks src/pages/api/ and asserts every .ts file has either an
// explicit auth check (`supabase.auth.getUser()`) or a public-route
// justification comment matching PUBLIC_COMMENT. Files under `auth/`
// are exempt from the auth-or-comment rule but must still call
// `createClient` to reach Supabase. The positive assertion catches a
// future signin/signup that ships with no client at all.
//
// Anchored in lessons.md §2 (public API endpoints need explicit auth
// decisions) and test-plan §2 Risk #5.

const API_ROOT = join(process.cwd(), "src/pages/api");
const AUTH_CHECK = "supabase.auth.getUser()";
// The leading `[\s\S]*?` (non-greedy) lets the justification phrase
// appear anywhere in the comment, not immediately after `//`. The
// existing rates.ts comment is `// Rates are intentionally
// unauthenticated — ...`, so a strict `\s*` would miss it. The
// phrase set itself is unchanged from research §Risk #5 Option A.
const PUBLIC_COMMENT = /\/\*?[\s\S]*?(intentionally (unauthenticated|public)|public route|explicit design decision)/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    // Skip test files — this contract is for the routes themselves, not
    // for the audit code (which would otherwise self-match because it
    // holds the AUTH_CHECK literal in a constant).
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("API route auth contract", () => {
  const files = walk(API_ROOT);

  it("walks at least one .ts file under src/pages/api (sanity check — empty dir is a test bug, not a pass)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const full of files) {
    const rel = relative(API_ROOT, full);
    const isAuth = rel.split(sep).includes("auth");

    it(`${rel} has an auth check or an explicit public-route comment`, () => {
      const src = readFileSync(full, "utf8");
      const hasAuth = src.includes(AUTH_CHECK);
      const hasComment = PUBLIC_COMMENT.test(src);
      if (isAuth) {
        // auth/ endpoints are exempt from the auth-or-comment rule; they
        // MUST call createClient to reach Supabase. A signin that ships
        // without a client is a silent no-op and still gets flagged here.
        expect(src).toContain("createClient");
        return;
      }
      expect(
        hasAuth || hasComment,
        `File \`${rel}\` has neither auth check (\`${AUTH_CHECK}\`) nor explicit public-route comment. ` +
          `Either add \`supabase.auth.getUser()\` + 401 handling, or add a comment explaining why this route is public.`,
      ).toBe(true);
    });
  }
});
