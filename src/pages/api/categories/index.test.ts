import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, createCookiesStub } from "@/test-utils/supabase-mock";

// /api/categories reads the global `asset_categories` table — no user_id
// column exists. The cross-tenant risk for this handler is "did the
// handler authenticate at all?" The contract test (Phase 1) catches the
// static pattern; this test catches the runtime case.

const mocks = vi.hoisted(() => {
  return { factory: () => null as unknown as ReturnType<typeof createSupabaseMock> };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => mocks.factory().client,
}));

import { GET } from "@/pages/api/categories/index";

describe("GET /api/categories", () => {
  it("returns 401 when no Cookie is present", async () => {
    const m = createSupabaseMock({ userId: null });
    mocks.factory = () => m;

    const request = new Request("http://localhost/api/categories");
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(401);
  });

  it("returns the categories on authenticated request", async () => {
    const cats = [
      { id: "cash", name: "Cash", is_liability: false, display_order: 1 },
      { id: "loan", name: "Loan", is_liability: true, display_order: 99 },
    ];
    const m = createSupabaseMock({
      userId: "user-A",
      tableResults: { asset_categories: { data: cats, error: null } },
    });
    mocks.factory = () => m;

    const request = new Request("http://localhost/api/categories", {
      headers: { Cookie: "sb-access-token=fake" },
    });
    const response = await GET({ request, cookies: createCookiesStub() } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual(cats);
  });
});
