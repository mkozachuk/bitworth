// @vitest-environment happy-dom
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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
  it("shows the overdue reminder with the right day count", async () => {
    render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);

    expect((await screen.findByRole("status")).textContent).toContain("It's been 31 days since your last snapshot");
    expect(screen.getByRole("link", { name: "Save snapshot" }).getAttribute("href")).toBe("#snapshot-save");
    expect(snapshotReminderText(31)).toContain("31 days");
  });

  it("renders nothing when the latest snapshot is fresh", () => {
    const fresh = new Date(NOW - 29 * DAY).toISOString();
    const { container } = render(<SnapshotReminderBanner latestSnapshotCreatedAt={fresh} nowMs={NOW} />);

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when dismissed for the current latest snapshot", async () => {
    window.localStorage.setItem(KEY, LATEST);

    const { container } = render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);

    // Flush the after-mount storage read before asserting.
    await act(() => Promise.resolve());
    expect(container.innerHTML).toBe("");
  });

  it("shows again when localStorage holds an older latest snapshot key", async () => {
    window.localStorage.setItem(KEY, OLDER);

    render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);

    expect((await screen.findByRole("status")).textContent).toContain("It's been 31 days since your last snapshot");
  });

  it("stores the current latest snapshot timestamp when dismissed", async () => {
    render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(window.localStorage.getItem(KEY)).toBe(LATEST);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("server-renders nothing for the overdue case with empty storage", () => {
    expect(renderToString(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />)).toBe("");
  });

  it("server-renders nothing for the overdue case when dismissed", () => {
    window.localStorage.setItem(KEY, LATEST);

    expect(renderToString(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />)).toBe("");
  });

  it("keeps the banner dismissed across a remount (reload)", async () => {
    render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();

    cleanup();

    const { container } = render(<SnapshotReminderBanner latestSnapshotCreatedAt={LATEST} nowMs={NOW} />);
    // Flush the after-mount storage read before asserting.
    await act(() => Promise.resolve());
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.innerHTML).toBe("");
  });
});
