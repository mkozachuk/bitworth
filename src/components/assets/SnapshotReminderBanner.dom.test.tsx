// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SnapshotReminderBanner, snapshotReminderText } from "./SnapshotReminderBanner";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const LATEST = new Date(NOW - 31 * DAY).toISOString();
const OLDER = new Date(NOW - 60 * DAY).toISOString();
const KEY = "bitworth.snapshotReminder.dismissedLatestCreatedAt";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SnapshotReminderBanner", () => {
  it("shows the overdue reminder with the right day count", () => {
    render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);

    expect(screen.getByRole("status").textContent).toContain("It's been 31 days since your last snapshot");
    expect(screen.getByRole("link", { name: "Save snapshot" }).getAttribute("href")).toBe("#snapshot-save");
    expect(snapshotReminderText(31)).toContain("31 days");
  });

  it("renders nothing when the latest snapshot is fresh", () => {
    const fresh = new Date(NOW - 29 * DAY).toISOString();
    const { container } = render(<SnapshotReminderBanner latestSnapshotCreatedAt={fresh} nowMs={NOW} />);

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when dismissed for the current latest snapshot", () => {
    window.localStorage.setItem(KEY, LATEST);

    const { container } = render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);

    expect(container.innerHTML).toBe("");
  });

  it("shows again when localStorage holds an older latest snapshot key", () => {
    window.localStorage.setItem(KEY, OLDER);

    render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);

    expect(screen.getByRole("status").textContent).toContain("It's been 31 days since your last snapshot");
  });

  it("stores the current latest snapshot timestamp when dismissed", () => {
    render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(window.localStorage.getItem(KEY)).toBe(LATEST);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
