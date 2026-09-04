import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./Field";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

describe("Field", () => {
  it("labels its input and publishes the help text for a screen reader", () => {
    render(<Field id="token" label="Seat token" help="Your operator issues one per seat." />);
    const input = screen.getByLabelText("Seat token");
    expect(input.getAttribute("aria-describedby")).toBe("token-help");
  });

  it("marks itself invalid and shows the error in the same voice as the label", () => {
    render(<Field id="token" label="Seat token" error="That token does not match a seat." />);
    expect(screen.getByLabelText("Seat token").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("does not match a seat");
  });
});

describe("Select", () => {
  it("renders its options and reports a change", () => {
    const onChange = vi.fn();
    render(
      <Select
        id="incident"
        label="Incident type"
        onChange={onChange}
        options={[
          { value: "enticement", label: "Online enticement of a child for sexual acts" },
          { value: "trafficking", label: "Child sex trafficking" },
        ]}
      />,
    );
    const select = screen.getByLabelText("Incident type");
    fireEvent.change(select, { target: { value: "trafficking" } });
    expect(onChange).toHaveBeenCalled();
  });
});

describe("Textarea", () => {
  it("carries a prompt as its label rather than a blank box", () => {
    render(
      <Textarea id="note" label="What in the timeline supports this" help="One or two sentences." />,
    );
    expect(screen.getByLabelText("What in the timeline supports this")).toBeTruthy();
  });
});
