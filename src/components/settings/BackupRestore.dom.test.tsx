// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackupRestore } from "./BackupRestore";

// Rendered checks for the "Download CSV" control beside the backup export: it
// fetches /api/snapshots/export.csv, downloads a bitworth-snapshots-*.csv blob,
// surfaces a server error, and leaves the backup export on its own endpoint.

type FetchFn = (url: string) => Promise<Response>;

let downloads: string[];
let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  downloads = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() }));
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  clickSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("BackupRestore — Download CSV", () => {
  it("renders the control next to the backup export", () => {
    render(<BackupRestore />);
    expect(screen.getByRole("button", { name: /Export backup/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download CSV/ })).toBeTruthy();
  });

  it("fetches the CSV endpoint and downloads bitworth-snapshots-YYYY-MM-DD.csv", async () => {
    const fetchMock = vi.fn<FetchFn>(() =>
      Promise.resolve(
        new Response("\uFEFFsnapshot_date\r\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BackupRestore />);

    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/snapshots/export.csv");
    expect(downloads[0]).toMatch(/^bitworth-snapshots-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("shows the server's error message when the export fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchFn>(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "FETCH_FAILED", message: "db down" } }), { status: 500 }),
        ),
      ),
    );
    render(<BackupRestore />);

    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));

    expect(await screen.findByText("db down")).toBeTruthy();
    expect(downloads).toHaveLength(0);
  });

  it("leaves the backup export on /api/backup/export", async () => {
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    render(<BackupRestore />);

    fireEvent.click(screen.getByRole("button", { name: /Export backup/ }));

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/backup/export");
    expect(downloads[0]).toMatch(/^\d{4}-\d{2}-\d{2}-bitworth-export\.json$/);
  });
});
