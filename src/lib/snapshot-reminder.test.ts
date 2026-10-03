import { describe, expect, it } from "vitest";
import { SNAPSHOT_REMINDER_DAYS, daysSince, isSnapshotOverdue } from "@/lib/snapshot-reminder";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-15T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

describe("snapshot reminder policy", () => {
  it("uses a fixed 30-day interval", () => {
    expect(SNAPSHOT_REMINDER_DAYS).toBe(30);
  });

  it.each<[string, string | null, boolean]>([
    ["null latest snapshot → not overdue", null, false],
    ["29 full days → not overdue", daysAgo(29), false],
    ["30 full days exactly → not overdue", daysAgo(30), false],
    ["31 full days → overdue", daysAgo(31), true],
  ])("%s", (_case, latestCreatedAt, expected) => {
    expect(isSnapshotOverdue(latestCreatedAt, NOW)).toBe(expected);
  });

  it("treats 30 days plus less than a full day as still not overdue", () => {
    const almost31Days = new Date(NOW - 31 * DAY + 1).toISOString();

    expect(daysSince(almost31Days, NOW)).toBe(30);
    expect(isSnapshotOverdue(almost31Days, NOW)).toBe(false);
  });

  it("uses elapsed UTC milliseconds, so a local 23:30 snapshot across DST does not gain a day", () => {
    // Europe/Warsaw advanced clocks on 2026-03-29. These explicit offsets
    // represent a 23:30 local snapshot before the change and a later local now;
    // elapsed UTC time is only 29 full days, not a local-calendar 30.
    const latestCreatedAt = "2026-03-28T23:30:00+01:00";
    const now = new Date("2026-04-27T23:00:00+02:00");

    expect(daysSince(latestCreatedAt, now)).toBe(29);
    expect(isSnapshotOverdue(latestCreatedAt, now)).toBe(false);
  });
});
