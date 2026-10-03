/** Snapshot reminder policy: a nudge after more than 30 full UTC days. */
export const SNAPSHOT_REMINDER_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Whole UTC days elapsed since an ISO timestamp. The calculation is based on
 * epoch milliseconds, not local calendar dates, so DST boundaries do not add or
 * remove a day. Returns NaN when the timestamp cannot be parsed.
 */
export function daysSince(iso: string, now: Date | number): number {
  const thenMs = Date.parse(iso);
  if (Number.isNaN(thenMs)) return Number.NaN;
  const nowMs = typeof now === "number" ? now : now.getTime();
  return Math.floor((nowMs - thenMs) / MS_PER_DAY);
}

/**
 * Zero snapshots are not overdue. A snapshot becomes overdue only after more
 * than SNAPSHOT_REMINDER_DAYS full UTC days have elapsed.
 */
export function isSnapshotOverdue(latestCreatedAt: string | null, now: Date | number): boolean {
  if (!latestCreatedAt) return false;
  const elapsedDays = daysSince(latestCreatedAt, now);
  return Number.isFinite(elapsedDays) && elapsedDays > SNAPSHOT_REMINDER_DAYS;
}
