// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StalePriceBanner, staleBannerText } from "./StalePriceBanner";
import type { StaleCandidate } from "@/lib/stale-prices";

// P2 (the banner's two states) and the P3 button. `nowMs` is a prop, so no
// state depends on the wall clock. Fixtures are synthetic.

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const DAY = 86_400_000;

function asset(over: Partial<StaleCandidate>, ageDays: number): StaleCandidate {
  return {
    quantity: null,
    crypto_symbol: null,
    metal_symbol: null,
    updated_at: new Date(NOW - ageDays * DAY).toISOString(),
    ...over,
  };
}

const btcOld = asset({ quantity: 0.5, crypto_symbol: "BTC" }, 62);
const xauOld = asset({ quantity: 2, metal_symbol: "XAU" }, 10);
const ethOld = asset({ quantity: 3, crypto_symbol: "ETH" }, 30);
const ethFresh = asset({ quantity: 3, crypto_symbol: "ETH" }, 2);
const cashOld = asset({}, 400);

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(cleanup);

describe("StalePriceBanner: shown and hidden (P2)", () => {
  it("shows the count of stale holdings and the oldest age in days", () => {
    render(<StalePriceBanner assets={[ethFresh, xauOld, cashOld, btcOld, ethOld]} nowMs={NOW} />);

    expect(screen.getByRole("status").textContent).toContain("Prices for 3 holdings are 62 days old");
    expect(screen.getByRole("button", { name: "Reprice now" })).toBeDefined();
  });

  it("uses the singular for one holding", () => {
    render(<StalePriceBanner assets={[xauOld, ethFresh]} nowMs={NOW} />);

    expect(screen.getByText("Price for 1 holding is 10 days old")).toBeDefined();
  });

  it("renders nothing when no priced holding is stale", () => {
    const { container } = render(<StalePriceBanner assets={[ethFresh, cashOld]} nowMs={NOW} />);

    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("button", { name: "Reprice now" })).toBeNull();
  });

  it("renders nothing for an empty asset list", () => {
    const { container } = render(<StalePriceBanner assets={[]} nowMs={NOW} />);

    expect(container.innerHTML).toBe("");
  });

  it("formats the copy", () => {
    expect(staleBannerText(3, 62)).toBe("Prices for 3 holdings are 62 days old");
    expect(staleBannerText(1, 8)).toBe("Price for 1 holding is 8 days old");
    expect(staleBannerText(2, 1)).toBe("Prices for 2 holdings are 1 day old");
  });
});

describe("StalePriceBanner: Reprice now (P3)", () => {
  it("POSTs to /api/assets/reprice and refreshes the shown amounts on success", async () => {
    const fetchMock = stubFetch(200, { data: { repriced: [{ id: "a" }], unchanged: [], failed: [] } });
    const onRepriced = vi.fn();
    render(<StalePriceBanner assets={[btcOld]} nowMs={NOW} onRepriced={onRepriced} />);

    fireEvent.click(screen.getByRole("button", { name: "Reprice now" }));

    await waitFor(() => {
      expect(onRepriced).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/assets/reprice", { method: "POST", credentials: "include" });
  });

  it("shows the failed symbols in the reprice-warning style and keeps the button usable when nothing refreshed", async () => {
    stubFetch(200, {
      data: { repriced: [], unchanged: [], failed: [{ symbol: "BTC" }, { symbol: "XAU" }, { symbol: "BTC" }] },
    });
    const onRepriced = vi.fn();
    render(<StalePriceBanner assets={[btcOld, xauOld]} nowMs={NOW} onRepriced={onRepriced} />);

    fireEvent.click(screen.getByRole("button", { name: "Reprice now" }));

    const notice = await screen.findByText("Price unavailable for BTC, XAU — stored values kept.");
    expect(notice.className).toContain("text-muted-foreground");
    expect(screen.getByRole("button", { name: "Reprice now" }).hasAttribute("disabled")).toBe(false);
    expect(onRepriced).not.toHaveBeenCalled();
  });

  it("shows a partial failure and still refreshes the rest", async () => {
    stubFetch(200, { data: { repriced: [{ id: "x" }], unchanged: [], failed: [{ symbol: "BTC" }] } });
    render(<StalePriceBanner assets={[btcOld, xauOld]} nowMs={NOW} onRepriced={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Reprice now" }));

    expect(await screen.findByText("Price unavailable for BTC — stored values kept.")).toBeDefined();
    expect(screen.getByText("Prices refreshed — refreshing…")).toBeDefined();
  });

  it("shows the server error when the request fails", async () => {
    stubFetch(401, { error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    const onRepriced = vi.fn();
    render(<StalePriceBanner assets={[btcOld]} nowMs={NOW} onRepriced={onRepriced} />);

    fireEvent.click(screen.getByRole("button", { name: "Reprice now" }));

    expect(await screen.findByText("Reprice failed: Not authenticated")).toBeDefined();
    expect(onRepriced).not.toHaveBeenCalled();
  });
});
