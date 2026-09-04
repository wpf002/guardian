import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditPage from "@/app/audit/page";
import { exportRangeAction, verifyRangeAction } from "@/app/audit/actions";
import { ChainTools } from "@/components/audit";
import type { ExportOutcome, VerifyOutcome } from "@/components/audit";
import { resetMockData } from "@/lib/mock/fixtures";

/**
 * The chain view, against the fixtures. Mock mode signs in the default owner
 * seat, so these run with no environment and no database.
 */

beforeEach(() => {
  resetMockData();
});

async function renderAuditPage(params: Record<string, string> = {}) {
  const ui = await AuditPage({ searchParams: Promise.resolve(params) });
  return render(ui);
}

describe("the audit view", () => {
  it("renders the head, the newest entries and their payloads as key and value", async () => {
    await renderAuditPage();

    expect(screen.getByRole("heading", { name: "Audit chain", level: 1 })).toBeTruthy();
    expect(screen.getByText(/Scoped to Northwood Gaming/)).toBeTruthy();
    expect(screen.getByText("Chain entries, newest first, page 1.")).toBeTruthy();

    const head = within(screen.getByRole("region", { name: "Chain head" }));
    expect(head.getByText("#40")).toBeTruthy();
    expect(head.getByText("Head hash")).toBeTruthy();

    // The sequence number is the row's tab stop and links to the one entry view.
    const link = within(screen.getByRole("table")).getByRole("link", { name: "#40" });
    expect(link.getAttribute("href")).toBe("/audit/40");

    // Payloads print as key and value, and none of them carries message text.
    expect(screen.getAllByText("pairId").length).toBeGreaterThan(0);
    expect(screen.queryByText(/does not carry message text/)).toBeNull();
  });

  it("filters by kind, and says so in the caption", async () => {
    await renderAuditPage({ kind: "score.assigned" });

    const table = within(screen.getByRole("table"));
    expect(
      screen.getByText("Chain entries of kind score.assigned, newest first, page 1."),
    ).toBeTruthy();
    expect(table.getAllByText("score.assigned").length).toBeGreaterThan(0);
    for (const other of [
      "event.ingested",
      "bundle.exported",
      "retention.deleted",
      "lexicon.updated",
      "customer.violation",
    ]) {
      expect(table.queryByText(other)).toBeNull();
    }
  });

  it("names the empty state and keeps the way back when a page runs past the chain", async () => {
    await renderAuditPage({ page: "9" });

    expect(screen.getByText("This page is past the end of the chain.")).toBeTruthy();
    expect(screen.getByText("Chain head #40.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the newest entries" })).toBeTruthy();
  });

  it("verifies the range on the page and names the result", async () => {
    await renderAuditPage();

    expect(
      screen.getByText("No verification has been run on this range in this session."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Verify this range/ }));

    await waitFor(() => {
      expect(screen.getByText(/Verified\. 25 entries checked from #16/)).toBeTruthy();
    });
  });
});

describe("the chain tools", () => {
  const head = { headSeq: 40, headHash: "a".repeat(64) };

  function outcome(overrides: Partial<VerifyOutcome> = {}): VerifyOutcome {
    return {
      ok: true,
      fromSeq: 1,
      toSeq: 40,
      checked: 40,
      sentence: "Verified. 40 entries checked from #1, ending at hash aaaaaaaaaaaa...",
      ...overrides,
    };
  }

  function exportOutcome(): ExportOutcome {
    return {
      filename: "guardian-audit-cus_northwood-1-40.json",
      json: '{"document":"guardian_audit_chain_export"}',
      entryCount: 40,
      verification: outcome(),
      recordedSeq: 41,
      sentence: "40 entries from #1 to #40 are in the file. The export was recorded as #41.",
    };
  }

  it("names the entry a broken chain broke on", async () => {
    render(
      <ChainTools
        {...head}
        defaultFrom={1}
        defaultTo={40}
        canExport
        onVerify={async () =>
          outcome({
            ok: false,
            checked: 16,
            brokenAt: 17,
            sentence:
              "The chain does not verify. Entry #17 is where it breaks: the entry does not match its recorded hash.",
          })
        }
        onExport={async () => exportOutcome()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Verify this range/ }));

    await waitFor(() => {
      expect(screen.getByText(/Entry #17 is where it breaks/)).toBeTruthy();
    });
  });

  it("hands the export to the browser and says where it was recorded", async () => {
    const downloaded = vi.fn();
    render(
      <ChainTools
        {...head}
        defaultFrom={1}
        defaultTo={40}
        canExport
        onVerify={async () => outcome()}
        onExport={async () => exportOutcome()}
        onDownload={downloaded}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Export this range as JSON/ }));

    await waitFor(() => {
      expect(downloaded).toHaveBeenCalledTimes(1);
    });
    expect(downloaded.mock.calls[0]?.[0].filename).toBe("guardian-audit-cus_northwood-1-40.json");
    expect(screen.getByText(/The export was recorded as #41/)).toBeTruthy();
  });

  it("refuses a range it cannot run, and prints why", async () => {
    const onVerify = vi.fn(async () => outcome());
    render(
      <ChainTools
        {...head}
        defaultFrom={40}
        defaultTo={40}
        canExport
        onVerify={onVerify}
        onExport={async () => exportOutcome()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Last entry"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify this range/ }));

    expect(screen.getByText("The last entry has to be at or after the first.")).toBeTruthy();
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("disables the export with the reason in text on a seat that may not export", () => {
    render(
      <ChainTools
        {...head}
        defaultFrom={1}
        defaultTo={40}
        canExport={false}
        exportBlockedReason="An operator seat exports the chain for counsel. Yours can read and verify it."
        onVerify={async () => outcome()}
        onExport={async () => exportOutcome()}
      />,
    );

    const button = screen.getByRole("button", { name: /Export this range as JSON/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/An operator seat exports the chain for counsel/)).toBeTruthy();
  });
});

describe("the chain actions", () => {
  it("verifies the fixture chain from the root", async () => {
    const result = await verifyRangeAction(1, 40);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(40);
    expect(result.sentence).toContain("Verified. 40 entries checked from #1");
  });

  it("exports the verified range and records the export in the chain", async () => {
    const result = await exportRangeAction(1, 5);

    expect(result.entryCount).toBe(5);
    expect(result.verification.ok).toBe(true);
    expect(result.filename).toBe("guardian-audit-cus_northwood-1-5.json");

    const doc = JSON.parse(result.json);
    expect(doc.document).toBe("guardian_audit_chain_export");
    expect(doc.customerId).toBe("cus_northwood");
    expect(doc.entries).toHaveLength(5);
    expect(doc.entries[0].seq).toBe(1);
    expect(doc.entries[4].seq).toBe(5);
    expect(doc.verification.ok).toBe(true);

    // An export is a write, and it lands in the chain it exported.
    expect(result.recordedSeq).toBe(41);

    // Rule 1 and the chain's own shape: no message text leaves in the document.
    for (const entry of doc.entries as { payload: Record<string, unknown> }[]) {
      for (const key of Object.keys(entry.payload)) {
        expect(["text", "message", "content", "excerpt", "body"]).not.toContain(key);
      }
    }
  });
});
