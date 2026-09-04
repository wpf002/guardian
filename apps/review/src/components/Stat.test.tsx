import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders a value with its label and target", () => {
    render(<Stat label="Pairs at T2 this week" value={12} target="target PPV 40%" />);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Pairs at T2 this week")).toBeTruthy();
    expect(screen.getByText("target PPV 40%")).toBeTruthy();
  });

  it("prints a sentence rather than a number below the reporting threshold", () => {
    render(<Stat label="T2 positive predictive value" value={null} unavailableNote="not enough decisions yet (n = 2)" />);
    expect(screen.getByText("not enough decisions yet (n = 2)")).toBeTruthy();
  });
});
