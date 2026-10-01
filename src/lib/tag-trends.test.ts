import { describe, expect, it } from "vitest";
import type { TagTrendItem } from "@/lib/tag-trends";
import { buildTagTrends } from "@/lib/tag-trends";

// Pins the B1b series rules (spec T8) from first principles. Rates are
// USD-denominated divisors, as in asset-trends.test.ts: EUR = 2 means
// 200 EUR → 100 USD; PLN = 4 means 400 PLN → 100 USD.
const RATES: Record<"PLN" | "USD" | "EUR", number> = { USD: 1, EUR: 2.0, PLN: 4.0 };

const D1 = "2026-01-01T00:00:00Z";
const D2 = "2026-02-01T00:00:00Z";
const D3 = "2026-03-01T00:00:00Z";

function item(over: Partial<TagTrendItem>): TagTrendItem {
  return {
    snapshotId: "s1",
    snapshotDate: D1,
    original_amount: 0,
    original_currency: "USD",
    is_liability: false,
    tag_ids: [],
    ...over,
  };
}

function line(series: ReturnType<typeof buildTagTrends>, tagId: string) {
  const s = series.find((x) => x.tagId === tagId);
  if (!s) throw new Error(`no series for ${tagId}`);
  return s.points;
}

describe("buildTagTrends", () => {
  it.each([
    {
      label: "NULL history: snapshots whose items are all NULL give no point (the line breaks)",
      items: [
        item({ snapshotId: "s1", snapshotDate: D1, original_amount: 100, tag_ids: null }),
        item({ snapshotId: "s1", snapshotDate: D1, original_amount: 50, tag_ids: null }),
        item({ snapshotId: "s2", snapshotDate: D2, original_amount: 300, tag_ids: ["a"] }),
        item({ snapshotId: "s3", snapshotDate: D3, original_amount: 400, tag_ids: ["a"] }),
      ],
      tags: ["a"],
      expected: {
        a: [
          [D2, 300],
          [D3, 400],
        ],
      },
    },
    {
      label: "a two-tag asset counts in both lines",
      items: [item({ original_amount: 100, tag_ids: ["a", "b"] }), item({ original_amount: 10, tag_ids: ["b"] })],
      tags: ["a", "b"],
      expected: { a: [[D1, 100]], b: [[D1, 110]] },
    },
    {
      label: "a liability counts negative in its tag's sum",
      items: [
        item({ original_amount: 1000, tag_ids: ["home"] }),
        item({ original_amount: 600, is_liability: true, tag_ids: ["home"] }),
      ],
      tags: ["home"],
      expected: { home: [[D1, 400]] },
    },
    {
      label: "a tag deleted after the fact is never built; its id on items changes nothing else",
      items: [item({ original_amount: 100, tag_ids: ["gone", "a"] }), item({ original_amount: 7, tag_ids: ["gone"] })],
      tags: ["a"],
      expected: { a: [[D1, 100]] },
    },
    {
      label: "a currency switch: values are recomputed from the original amount at today's rates",
      items: [
        // Saved while the display currency was USD, then PLN: the converted
        // amounts on the rows would differ, the original ones do not.
        item({ snapshotId: "s1", snapshotDate: D1, original_amount: 200, original_currency: "EUR", tag_ids: ["a"] }),
        item({ snapshotId: "s2", snapshotDate: D2, original_amount: 200, original_currency: "EUR", tag_ids: ["a"] }),
      ],
      tags: ["a"],
      displayCurrency: "PLN" as const,
      expected: {
        a: [
          [D1, 400],
          [D2, 400],
        ],
      },
    },
    {
      label: "unsorted input comes out in date order",
      items: [
        item({ snapshotId: "s3", snapshotDate: D3, original_amount: 3, tag_ids: ["a"] }),
        item({ snapshotId: "s1", snapshotDate: D1, original_amount: 1, tag_ids: ["a"] }),
        item({ snapshotId: "s2", snapshotDate: D2, original_amount: 2, tag_ids: ["a"] }),
        item({ snapshotId: "s1", snapshotDate: D1, original_amount: 10, tag_ids: ["a"] }),
      ],
      tags: ["a"],
      expected: {
        a: [
          [D1, 11],
          [D2, 2],
          [D3, 3],
        ],
      },
    },
    {
      label: "a recorded snapshot where no item carries the tag gives a 0 point (an empty sum)",
      items: [
        item({ snapshotId: "s1", snapshotDate: D1, original_amount: 5, tag_ids: [] }),
        item({ snapshotId: "s2", snapshotDate: D2, original_amount: 5, tag_ids: ["a"] }),
      ],
      tags: ["a"],
      expected: {
        a: [
          [D1, 0],
          [D2, 5],
        ],
      },
    },
    {
      label: "a snapshot mixing NULL and recorded items is recorded; its NULL items carry no tag",
      items: [
        item({ snapshotId: "s1", original_amount: 5, tag_ids: null }),
        item({ snapshotId: "s1", original_amount: 7, tag_ids: ["a"] }),
      ],
      tags: ["a"],
      expected: { a: [[D1, 7]] },
    },
  ])("$label", ({ items, tags, expected, displayCurrency }) => {
    const series = buildTagTrends(items, tags, displayCurrency ?? "USD", RATES);
    expect(series.map((s) => s.tagId)).toEqual(tags);
    for (const [tagId, points] of Object.entries(expected)) {
      expect(line(series, tagId).map((p) => [p.date, p.value])).toEqual(points);
    }
  });

  it("NULL is never read as []: an all-NULL history gives every line zero points, not zeros", () => {
    const items = [
      item({ snapshotId: "s1", snapshotDate: D1, original_amount: 100, tag_ids: null }),
      item({ snapshotId: "s2", snapshotDate: D2, original_amount: 100, tag_ids: null }),
    ];
    const series = buildTagTrends(items, ["a", "b"], "USD", RATES);
    expect(series.map((s) => s.points)).toEqual([[], []]);
  });

  it("lines are independent: the per-snapshot sum of lines may exceed net worth (never stacked)", () => {
    const series = buildTagTrends([item({ original_amount: 100, tag_ids: ["a", "b"] })], ["a", "b"], "USD", RATES);
    const total = series.reduce((sum, s) => sum + s.points[0].value, 0);
    expect(total).toBe(200);
  });

  it("indexed rebases to 100 at the first non-zero point; earlier zeros index to 0", () => {
    const items = [
      item({ snapshotId: "s1", snapshotDate: D1, original_amount: 5, tag_ids: [] }),
      item({ snapshotId: "s2", snapshotDate: D2, original_amount: 200, tag_ids: ["a"] }),
      item({ snapshotId: "s3", snapshotDate: D3, original_amount: 300, tag_ids: ["a"] }),
    ];
    expect(line(buildTagTrends(items, ["a"], "USD", RATES), "a").map((p) => p.indexed)).toEqual([0, 100, 150]);
  });

  it("indexed uses |baseline|, so a shrinking liability-only tag trends upward", () => {
    const items = [
      item({ snapshotId: "s1", snapshotDate: D1, original_amount: 1000, is_liability: true, tag_ids: ["debt"] }),
      item({ snapshotId: "s2", snapshotDate: D2, original_amount: 500, is_liability: true, tag_ids: ["debt"] }),
    ];
    expect(line(buildTagTrends(items, ["debt"], "USD", RATES), "debt").map((p) => p.indexed)).toEqual([-100, -50]);
  });

  it("indexed is null throughout when a line never leaves zero", () => {
    const items = [
      item({ snapshotId: "s1", snapshotDate: D1, tag_ids: [] }),
      item({ snapshotId: "s2", snapshotDate: D2, tag_ids: [] }),
    ];
    expect(line(buildTagTrends(items, ["a"], "USD", RATES), "a").map((p) => p.indexed)).toEqual([null, null]);
  });

  it("no items: every requested tag gets an empty line", () => {
    expect(buildTagTrends([], ["a"], "USD", RATES)).toEqual([{ tagId: "a", points: [] }]);
  });
});
