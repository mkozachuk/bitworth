import { describe, expect, it } from "vitest";
import { STALE_PRICE_MAX_AGE_DAYS, ageInDays, stalePricedAssets, type StaleCandidate } from "@/lib/stale-prices";

// P1: which holdings count as stale-priced. `now` is passed in, so the table
// does not depend on the wall clock. Fixtures are synthetic.

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const DAY = 86_400_000;

function at(msBeforeNow: number): string {
  return new Date(NOW - msBeforeNow).toISOString();
}

type Row = StaleCandidate & { id: string };

function row(id: string, over: Partial<Row>): Row {
  return { id, quantity: null, crypto_symbol: null, metal_symbol: null, updated_at: at(0), ...over };
}

const btcOld = row("btc-old", { quantity: 0.5, crypto_symbol: "BTC", updated_at: at(62 * DAY) });
const xauOld = row("xau-old", { quantity: 2, metal_symbol: "XAU", updated_at: at(10 * DAY) });
const ethFresh = row("eth-fresh", { quantity: 3, crypto_symbol: "ETH", updated_at: at(2 * DAY) });
const cashOld = row("cash-old", { updated_at: at(400 * DAY) });

describe("stalePricedAssets (P1)", () => {
  it("uses a 7-day limit by default", () => {
    expect(STALE_PRICE_MAX_AGE_DAYS).toBe(7);
  });

  it.each<[string, Row, boolean]>([
    ["priced crypto, 62 days old → in", btcOld, true],
    ["priced metal, 10 days old → in", xauOld, true],
    ["priced, 2 days old → out", ethFresh, false],
    ["priced, written just now → out", row("now", { quantity: 1, crypto_symbol: "BTC" }), false],
    ["unpriced, 400 days old → out", cashOld, false],
    [
      "symbol but quantity 0, old → out",
      row("q0", { quantity: 0, crypto_symbol: "BTC", updated_at: at(62 * DAY) }),
      false,
    ],
    ["symbol but quantity null, old → out", row("qn", { crypto_symbol: "BTC", updated_at: at(62 * DAY) }), false],
    [
      "negative quantity, old → out",
      row("qneg", { quantity: -1, metal_symbol: "XAU", updated_at: at(62 * DAY) }),
      false,
    ],
    [
      "quantity but blank symbol, old → out",
      row("blank", { quantity: 1, crypto_symbol: "  ", updated_at: at(62 * DAY) }),
      false,
    ],
    [
      "exactly 7 days old → out (boundary is fresh)",
      row("b7", { quantity: 1, crypto_symbol: "BTC", updated_at: at(7 * DAY) }),
      false,
    ],
    ["7 days and 1 ms old → in", row("b7+", { quantity: 1, crypto_symbol: "BTC", updated_at: at(7 * DAY + 1) }), true],
    [
      "7 days minus 1 ms old → out",
      row("b7-", { quantity: 1, crypto_symbol: "BTC", updated_at: at(7 * DAY - 1) }),
      false,
    ],
    [
      "unparseable updated_at → out",
      row("bad", { quantity: 1, crypto_symbol: "BTC", updated_at: "not a date" }),
      false,
    ],
  ])("%s", (_case, asset, expected) => {
    expect(stalePricedAssets([asset], NOW).map((a) => a.id)).toEqual(expected ? [asset.id] : []);
  });

  it("returns only the stale priced rows from a mixed list, oldest first", () => {
    const result = stalePricedAssets([ethFresh, xauOld, cashOld, btcOld], NOW);
    expect(result.map((a) => a.id)).toEqual(["btc-old", "xau-old"]);
    expect(result[0]).toBe(btcOld);
  });

  it("returns an empty list when nothing is stale", () => {
    expect(stalePricedAssets([ethFresh, cashOld], NOW)).toEqual([]);
    expect(stalePricedAssets([], NOW)).toEqual([]);
  });

  it("accepts a Date for now and honours a custom limit", () => {
    expect(stalePricedAssets([xauOld], new Date(NOW)).map((a) => a.id)).toEqual(["xau-old"]);
    expect(stalePricedAssets([xauOld], NOW, 30)).toEqual([]);
    expect(stalePricedAssets([ethFresh], NOW, 1).map((a) => a.id)).toEqual(["eth-fresh"]);
  });
});

describe("ageInDays", () => {
  it("floors elapsed time to whole days", () => {
    expect(ageInDays(at(62 * DAY), NOW)).toBe(62);
    expect(ageInDays(at(7 * DAY + 1), NOW)).toBe(7);
    expect(ageInDays(at(DAY - 1), new Date(NOW))).toBe(0);
  });
});
