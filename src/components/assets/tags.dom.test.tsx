// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TagChips } from "./TagChips";
import { TagPicker } from "./TagPicker";
import { AssetForm } from "./AssetForm";

// Rendered checks for the B1a tag UI: chips render names as text (never as
// markup), the picker toggles with aria-pressed, and AssetForm saves the tag
// set after the asset, without creating a second asset when only the tags fail.

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const NEW_ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function jsonBody(init?: RequestInit): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : null;
}

function stubFetch(route: Route) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.endsWith("/api/categories")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "cash", name: "Cash", is_liability: false, display_order: 1 }] })),
      );
    }
    const hit = route(url, init) ?? { status: 404, body: { error: { code: "NOT_FOUND", message: "unrouted" } } };
    return Promise.resolve(new Response(JSON.stringify(hit.body), { status: hit.status }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof stubFetch>, suffix: string) {
  return fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith(suffix));
}

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Index fund" } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
  await waitFor(() => {
    expect(screen.getByRole("option", { name: /Cash/ })).toBeDefined();
  });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "cash" } });
  fireEvent.click(screen.getByRole("button", { name: /Add Asset|Save Changes/ }));
}

beforeEach(() => {
  vi.stubGlobal("confirm", () => true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TagChips", () => {
  it("renders each name as text, so markup in a name is shown, not parsed", () => {
    render(
      <TagChips
        tags={[
          { id: T1, name: "<b>bold</b>" },
          { id: T2, name: "ETF" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Tags" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["<b>bold</b>", "ETF"]);
    expect(list.querySelector("b")).toBeNull();
  });

  it("renders nothing for an asset without tags", () => {
    const { container } = render(<TagChips tags={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("TagPicker", () => {
  it("toggles a tag on and off through aria-pressed buttons", () => {
    const onChange = vi.fn();
    const tags = [
      { id: T1, name: "ETF" },
      { id: T2, name: "Bonds" },
    ];
    const { rerender } = render(<TagPicker tags={tags} selected={[T2]} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "ETF" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Bonds" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "ETF" }));
    expect(onChange).toHaveBeenLastCalledWith([T2, T1]);

    rerender(<TagPicker tags={tags} selected={[T2, T1]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Bonds" }));
    expect(onChange).toHaveBeenLastCalledWith([T1]);
  });

  it("points to Settings when the user has no tags yet", () => {
    render(<TagPicker tags={[]} selected={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/dashboard/settings");
  });
});

describe("AssetForm tag picker", () => {
  const tags = [
    { id: T1, name: "ETF" },
    { id: T2, name: "Bonds" },
  ];

  it("on create, saves the chosen tags against the new asset's id", async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/assets" && init?.method === "POST") return { status: 201, body: { data: { id: NEW_ASSET } } };
      if (url === `/api/assets/${NEW_ASSET}/tags`) return { status: 200, body: { data: {} } };
      return undefined;
    });
    render(<AssetForm mode="create" tags={tags} />);
    fireEvent.click(screen.getByRole("button", { name: "ETF" }));
    await fillAndSubmit();

    await waitFor(() => {
      expect(callsTo(fetchMock, `/api/assets/${NEW_ASSET}/tags`)).toHaveLength(1);
    });
    const [, init] = callsTo(fetchMock, `/api/assets/${NEW_ASSET}/tags`)[0];
    expect(init?.method).toBe("PUT");
    expect(jsonBody(init)).toEqual({ tag_ids: [T1] });
  });

  it("does not call the tags endpoint when the selection did not change", async () => {
    const asset = {
      id: NEW_ASSET,
      user_id: "u1",
      name: "Index fund",
      category_id: "cash",
      amount: 100,
      currency: "USD",
      crypto_symbol: null,
      metal_symbol: null,
      notes: null,
      quantity: null,
      show_on_chart: false,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const fetchMock = stubFetch((url, init) =>
      url === `/api/assets/${NEW_ASSET}` && init?.method === "PUT" ? { status: 200, body: { data: asset } } : undefined,
    );
    render(<AssetForm mode="edit" asset={asset} tags={tags} initialTagIds={[T2]} />);
    await fillAndSubmit();
    await waitFor(() => {
      expect(callsTo(fetchMock, `/api/assets/${NEW_ASSET}`)).toHaveLength(1);
    });
    expect(callsTo(fetchMock, "/tags")).toHaveLength(0);
  });

  it("when only the tags fail after a create, says so and retries against the same asset, never creating a second", async () => {
    let tagAttempts = 0;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/assets" && init?.method === "POST") return { status: 201, body: { data: { id: NEW_ASSET } } };
      if (url === `/api/assets/${NEW_ASSET}` && init?.method === "PUT") return { status: 200, body: { data: {} } };
      if (url === `/api/assets/${NEW_ASSET}/tags`) {
        tagAttempts++;
        return tagAttempts === 1
          ? { status: 404, body: { error: { code: "NOT_FOUND", message: "Tag not found" } } }
          : { status: 200, body: { data: {} } };
      }
      return undefined;
    });
    render(<AssetForm mode="create" tags={tags} />);
    fireEvent.click(screen.getByRole("button", { name: "Bonds" }));
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText("Asset saved, but its tags were not: Tag not found")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add Asset/ }));
    await waitFor(() => {
      expect(tagAttempts).toBe(2);
    });
    const assetWrites = fetchMock.mock.calls.filter(([input]) => /\/api\/assets(\/[^/]+)?$/.test(urlOf(input)));
    expect(assetWrites.map(([input, init]) => `${init?.method ?? "GET"} ${urlOf(input)}`)).toEqual([
      "POST /api/assets",
      `PUT /api/assets/${NEW_ASSET}`,
    ]);
  });
});
