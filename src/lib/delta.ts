import type { Database } from "@/lib/database.types";

type SnapshotRow = Database["public"]["Tables"]["snapshots"]["Row"];

export interface DeltaResult {
  absolute: number;
  percentage: number;
  fromSnapshot: SnapshotRow;
  toSnapshot: SnapshotRow;
}

export function computeDelta(fromSnapshot: SnapshotRow, toSnapshot: SnapshotRow): DeltaResult {
  const absolute = toSnapshot.total_net_worth - fromSnapshot.total_net_worth;
  const percentage = fromSnapshot.total_net_worth !== 0 ? (absolute / Math.abs(fromSnapshot.total_net_worth)) * 100 : 0;

  return { absolute, percentage, fromSnapshot, toSnapshot };
}

export function getLastMonthSnapshot(snapshots: SnapshotRow[]): SnapshotRow | null {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const candidates = snapshots.filter((s) => {
    const date = new Date(s.snapshot_date);
    return date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth();
  });

  if (candidates.length === 0) return null;
  return (
    candidates.sort((a, b) => new Date(b.snapshot_date).getTime() - new Date(a.snapshot_date).getTime()).at(0) ?? null
  );
}

export function getJan1Snapshot(snapshots: SnapshotRow[]): SnapshotRow | null {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);

  const candidates = snapshots.filter((s) => {
    const date = new Date(s.snapshot_date);
    return date.getFullYear() === jan1.getFullYear() && date.getMonth() === 0 && date.getDate() === 1;
  });

  if (candidates.length === 0) return null;
  return (
    candidates.sort((a, b) => new Date(b.snapshot_date).getTime() - new Date(a.snapshot_date).getTime()).at(0) ?? null
  );
}

export function getYearStartSnapshot(snapshots: SnapshotRow[]): SnapshotRow | null {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const candidates = snapshots.filter((s) => new Date(s.snapshot_date).getFullYear() === yearStart.getFullYear());

  if (candidates.length === 0) return null;
  return (
    candidates.sort((a, b) => new Date(b.snapshot_date).getTime() - new Date(a.snapshot_date).getTime()).at(0) ?? null
  );
}
