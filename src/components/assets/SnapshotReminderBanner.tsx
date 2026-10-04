import { useEffect, useState } from "react";
import { daysSince, isSnapshotOverdue } from "@/lib/snapshot-reminder";

const DISMISS_STORAGE_KEY = "bitworth.snapshotReminder.dismissedLatestCreatedAt";

interface Props {
  latestSnapshotCreatedAt: string | null;
  /** The server's clock at render time, so SSR and hydration agree on the age. */
  nowMs: number;
  /** Existing save-snapshot target; this component does not duplicate the flow. */
  saveTargetId?: string;
}

export function snapshotReminderText(days: number): string {
  return `It's been ${days} ${days === 1 ? "day" : "days"} since your last snapshot. Stamp this month while the numbers are fresh.`;
}

export function SnapshotReminderBanner({ latestSnapshotCreatedAt, nowMs, saveTargetId = "snapshot-save" }: Props) {
  // `undefined` = storage not read yet. Server render and the first client render
  // both see `undefined` and render nothing, so hydration always matches; storage
  // is read only after mount, and a dismissed banner never paints.
  const [dismissedLatest, setDismissedLatest] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    } catch {
      stored = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync from an external store (localStorage) after mount; reading it during render is exactly the hydration mismatch this avoids
    setDismissedLatest(stored);
  }, []);

  if (!isSnapshotOverdue(latestSnapshotCreatedAt, nowMs)) return null;
  if (dismissedLatest === undefined) return null;
  if (latestSnapshotCreatedAt && dismissedLatest === latestSnapshotCreatedAt) return null;

  const elapsedDays = latestSnapshotCreatedAt ? daysSince(latestSnapshotCreatedAt, nowMs) : 0;

  function dismiss() {
    if (!latestSnapshotCreatedAt) return;
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, latestSnapshotCreatedAt);
    } catch {
      // Private-mode/storage-denied browsers still get an in-memory dismissal.
    }
    setDismissedLatest(latestSnapshotCreatedAt);
  }

  return (
    <div
      role="status"
      className="bg-secondary border-primary/60 mb-6 flex flex-col gap-3 rounded-md border-[1.5px] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground text-sm font-bold">{snapshotReminderText(elapsedDays)}</p>
        <p className="text-muted-foreground text-xs">
          Use the existing snapshot stamp — no duplicate flow, just the nudge.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <a
          href={`#${saveTargetId}`}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm px-4 py-2 text-center text-sm font-medium whitespace-nowrap transition-colors"
        >
          Save snapshot
        </a>
        <button
          type="button"
          onClick={dismiss}
          className="border-primary text-primary hover:bg-primary/8 rounded-sm border-[1.5px] px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
