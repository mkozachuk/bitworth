import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select } from "@/components/ui/select";
import userEvent from "@testing-library/user-event";

describe("Select", () => {
  const options = [
    { value: "PLN", label: "Polish Zloty (PLN)" },
    { value: "USD", label: "US Dollar (USD)" },
    { value: "EUR", label: "Euro (EUR)" },
  ];

  it("renders with label", () => {
    render(<Select label="Currency" options={options} />);
    expect(screen.getByLabelText("Currency")).toBeInTheDocument();
  });

  it("renders all options", () => {
    render(<Select options={options} />);
    const select = screen.getByRole("combobox");
    expect(select.options).toHaveLength(3);
    expect(select.options[0].value).toBe("PLN");
    expect(select.options[1].value).toBe("USD");
    expect(select.options[2].value).toBe("EUR");
  });

  it("renders placeholder option", () => {
    render(<Select options={options} placeholder="Select currency" />);
    const select = screen.getByRole("combobox");
    expect(select.options[0].value).toBe("");
    expect(select.options[0].text).toBe("Select currency");
    expect(select.options[0].disabled).toBe(true);
  });

  it("shows error message", () => {
    render(<Select error="Please select an option" options={options} />);
    expect(screen.getByText("Please select an option")).toBeInTheDocument();
  });

  it("applies error styling when error is present", () => {
    const { container } = render(<Select error="Error" options={options} />);
    const select = container.querySelector("select")!;
    expect(select.className).toContain("border-red-500");
  });

  it("forwards ref", () => {
    let refValue: HTMLSelectElement | null = null;
    render(
      <Select
        ref={(el) => {
          refValue = el;
        }}
        options={options}
      />,
    );
    expect(refValue).not.toBeNull();
  });

  it("handles selection change", async () => {
    const user = userEvent.setup();
    render(<Select options={options} />);
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "USD");
    expect(select).toHaveValue("USD");
  });
});
