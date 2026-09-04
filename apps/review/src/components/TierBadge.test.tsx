import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TierBadge } from "./TierBadge";

describe("TierBadge", () => {
  it("renders the tier as a word, not a risk adjective", () => {
    render(<TierBadge tier="T2" />);
    expect(screen.getByText("T2")).toBeTruthy();
  });

  it("names the critical signal in words rather than by shape alone", () => {
    render(<TierBadge tier="T2" criticalSignals={["threat template match"]} />);
    expect(screen.getByLabelText(/critical signal: threat template match/)).toBeTruthy();
  });

  it("prints the tier's meaning in plain words when asked", () => {
    render(<TierBadge tier="T1" withMeaning />);
    expect(screen.getByText("watch, retained 30 days")).toBeTruthy();
  });
});
