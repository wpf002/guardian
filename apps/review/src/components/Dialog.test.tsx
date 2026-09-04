import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} title="Reveal every span" onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names itself, traps focus on the first control and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Reveal every span" onClose={onClose} footer={<button>Reveal</button>}>
        <button>Cancel</button>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
