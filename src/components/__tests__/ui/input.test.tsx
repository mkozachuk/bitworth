import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";
import userEvent from "@testing-library/user-event";

describe("Input", () => {
  it("renders without crashing", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders with label", () => {
    render(<Input label="Amount" />);
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });

  it("forwards ref", () => {
    let refValue: HTMLInputElement | null = null;
    render(
      <Input
        ref={(el) => {
          refValue = el;
        }}
      />,
    );
    expect(refValue).not.toBeNull();
  });

  it("shows error message", () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText("This field is required")).toBeInTheDocument();
  });

  it("applies error styling when error is present", () => {
    const { container } = render(<Input error="Error" />);
    const input = container.querySelector("input")!;
    expect(input.className).toContain("border-red-500");
  });

  it("applies normal styling when no error", () => {
    const { container } = render(<Input />);
    const input = container.querySelector("input")!;
    expect(input.className).toContain("border-white/20");
  });

  it("handles user input", async () => {
    const user = userEvent.setup();
    render(<Input />);
    const input = screen.getByRole("textbox");
    await user.type(input, "1000");
    expect(input).toHaveValue("1000");
  });

  it("forwards standard input props", () => {
    const { container } = render(<Input type="number" placeholder="0.00" min={0} />);
    const input = container.querySelector("input")!;
    expect(input.type).toBe("number");
    expect(input.placeholder).toBe("0.00");
  });
});
