// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TagsManager } from "./TagsManager";

// Rendered checks for Settings → Tags: create, the 409 message, rename, the
// dashboard toggle and delete, each saved through /api/tags.

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

function jsonBody(init: RequestInit): unknown {
  return typeof init.body === "string" ? JSON.parse(init.body) : null;
}

beforeEach(() => {
  vi.stubGlobal("confirm", () => true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function names(): string[] {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("span")?.textContent ?? "");
}

describe("TagsManager", () => {
  it("lists tags by name, ignoring case", () => {
    render(
      <TagsManager
        initialTags={[
          { id: T1, name: "etf", show_on_dashboard: false },
          { id: T2, name: "Bonds", show_on_dashboard: true },
        ]}
      />,
    );
    expect(names()).toEqual(["Bonds", "etf"]);
  });

  it("creates a tag with the trimmed name and adds the server's row", async () => {
    fetchMock = vi.fn<FetchFn>(() => respond(201, { data: { id: T1, name: "Long term", show_on_dashboard: false } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TagsManager initialTags={[]} />);

    fireEvent.change(screen.getByLabelText("New tag name"), { target: { value: "  Long term  " } });
    fireEvent.click(screen.getByRole("button", { name: /Add tag/ }));

    await waitFor(() => {
      expect(names()).toEqual(["Long term"]);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect([url, init.method, jsonBody(init)]).toEqual(["/api/tags", "POST", { name: "Long term" }]);
  });

  it("shows the server's 409 message for a duplicate name and adds nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => respond(409, { error: { code: "DUPLICATE_TAG", message: 'A tag named "ETF" already exists' } })),
    );
    render(<TagsManager initialTags={[{ id: T1, name: "etf", show_on_dashboard: false }]} />);

    fireEvent.change(screen.getByLabelText("New tag name"), { target: { value: "ETF" } });
    fireEvent.click(screen.getByRole("button", { name: /Add tag/ }));

    await waitFor(() => {
      expect(screen.getByText('A tag named "ETF" already exists')).toBeDefined();
    });
    expect(names()).toEqual(["etf"]);
  });

  it("rejects a 33-character name before calling the API", () => {
    fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", fetchMock);
    render(<TagsManager initialTags={[]} />);
    fireEvent.change(screen.getByLabelText("New tag name"), { target: { value: "x".repeat(33) } });
    fireEvent.click(screen.getByRole("button", { name: /Add tag/ }));
    expect(screen.getByText("name must be at most 32 characters")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renames, toggles show_on_dashboard, and deletes through PATCH/DELETE /api/tags/:id", async () => {
    fetchMock = vi.fn<FetchFn>((_url, init) => {
      const body = (jsonBody(init) ?? {}) as Record<string, unknown>;
      if (init.method === "DELETE") return respond(200, { data: { id: T1 } });
      return respond(200, { data: { id: T1, name: "Core", show_on_dashboard: false, ...body } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TagsManager initialTags={[{ id: T1, name: "ETF", show_on_dashboard: false }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename ETF" }));
    fireEvent.change(screen.getByLabelText("New name for ETF"), { target: { value: "Core" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name for ETF" }));
    await waitFor(() => {
      expect(names()).toEqual(["Core"]);
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Show chart on dashboard" }));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Show chart on dashboard" })).toHaveProperty("checked", true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Core" }));
    await waitFor(() => {
      expect(screen.getByText(/No tags yet/)).toBeDefined();
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [init.method, url, jsonBody(init)])).toEqual([
      ["PATCH", `/api/tags/${T1}`, { name: "Core" }],
      ["PATCH", `/api/tags/${T1}`, { show_on_dashboard: true }],
      ["DELETE", `/api/tags/${T1}`, null],
    ]);
  });
});
