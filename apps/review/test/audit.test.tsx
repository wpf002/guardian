import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditPage from "@/app/audit/page";
import { exportRangeAction, verifyRangeAction } from "@/app/audit/actions";
import { ChainTools } from "@/components/audit";
import type { ExportOutcome, VerifyOutcome } from "@/components/audit";
import { resetMockData } from "@/lib/mock/fixtures";
import { AUDIT_KINDS } from "@guardian/audit";

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

    expect(screen.getByRole("heading", { name: "Evidence Log", level: 1 })).toBeTruthy();
    expect(screen.getByText(/Northwood Gaming/)).toBeTruthy();
    /*
     * No sequence number and no hash anywhere on the list.
     *
     * "#40" sat in display type over the words "Records Written", which is a
     * sequence number wearing a statistic's clothes, and the check panel
     * printed a truncated hash in its corner. Both are on the entry page, for
     * the reader who went looking.
     */
    expect(screen.queryByText("#40")).toBeNull();
    expect(screen.queryByText("Records Written")).toBeNull();
    expect(screen.queryByText(/ab870f45b16b/)).toBeNull();
    expect(screen.queryByRole("region", { name: "How much is recorded" })).toBeNull();

    // The row itself is the link. A "Details" column was one word repeated
    // twenty-five times, standing in for the thing already under the cursor.
    expect(screen.queryAllByRole("link", { name: "Details" })).toHaveLength(0);
    const log = within(screen.getByRole("region", { name: /Everything recorded/ }));
    const rows = log.getAllByRole("listitem");
    expect(within(rows[0]!).getByRole("link").getAttribute("href")).toBe("/audit/40");

    // The payload dump is gone from the list. It printed pairId and
    // lexiconVersion beside a note on every row, which is a debugging view of
    // a page an operator hands to a lawyer. The entry page still shows it all.
    expect(screen.queryByText("pairId")).toBeNull();
    expect(screen.queryByText("lexiconVersion")).toBeNull();
    expect(screen.queryByText(/does not carry message text/)).toBeNull();
  });

  /*
   * The list printed event.ingested, event.rejected and report.filed straight
   * to the reader, because the words map had drifted from the chain's own kind
   * list and a loose Record<string, string> accepted the gap in silence. This
   * asserts what a person sees; kinds.test.ts asserts the map itself.
   */
  it("prints no machine name anywhere in the list", async () => {
    const { container } = await renderAuditPage();
    const text = container.textContent ?? "";
    for (const machine of AUDIT_KINDS) {
      expect(text, `${machine} is rendering raw`).not.toContain(machine);
    }
    expect(text).toContain("A message was read");
    expect(text).toContain("A report went to NCMEC");
  });

  // A dated list, not a table. Twenty-five rows repeating the same date in one
  // column and the word "Details" in another is not a comparison.
  it("groups the entries under a day heading and shows the clock on each row", async () => {
    await renderAuditPage();
    const log = within(screen.getByRole("region", { name: /Everything recorded/ }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(log.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
    expect(log.getAllByText(/^\d\d:\d\d UTC$/).length).toBeGreaterThan(1);
    // The full date is not repeated on every row.
    expect(log.queryByText(/10 Sep 2026 20:26 UTC/)).toBeNull();
  });

  // Three rows saying "Guardian scored a conversation" are the same row until
  // something says which conversation.
  it("names the conversation a scored row is about", async () => {
    await renderAuditPage({ kind: "score.assigned" });
    const log = within(screen.getByRole("region", { name: /Guardian scored a conversation/ }));
    expect(log.getAllByText(/^Conversation [0-9a-z]{4}/).length).toBeGreaterThan(0);
  });

  it("filters by kind, and says so in the caption", async () => {
    await renderAuditPage({ kind: "score.assigned" });

    const log = within(screen.getByRole("region", { name: /Guardian scored a conversation/ }));
    // In words. The row named the code that wrote it.
    expect(log.getAllByText("Guardian scored a conversation").length).toBeGreaterThan(0);
    for (const other of [
      "A message was read",
      "The evidence was downloaded",
      "Old data was deleted on schedule",
      "The phrase list changed",
      "An incoming message broke a rule and was dropped",
    ]) {
      expect(log.queryByText(other)).toBeNull();
    }
  });

  it("names the empty state and keeps the way back when a page runs past the chain", async () => {
    await renderAuditPage({ page: "9" });

    expect(screen.getByText("This page is past the end of the chain.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the newest entries" })).toBeTruthy();
  });

  it("verifies the range on the page and names the result", async () => {
    await renderAuditPage();

    expect(
      screen.getByText("Not checked yet."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Check This Page/ }));

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

    fireEvent.click(screen.getByRole("button", { name: /Check This Page/ }));

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

    fireEvent.click(screen.getByRole("button", { name: /Download for Counsel/ }));

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

    fireEvent.change(screen.getByLabelText("Last record"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Check This Page/ }));

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

    const button = screen.getByRole("button", { name: /Download for Counsel/ });
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
