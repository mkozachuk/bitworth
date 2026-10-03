import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_CSV_COLUMNS,
  UTF8_BOM,
  buildSnapshotCsvRows,
  encodeCell,
  formatNumber,
  serializeSnapshotsCsv,
  snapshotCsvFilename,
  type CsvSnapshot,
  type CsvSnapshotItem,
  type SnapshotCsvInput,
} from "./snapshot-csv";

// Synthetic fixtures only. Ids are placeholders, names are invented.

const S1 = "snap-1";
const S2 = "snap-2";
const TAG_LONG = "tag-long";
const TAG_ETF = "tag-etf";

function snap(id: string, created_at: string, over: Partial<CsvSnapshot> = {}): CsvSnapshot {
  return {
    id,
    created_at,
    total_net_worth: 1500,
    display_currency: "USD",
    net_contribution: null,
    income: null,
    ...over,
  };
}

function item(snapshot_id: string, name: string, over: Partial<CsvSnapshotItem> = {}): CsvSnapshotItem {
  return {
    snapshot_id,
    name,
    category_id: "cash",
    original_amount: 100,
    original_currency: "USD",
    converted_amount: 100,
    display_currency: "USD",
    display_order: 0,
    tag_ids: null,
    ...over,
  };
}

function input(over: Partial<SnapshotCsvInput> = {}): SnapshotCsvInput {
  return {
    snapshots: [],
    items: [],
    categoryNames: { cash: "Cash", stocks: "Stocks" },
    tagNames: { [TAG_LONG]: "Long term", [TAG_ETF]: "etf" },
    ...over,
  };
}

