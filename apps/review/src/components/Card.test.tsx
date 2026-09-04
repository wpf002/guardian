import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("gives the section a heading and renders its children", () => {
    render(
      <Card title="Policy for T2" aside="Edited 22 Aug">
        <p>A progression pattern across two stages.</p>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Policy for T2" })).toBeTruthy();
    expect(screen.getByText("Edited 22 Aug")).toBeTruthy();
    expect(screen.getByText(/progression pattern/)).toBeTruthy();
  });

  it("renders a footer when one is given", () => {
    render(
      <Card footer="model rules-v2, lexicon v2">
        <p>body</p>
      </Card>,
    );
    expect(screen.getByText("model rules-v2, lexicon v2")).toBeTruthy();
  });
});
