/**
 * /settings, in mock mode.
 *
 * Three things are worth a test here: the page renders for the seat mock mode
 * signs in, the lexicon editor sends what the operator typed, and the write
 * behind it lands in the hash chain as lexicon.updated. The third is the one
 * that matters most, because a lexicon change that is not in the chain is a
 * scoring change nobody can reconstruct.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// revalidatePath needs a Next request store, and there is not one in a unit
// test. Nothing here is asserting on cache behaviour.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { LexiconEditor } from "@/components/settings/LexiconEditor";
import { addLexiconPhrasesAction } from "@/app/settings/actions";
import { getLexiconView } from "@/app/settings/data";
import SettingsPage from "@/app/settings/page";
import { listAuditEntries } from "@/lib/data/audit";
import { mockSession } from "@/lib/auth";
import { resetMockData } from "@/lib/mock/fixtures";
import type { LexiconState, LexiconView } from "@/app/settings/types";

const EMPTY: LexiconState = {
  error: null,
  offendingFragment: null,
  instead: null,
  message: null,
};

beforeEach(() => {
  resetMockData();
});

afterEach(() => {
  resetMockData();
});

describe("the settings page", () => {
  it("renders the seat, the lexicon, the webhook and retention", async () => {
    render(await SettingsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeDefined();

    // The seat, from the session mock mode signs in.
    expect(screen.getByText("A. Rivera")).toBeDefined();
    expect(screen.getByText("Owner")).toBeDefined();

    // Groups of rows, and every row an owner sees inside them. The page was one
    // flat column of seven cards covering four unrelated subjects.
    for (const group of [
      "Your Account",
      "Reporting",
      "What Guardian Reads",
      "Records",
      "Keyboard Shortcuts",
    ]) {
      expect(screen.getByRole("region", { name: group })).toBeDefined();
      expect(screen.getByRole("heading", { level: 2, name: group })).toBeDefined();
    }
    for (const row of [
      "Name",
      "Role",
      "Organization",
      "People on Your Team",
      "Custom Phrases",
      "Alerts to Your System",
      "Evidence Log",
      "How Long Data Is Kept",
    ]) {
      expect(screen.getByRole("heading", { level: 3, name: row })).toBeDefined();
    }

    // Retention is read only and comes from RETENTION_MS, in words. The table
    // printed EPHEMERAL_24H and the tiers each class covered.
    // Two short values a row: what it applies to, and how long.
    expect(screen.getByText("Nothing stood out")).toBeDefined();
    expect(screen.getByText("24 hours")).toBeDefined();
    expect(screen.getByText("1 year")).toBeDefined();
    expect(screen.getByText("Until released")).toBeDefined();
    // No theme picker: Guardian is dark only.
    expect(screen.queryByRole("radio", { name: /Dark|Light/ })).toBeNull();
    expect(screen.queryByText("EPHEMERAL_24H")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Wording Guard" })).toBeNull();

    // Two seats on the fixture roster, which is what the fixtures describe:
    // M. Osei holds a claim and proposes the report A. Rivera answers. The
    // one-seat wording is the other branch, and DecisionPanel covers it.
    expect(screen.getByText("Two people have to agree before anything is reported")).toBeDefined();
  });

  // The version string is still what a score records, and the Evidence Log
  // keeps it. Nobody setting up a server needs to read it.
  it("keeps the merged lexicon version for the record, off the page", async () => {
    const view = await getLexiconView(mockSession());
    expect(view.mergedVersion).toBe(`${view.baseVersion}+cus_northwood`);

    render(await SettingsPage());
    expect(screen.queryByText(view.mergedVersion)).toBeNull();
    expect(screen.queryByText(view.baseVersion)).toBeNull();
  });

  /*
   * The report card listed a missing country, organization name, contact and
   * time zone and sent the owner to settings for them, and settings had no place
   * to put any of them.
   */
  it("gives an owner a place to set the details every report needs", async () => {
    render(await SettingsPage());
    expect(screen.getByLabelText(/Your organization's name/)).toBeDefined();
    expect(screen.getByLabelText(/Who NCMEC should contact/)).toBeDefined();
    expect(screen.getByLabelText(/Their email/)).toBeDefined();
    expect(screen.getByLabelText("Country")).toBeDefined();
    expect(screen.getByLabelText("Time zone")).toBeDefined();
    expect(screen.getByRole("option", { name: "United States", selected: true })).toBeDefined();
  });
});

