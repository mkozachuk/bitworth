/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "../snapshots/index";

const dbRef = { current: null as unknown };

vi.mock("@/lib/db", () => ({
  createDbClient: vi.fn(() => dbRef.current),
}));

vi.mock("@/lib/snapshot", () => ({
  saveSnapshot: vi.fn(),
}));

function makeContext() {
  return {
    request: new Request("http://localhost", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }),
    cookies: { get: (_n: string) => ({}), set: vi.fn(), delete: vi.fn(), getAll: () => [] } as unknown,
    params: {},
  };
}

function buildMockClient(overrides: {
  user: { id: string } | null;
  snapshotsData?: unknown[];
  snapshotsError?: { message: string };
  profileData?: unknown;
  profileError?: { message: string };
}) {
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: overrides.user } }) };

  const single = () => ({
    data: overrides.profileData ?? { display_currency: "PLN" },
    error: overrides.profileError ?? null,
  });
  const listData = overrides.snapshotsData ?? [];
  const listError = overrides.snapshotsError ?? null;

  const from = (table: string) => {
    if (table === "snapshots") {
      return {
        select: () => ({
          eq: () => ({ order: () => ({ data: listData, error: listError }) }),
        }),
      };
    }
    if (table === "profiles") {
      return { select: () => ({ eq: () => ({ single }) }) };
    }
    return { select: () => ({}) };
  };

  return { auth, from };
}

describe("GET /api/snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = null;
  });

  it("returns 401 when unauthenticated", async () => {
    dbRef.current = buildMockClient({ user: null });
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with snapshots array when authenticated", async () => {
    const snaps = [
      { id: "snap-1", total_net_worth: 50000, currency: "PLN", snapshot_date: "2024-01-15", user_id: "user-1" },
      { id: "snap-2", total_net_worth: 52000, currency: "PLN", snapshot_date: "2024-02-15", user_id: "user-1" },
    ];
    dbRef.current = buildMockClient({ user: { id: "user-1" }, snapshotsData: snaps });
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].total_net_worth).toBe(50000);
  });

  it("returns 500 with FETCH_ERROR when DB fails", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, snapshotsError: { message: "DB error" } });
    const res = await GET(makeContext());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("FETCH_ERROR");
  });
});

describe("POST /api/snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRef.current = null;
  });

  it("returns 401 when unauthenticated", async () => {
    dbRef.current = buildMockClient({ user: null });
    const res = await POST(makeContext());
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 201 with snapshot on success", async () => {
    const snapshotResult = {
      id: "snap-new",
      total_net_worth: 51000,
      currency: "PLN" as const,
      snapshot_date: "2024-01-29",
    };
    dbRef.current = buildMockClient({ user: { id: "user-1" }, profileData: { display_currency: "PLN" } });
    const { saveSnapshot } = await import("@/lib/snapshot");
    vi.mocked(saveSnapshot).mockResolvedValue(snapshotResult);
    const res = await POST(makeContext());
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.id).toBe("snap-new");
    expect(body.data.total_net_worth).toBe(51000);
  });

  it("returns 500 with SNAPSHOT_ERROR when saveSnapshot throws", async () => {
    dbRef.current = buildMockClient({ user: { id: "user-1" }, profileData: { display_currency: "PLN" } });
    const { saveSnapshot } = await import("@/lib/snapshot");
    vi.mocked(saveSnapshot).mockRejectedValue(new Error("Assets fetch failed"));
    const res = await POST(makeContext());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("SNAPSHOT_ERROR");
    expect(body.error.message).toBe("Assets fetch failed");
  });
});
