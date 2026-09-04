import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label and calls back on click", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Confirm</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("carries the variant so one accent stays on the primary action", () => {
    render(<Button variant="primary">Send</Button>);
    expect(screen.getByRole("button").dataset.variant).toBe("primary");
  });

  it("disables and announces while a write is in flight", () => {
    render(<Button loading>Confirm</Button>);
    const button = screen.getByRole("button");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("prints the reason when it is disabled, never a bare greyed control", () => {
    render(
      <Button disabledReason="The timeline could not be loaded, so this case cannot be confirmed.">
        Confirm
      </Button>,
    );
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/timeline could not be loaded/)).toBeTruthy();
  });
});
