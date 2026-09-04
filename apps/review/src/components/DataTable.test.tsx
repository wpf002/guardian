import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable";

interface Row {
  id: string;
  pair: string;
  minutes: number;
}

const rows: Row[] = [
  { id: "a", pair: "4f2a", minutes: 17 },
  { id: "b", pair: "91c7", minutes: 6 },
];

const columns = [
  { key: "pair", header: "Pair", render: (row: Row) => row.pair },
  { key: "minutes", header: "Minutes", numeric: true, render: (row: Row) => row.minutes },
];

describe("DataTable", () => {
  it("captions the table and renders every row", () => {
    render(<DataTable caption="Your decisions" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole("table", { name: /Your decisions/ })).toBeTruthy();
    expect(screen.getAllByRole("row").length).toBe(3);
  });

  it("makes rows the tab stop and selects on Enter when selectable", () => {
    const onSelect = vi.fn();
    render(
      <DataTable
        caption="Your decisions"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onSelect={onSelect}
      />,
    );
    const first = screen.getAllByRole("row")[1]!;
    expect(first.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(first, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
  });

  it("says so when there is nothing to show", () => {
    render(
      <DataTable
        caption="Your decisions"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyMessage="You have not decided anything this shift."
      />,
    );
    expect(screen.getByText("You have not decided anything this shift.")).toBeTruthy();
  });
});
