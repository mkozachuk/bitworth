// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { ApproximateRatesNotice, APPROXIMATE_RATES_EXPLAIN } from "./ApproximateRatesNotice";

// B4: the notice is absent with live rates and says "Approximate rate" with
// the fallback STATIC_RATES.

afterEach(cleanup);

describe("ApproximateRatesNotice", () => {
  it("renders nothing when the rates are live", () => {
    const { container } = render(<ApproximateRatesNotice approximate={false} />);

    expect(screen.queryByTestId("approximate-rates")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("shows one status element with the label and the explanation on the fallback", () => {
    render(<ApproximateRatesNotice approximate={true} />);

    const el = screen.getByTestId("approximate-rates");
    expect(screen.getAllByRole("status")).toEqual([el]);
    expect(el.textContent).toContain("Approximate rate");
    expect(el.textContent).toContain(APPROXIMATE_RATES_EXPLAIN);
  });
});
