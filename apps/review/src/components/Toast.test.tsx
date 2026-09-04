import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

describe("Toast", () => {
  it("announces politely and offers the one action", () => {
    const onAction = vi.fn();
    render(
      <Toast
        message="Dismissed. The pair returns to normal scoring."
        action={{ label: "Undo", onAction }}
      />,
    );
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("prints the remaining seconds in text rather than fading away", () => {
    render(<Toast message="Dismissed." countdownSeconds={60} />);
    expect(screen.getByText("60s left")).toBeTruthy();
  });

  /**
   * The bar is a polite live region, so a seconds figure inside it queues one
   * announcement per tick: a sixty second window saturated a screen reader's
   * output for a minute, over the message and the action it was announcing.
   */
  it("keeps the ticking counter out of the announcement", () => {
    render(<Toast message="Dismissed." countdownSeconds={60} />);
    const seconds = screen.getByText("60s left");
    expect(seconds.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
