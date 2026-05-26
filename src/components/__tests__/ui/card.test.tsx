import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Hello World</Card>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("applies default classes", () => {
    const { container } = render(<Card />);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain("rounded-2xl");
    expect(div.className).toContain("border-white/10");
    expect(div.className).toContain("bg-white/10");
  });

  it("merges custom className", () => {
    const { container } = render(<Card className="mt-4" />);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain("mt-4");
  });
});

describe("CardHeader", () => {
  it("renders children", () => {
    render(<CardHeader>Header Content</CardHeader>);
    expect(screen.getByText("Header Content")).toBeInTheDocument();
  });

  it("applies margin bottom", () => {
    const { container } = render(<CardHeader />);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain("mb-4");
  });
});

describe("CardTitle", () => {
  it("renders children as heading", () => {
    render(<CardTitle>My Title</CardTitle>);
    const h3 = screen.getByText("My Title");
    expect(h3.tagName).toBe("H3");
  });

  it("applies title styles", () => {
    const { container } = render(<CardTitle />);
    const h3 = container.firstChild as HTMLElement;
    expect(h3.className).toContain("text-lg");
    expect(h3.className).toContain("font-semibold");
    expect(h3.className).toContain("text-white");
  });
});

describe("CardContent", () => {
  it("renders children", () => {
    render(<CardContent>Content</CardContent>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });
});