/** Minimal RFC 4180 reader used only to round-trip the writer's output. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += ch;
  }
  return rows;
}

function body(csv: string): string {
  expect(csv.startsWith(UTF8_BOM)).toBe(true);
  return csv.slice(UTF8_BOM.length);
}

describe("snapshot CSV: cell encoding", () => {
  it.each([
    ["plain", "Checking", "Checking"],
    ["comma", "Cash, EUR", '"Cash, EUR"'],
    ["double quote", 'The "safe" box', '"The ""safe"" box"'],
    ["LF", "line1\nline2", '"line1\nline2"'],
    ["CRLF inside", "a\r\nb", '"a\r\nb"'],
    ["empty string", "", ""],
  ])("RFC 4180 quoting: %s", (_label, raw, expected) => {
    expect(encodeCell(raw)).toBe(expected);
  });

  it.each([
    ["=", "=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+", "+1 offshore", "'+1 offshore"],
    ["-", "-cmd", "'-cmd"],
    ["@", "@handle", "'@handle"],
    ["tab", "\tindent", "'\tindent"],
    ["CR", "\rx", '"\'\rx"'],
    ["= with a comma (guard, then quote)", "=1,2", '"\'=1,2"'],
  ])("formula-injection guard on text cells: %s", (_label, raw, expected) => {
    expect(encodeCell(raw)).toBe(expected);
  });

  it("does not guard trigger characters in the middle of text", () => {
    expect(encodeCell("Fund A-B = 50/50")).toBe("Fund A-B = 50/50");
  });

  it.each([
    [1500, "1500"],
    [-250.5, "-250.5"],
    [0, "0"],
    [1234567.89, "1234567.89"],
    [1e21, "1000000000000000000000"],
    [1.5e-7, "0.00000015"],
    [-2e-7, "-0.0000002"],
  ])("numbers are plain decimals: %s → %s", (n, expected) => {
    expect(formatNumber(n)).toBe(expected);
    expect(encodeCell(n)).toBe(expected);
  });

  it("a negative number is not formula-guarded", () => {
    expect(encodeCell(-500)).toBe("-500");
  });

  it("null and non-finite numbers are empty cells", () => {
    expect(encodeCell(null)).toBe("");
    expect(encodeCell(Number.NaN)).toBe("");
  });
});

describe("snapshot CSV: document shape", () => {
  it("empty history is the header row only, with a BOM and CRLF", () => {
    const csv = serializeSnapshotsCsv(input());
    expect(body(csv)).toBe(SNAPSHOT_CSV_COLUMNS.join(",") + "\r\n");
  });

  it("the header carries the thirteen columns in contract order", () => {
    expect(buildSnapshotCsvRows(input())[0]).toEqual([
      "snapshot_date",
      "snapshot_id",
      "total_net_worth",
      "snapshot_currency",
      "net_contribution",
      "income",
      "item_name",
      "category",
      "original_amount",
      "original_currency",
      "converted_amount",
      "display_currency",
      "tags",
    ]);
  });

  it("a snapshot with zero items yields exactly one row with empty item columns", () => {
    const rows = parseCsv(
      body(
        serializeSnapshotsCsv(input({ snapshots: [snap(S1, "2026-01-31T10:00:00+00:00", { net_contribution: 200 })] })),
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["2026-01-31T10:00:00.000Z", S1, "1500", "USD", "200", "", "", "", "", "", "", "", ""]);
  });

  it("long format: one row per item with snapshot columns repeated", () => {
    const rows = parseCsv(
      body(
        serializeSnapshotsCsv(
          input({
            snapshots: [snap(S1, "2026-01-31T10:00:00Z", { income: 3000, net_contribution: -500 })],
            items: [
              item(S1, "Checking", { display_order: 0 }),
              item(S1, "Index fund", {
                display_order: 1,
                category_id: "stocks",
                original_amount: 1200,
                original_currency: "EUR",
                converted_amount: 1400.25,
              }),
            ],
          }),
        ),
      ),
    );
    expect(rows.slice(1)).toEqual([
      [
        "2026-01-31T10:00:00.000Z",
        S1,
        "1500",
        "USD",
        "-500",
        "3000",
        "Checking",
        "Cash",
        "100",
        "USD",
        "100",
        "USD",
        "",
      ],
      [
        "2026-01-31T10:00:00.000Z",
        S1,
        "1500",
        "USD",
        "-500",
        "3000",
        "Index fund",
        "Stocks",
        "1200",
        "EUR",
        "1400.25",
        "USD",
        "",
      ],
    ]);
  });

  it("orders by snapshot date, then by item display order, regardless of input order", () => {
    const rows = buildSnapshotCsvRows(
      input({
        snapshots: [snap(S2, "2026-02-28T10:00:00Z"), snap(S1, "2026-01-31T10:00:00Z")],
        items: [
          item(S2, "B", { display_order: 1 }),
          item(S1, "Z", { display_order: 2 }),
          item(S2, "A", { display_order: 0 }),
          item(S1, "Y", { display_order: 1 }),
        ],
      }),
    );
    expect(rows.slice(1).map((r) => `${String(r[1])}:${String(r[6])}`)).toEqual([
      "snap-1:Y",
      "snap-1:Z",
      "snap-2:A",
      "snap-2:B",
    ]);
  });

  it("normalises snapshot_date to ISO UTC", () => {
    const rows = buildSnapshotCsvRows(input({ snapshots: [snap(S1, "2026-03-29T03:30:00+02:00")] }));
    expect(rows[1][0]).toBe("2026-03-29T01:30:00.000Z");
  });

  it("an unknown category id falls back to the id", () => {
    const rows = buildSnapshotCsvRows(
      input({ snapshots: [snap(S1, "2026-01-31T10:00:00Z")], items: [item(S1, "Mystery", { category_id: "other" })] }),
    );
    expect(rows[1][7]).toBe("other");
  });
});

describe("snapshot CSV: tags", () => {
  it.each<[string, string[] | null, string]>([
    ["NULL (not recorded) is empty", null, ""],
    ["an empty set is empty", [], ""],
    ["one tag", [TAG_LONG], "Long term"],
    ["two tags are ;-joined, sorted by name ignoring case", [TAG_LONG, TAG_ETF], "etf;Long term"],
    ["a tag deleted since the snapshot is dropped", ["tag-gone", TAG_ETF], "etf"],
  ])("%s", (_label, tagIds, expected) => {
    const rows = buildSnapshotCsvRows(
      input({ snapshots: [snap(S1, "2026-01-31T10:00:00Z")], items: [item(S1, "Checking", { tag_ids: tagIds })] }),
    );
    expect(rows[1][12]).toBe(expected);
  });
});

describe("snapshot CSV: hostile and non-ASCII names", () => {
  it("guards and quotes item names inside a full document", () => {
    const csv = serializeSnapshotsCsv(
      input({
        snapshots: [snap(S1, "2026-01-31T10:00:00Z")],
        items: [item(S1, '=HYPERLINK("http://x","y")'), item(S1, 'Safe, "boxed"\nnote', { display_order: 1 })],
      }),
    );
    const lines = body(csv).split("\r\n");
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    const rows = parseCsv(body(csv));
    expect(rows[1][6]).toBe(`'=HYPERLINK("http://x","y")`);
    expect(rows[2][6]).toBe('Safe, "boxed"\nnote');
  });

  it("round-trips Cyrillic and Polish names through UTF-8 bytes with a BOM", () => {
    const names = ["Сбережения «Подушка»", "Konto oszczędnościowe – złoty"];
    const csv = serializeSnapshotsCsv(
      input({
        snapshots: [snap(S1, "2026-01-31T10:00:00Z", { display_currency: "PLN" })],
        items: names.map((n, i) =>
          item(S1, n, { display_order: i, original_currency: "PLN", display_currency: "PLN" }),
        ),
      }),
    );
    const bytes = new TextEncoder().encode(csv);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const decoded = new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes);
    expect(
      parseCsv(decoded)
        .slice(1)
        .map((r) => r[6]),
    ).toEqual(names);
  });
});

describe("snapshot CSV: filename", () => {
  it("is bitworth-snapshots-YYYY-MM-DD.csv in UTC", () => {
    expect(snapshotCsvFilename(new Date("2026-10-03T23:30:00-02:00"))).toBe("bitworth-snapshots-2026-10-04.csv");
  });
});
