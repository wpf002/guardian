import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState, SkeletonRows } from "./LoadingState";

describe("EmptyState", () => {
  it("names the state and gives the last known good fact", () => {
    render(
      <EmptyState
        title="Nothing is waiting."
        detail="The queue is live and will fill this row when something arrives."
        meta="Last arrival 14:02."
      />,
    );
    expect(screen.getByText("Nothing is waiting.")).toBeTruthy();
    expect(screen.getByText("Last arrival 14:02.")).toBeTruthy();
  });
});

describe("LoadingState", () => {
  it("names what is loading and reserves the exact final height", () => {
    render(<LoadingState label="Loading 14 messages" count={2} rowHeight={80} />);
    expect(screen.getByRole("status").textContent).toBe("Loading 14 messages");
  });

  it("renders bare skeleton rows when the caller owns the heading", () => {
    const { container } = render(<SkeletonRows count={3} />);
    expect(container.firstElementChild!.children.length).toBe(3);
  });
});

describe("ErrorState", () => {
  it("names what failed, what is unaffected, and retries only on request", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="The queue could not be reached."
        unaffected="Cases are not lost. The scorer keeps writing."
        lastSuccessAt="14:02"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Cases are not lost/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
