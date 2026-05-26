import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton, SkeletonCard, SkeletonRow } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  it("renders with default class", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("bg-white/10");
  });

  it("merges custom className", () => {
    const { container } = render(<Skeleton className="h-4 w-full" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("h-4");
    expect(el.className).toContain("w-full");
  });

  it("is accessible via aria-hidden", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("SkeletonCard", () => {
  it("renders card structure", () => {
    const { container } = render(<SkeletonCard />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("rounded-2xl");
    expect(el.className).toContain("bg-white/10");
  });
});

describe("SkeletonRow", () => {
  it("renders row structure", () => {
    const { container } = render(<SkeletonRow />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("flex");
    expect(el.className).toContain("items-center");
  });
});
