// Minimal GoTrue + PostgREST stand-in for the smoke suite. node: builtins only.
// It never talks to a real Supabase project: the app's SUPABASE_URL points
// here (see playwright.smoke.config.ts). Run: node --experimental-strip-types.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { STUB_PORT, publicTables, scenarioForUserId, tablesFor, userFor, type Scenario } from "./fixtures.ts";

type Row = Record<string, unknown>;

// Fixture timestamps are anchored to the stub's start, not to each request, so a
// row keeps the same created_at across reloads (the reminder's dismissal is
// keyed by it). Ages stay exact for any run shorter than the fixtures' 1h slack.
const ANCHOR_MS = Date.now();

const PARAM_KEYWORDS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/** The JWT `sub` of the bearer token, unverified: this is a fixture server. */
function scenarioOf(req: IncomingMessage): Scenario | null {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof claims.sub === "string" ? scenarioForUserId(claims.sub) : null;
  } catch {
    return null;
  }
}

function matches(row: Row, column: string, expr: string): boolean {
  // A filter on a column the fixture row does not carry is ignored.
  if (!(column in row)) return true;
  const actual = String(row[column]);
  if (expr.startsWith("eq.")) return actual === expr.slice(3);
  if (expr.startsWith("in.(") && expr.endsWith(")")) {
    const list = expr
      .slice(4, -1)
      .split(",")
      .map((v) => v.replace(/^"|"$/g, ""));
    return list.includes(actual);
  }
  return true;
}

function query(rows: Row[], params: URLSearchParams): Row[] {
  let result = rows;
  for (const [key, value] of params) {
    if (PARAM_KEYWORDS.has(key)) continue;
    result = result.filter((row) => matches(row, key, value));
  }
  const order = params.get("order")?.split(",")[0];
  if (order) {
    const [column, direction] = order.split(".");
    result = [...result].sort((a, b) => {
      const cmp = String(a[column]).localeCompare(String(b[column]));
      return direction === "desc" ? -cmp : cmp;
    });
  }
  return result;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const method = req.method ?? "GET";
  req.resume();

  if (url.pathname === "/health") {
    send(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/auth/v1/user") {
    const scenario = scenarioOf(req);
    if (!scenario) {
      send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      return;
    }
    send(res, 200, userFor(scenario));
    return;
  }

  if (url.pathname.startsWith("/auth/v1/")) {
    if (url.pathname === "/auth/v1/logout") {
      send(res, 204, undefined);
      return;
    }
    send(res, 400, { code: 400, error_code: "unsupported", msg: "not implemented by the smoke stub" });
    return;
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    if (method !== "GET" && method !== "HEAD") {
      // Writes (rate-cache upserts, ...) are accepted and dropped.
      send(res, method === "POST" ? 201 : 200, []);
      return;
    }
    const table = url.pathname.slice("/rest/v1/".length);
    const scenario = scenarioOf(req);
    const tables = scenario ? tablesFor(scenario, ANCHOR_MS) : publicTables(ANCHOR_MS);
    send(res, 200, query(tables[table] ?? [], url.searchParams));
    return;
  }

  send(res, 404, { message: `smoke stub: no route for ${method} ${url.pathname}` });
});

server.listen(STUB_PORT, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
