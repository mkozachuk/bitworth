/**
 * Snapshot history as a spreadsheet-friendly CSV (long format: one row per
 * snapshot item, snapshot-level columns repeated). Pure: the endpoint fetches,
 * this module only shapes and encodes.
 *
 * Encoding rules:
 * - RFC 4180: fields containing `,`, `"`, CR or LF are wrapped in quotes and
 *   inner quotes are doubled; records end with CRLF.
 * - Numbers are plain decimals with `.`, never exponent notation, no grouping,
 *   no currency symbols.
 * - Formula-injection guard: a text cell starting with `=`, `+`, `-`, `@`, tab
 *   or CR is prefixed with `'` so spreadsheets treat it as text. Number cells
 *   are not guarded (a negative contribution stays a number).
 * - The document starts with a UTF-8 BOM so Excel opens non-ASCII names
 *   (Cyrillic, Polish) correctly.
 */

export const SNAPSHOT_CSV_COLUMNS = [
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
] as const;

export const UTF8_BOM = "\uFEFF";

export interface CsvSnapshot {
  id: string;
  created_at: string;
  total_net_worth: number;
  display_currency: string;
  net_contribution: number | null;
  income: number | null;
}

export interface CsvSnapshotItem {
  snapshot_id: string;
  name: string;
  category_id: string;
  original_amount: number;
  original_currency: string;
  converted_amount: number;
  display_currency: string;
  display_order: number;
  tag_ids: string[] | null;
}

export interface SnapshotCsvInput {
  snapshots: CsvSnapshot[];
  items: CsvSnapshotItem[];
  /** category id → display name; an unknown id falls back to the id itself. */
  categoryNames: Record<string, string>;
  /** tag id → name; ids of tags deleted since the snapshot are dropped. */
  tagNames: Record<string, string>;
}

/** A cell is either text (guarded, quoted as needed) or a number (plain decimal). */
export type CsvCell = string | number | null;

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function guardFormula(text: string): string {
  return text.length > 0 && FORMULA_TRIGGERS.has(text[0]) ? `'${text}` : text;
}

export function quoteField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Plain decimal rendering: `1e21` → `1000000000000000000000`, `1e-7` → `0.0000001`. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = String(n);
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!match) return s;
  const [, sign, lead, frac = "", expRaw] = match;
  const exp = Number(expRaw);
  const digits = lead + frac;
  if (exp >= 0) {
    const intLen = 1 + exp;
    return (
      sign +
      (digits.length <= intLen ? digits.padEnd(intLen, "0") : `${digits.slice(0, intLen)}.${digits.slice(intLen)}`)
    );
  }
  return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
}

export function encodeCell(cell: CsvCell): string {
  if (cell === null) return "";
  if (typeof cell === "number") return formatNumber(cell);
  return quoteField(guardFormula(cell));
}

export function encodeCsv(rows: readonly (readonly CsvCell[])[]): string {
  return UTF8_BOM + rows.map((row) => row.map(encodeCell).join(",") + "\r\n").join("");
}

function isoUtc(timestamp: string): string {
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? timestamp : new Date(ms).toISOString();
}

function tagCell(tagIds: string[] | null, tagNames: Record<string, string>): string {
  if (!tagIds) return "";
  const names = tagIds.flatMap((id) => (id in tagNames ? [tagNames[id]] : []));
  return names.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })).join(";");
}

/** Header plus one row per item (or one bare row for an item-less snapshot). */
export function buildSnapshotCsvRows(input: SnapshotCsvInput): CsvCell[][] {
  const itemsBySnapshot = new Map<string, CsvSnapshotItem[]>();
  for (const item of input.items) {
    const list = itemsBySnapshot.get(item.snapshot_id) ?? [];
    list.push(item);
    itemsBySnapshot.set(item.snapshot_id, list);
  }

  const snapshots = [...input.snapshots].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id),
  );

  const rows: CsvCell[][] = [[...SNAPSHOT_CSV_COLUMNS]];
  for (const snap of snapshots) {
    const head: CsvCell[] = [
      isoUtc(snap.created_at),
      snap.id,
      snap.total_net_worth,
      snap.display_currency,
      snap.net_contribution,
      snap.income,
    ];
    const items = (itemsBySnapshot.get(snap.id) ?? []).sort(
      (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
    );
    if (items.length === 0) {
      rows.push([...head, null, null, null, null, null, null, null]);
      continue;
    }
    for (const item of items) {
      rows.push([
        ...head,
        item.name,
        input.categoryNames[item.category_id] ?? item.category_id,
        item.original_amount,
        item.original_currency,
        item.converted_amount,
        item.display_currency,
        tagCell(item.tag_ids, input.tagNames),
      ]);
    }
  }
  return rows;
}

export function serializeSnapshotsCsv(input: SnapshotCsvInput): string {
  return encodeCsv(buildSnapshotCsvRows(input));
}

/** `bitworth-snapshots-YYYY-MM-DD.csv`, dated in UTC. */
export function snapshotCsvFilename(now: Date): string {
  return `bitworth-snapshots-${now.toISOString().slice(0, 10)}.csv`;
}