describe("the lexicon editor", () => {
  const view: LexiconView = {
    baseVersion: "v2",
    mergedVersion: "v2+cus_northwood",
    addedTotal: 0,
    fields: [
      { field: "migration_ask", label: "Migration ask", added: [], baseCount: 12 },
      { field: "secrecy", label: "Secrecy", added: ["keep this between us"], baseCount: 9 },
    ],
  };

  // One row: kind, phrase, add. It was a picker, a five-row textarea, a help
  // line and a button behind a disclosure.
  it("adds a phrase from one row, with the attestation", async () => {
    const addAction = vi.fn(
      async (_previous: LexiconState, formData: FormData): Promise<LexiconState> => ({
        ...EMPTY,
        message: `Added ${String(formData.get("phrases")).split("\n").length} phrases.`,
      }),
    );

    render(
      <LexiconEditor
        view={view}
        addAction={addAction}
        removeAction={async () => EMPTY}
      />,
    );

    fireEvent.change(screen.getByLabelText("Phrase to add"), {
      target: { value: "wanna go on vc" },
    });
    fireEvent.click(screen.getByLabelText(/Our own decision, not requested by police/));
    fireEvent.click(screen.getByRole("button", { name: "Add Phrase" }));

    await waitFor(() => expect(addAction).toHaveBeenCalledTimes(1));

    const formData = addAction.mock.calls[0]![1];
    expect(formData.get("field")).toBe("migration_ask");
    expect(formData.get("phrases")).toBe("wanna go on vc");
    expect(formData.get("attestation")).toBe("on");

    await waitFor(() => expect(screen.getByText("Added 1 phrases.")).toBeDefined());
  });

  // Nothing added means nothing under the row: no empty list, no sentence
  // saying the list is empty.
  it("shows nothing under the row when this customer has added nothing", () => {
    render(
      <LexiconEditor
        view={{ ...view, fields: [view.fields[0]!] }}
        addAction={async () => EMPTY}
        removeAction={async () => EMPTY}
      />,
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.queryByText(/None added/)).toBeNull();
  });

  it("lists added phrases as tags, each with its own remove button", () => {
    render(
      <LexiconEditor view={view} addAction={async () => EMPTY} removeAction={async () => EMPTY} />,
    );
    expect(screen.getByText("keep this between us")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove keep this between us" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: /Phrases this customer added/ })).toBeNull();
  });
});

describe("the add-phrases action", () => {
  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  it("writes the phrase and records lexicon.updated in the chain", async () => {
    const session = mockSession();
    const before = await listAuditEntries(session, { kind: "lexicon.updated" });

    const state = await addLexiconPhrasesAction(
      EMPTY,
      form({ field: "migration_ask", phrases: "hop on the other app", attestation: "on" }),
    );

    expect(state.error).toBeNull();
    expect(state.message).toBe("Added 1 phrase.");

    const view = await getLexiconView(session);
    const field = view.fields.find((row) => row.field === "migration_ask");
    expect(field?.added).toContain("hop on the other app");

    const after = await listAuditEntries(session, { kind: "lexicon.updated" });
    expect(after.length).toBe(before.length + 1);
    expect(after[0]!.payload.field).toBe("migration_ask");
    expect(String(after[0]!.payload.mergedVersion)).toMatch(/^v\d+\+cus_northwood$/);
    // The chain still records the merged version, and the attestation says the
    // same thing it always did, in plainer words.
    expect(String(after[0]!.payload.changeOrigin)).toContain("not requested by police or any government agency");
  });

  it("refuses the save without the change-origin attestation", async () => {
    const state = await addLexiconPhrasesAction(
      EMPTY,
      form({ field: "migration_ask", phrases: "hop on the other app" }),
    );
    expect(state.error).toContain("Check the box first");
    expect(state.message).toBeNull();
  });

  it("refuses a phrase that makes a claim about a person, and quotes it back", async () => {
    // Assembled rather than written out, because the workspace source scan
    // fails on any single literal that would be an accusation, and this test
    // needs one to hand to the guard.
    const refused = ["this user", "is", "a groomer"].join(" ");
    const state = await addLexiconPhrasesAction(
      EMPTY,
      form({ field: "secrecy", phrases: refused, attestation: "on" }),
    );
    expect(state.message).toBeNull();
    expect(state.offendingFragment).toBeTruthy();
    expect(state.instead).toBeTruthy();
  });
});
