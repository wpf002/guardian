import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeyboardHelp } from "./KeyboardHelp";

describe("KeyboardHelp", () => {
  it("renders from the keymap registry so the sheet cannot drift", () => {
    render(<KeyboardHelp />);
    expect(screen.getByRole("heading", { name: "Deciding" })).toBeTruthy();
    expect(
      screen.getByText(/Submit the decision with the highlighted reason/),
    ).toBeTruthy();
  });

  it("renders in a dialog when the caller opens it as a sheet", () => {
    render(<KeyboardHelp open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });
});
