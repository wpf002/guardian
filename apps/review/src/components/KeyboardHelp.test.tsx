import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeyboardHelp } from "./KeyboardHelp";

describe("KeyboardHelp", () => {
  it("renders from the keymap registry so the sheet cannot drift", () => {
    render(<KeyboardHelp />);
    expect(screen.getByRole("heading", { name: "In a Conversation" })).toBeTruthy();
    expect(screen.getByText("Save with the highlighted reason")).toBeTruthy();
    // Only keys that do something. These were listed and never wired.
    expect(screen.queryByText(/Jump to the timeline/)).toBeNull();
    expect(screen.queryByText(/Next case/)).toBeNull();
  });

  it("renders in a dialog when the caller opens it as a sheet", () => {
    render(<KeyboardHelp open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });
});
