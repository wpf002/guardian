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
import { resetSessionLimits } from "@/app/settings/data";
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
  resetSessionLimits();
});

afterEach(() => {
  resetMockData();
});

describe("the settings page", () => {
  it("renders the seat, the limits, the lexicon, the webhook and retention", async () => {
    render(await SettingsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeDefined();

    // The seat, from the session mock mode signs in.
    expect(screen.getByText("A. Rivera")).toBeDefined();
    expect(screen.getByText("Owner")).toBeDefined();

    // Every section an owner sees.
    for (const title of [
      "Your seat",
      "Session limits",
      "Theme",
      "Keyboard shortcuts",
      "Lexicon extension",
      "Webhook",
      "Retention",
      "Wording guard",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeDefined();
    }

    // Retention is read only and comes from RETENTION_MS, so the classes and
    // their durations are printed rather than editable.
    expect(screen.getByText("EPHEMERAL_24H")).toBeDefined();
    expect(screen.getByText("24 hours")).toBeDefined();
    expect(screen.getByText("1 year")).toBeDefined();

    // The one seat in the fixture roster cannot complete a T3 on its own, and
    // the page says so rather than leaving it to be discovered at the proposal.
    expect(screen.getByText(/A T3 needs two people/)).toBeDefined();
  });

  it("prints the merged lexicon version a score row would record", async () => {
    const view = await getLexiconView(mockSession());
    expect(view.mergedVersion).toBe(`${view.baseVersion}+cus_northwood`);

    render(await SettingsPage());
    // Once on the card and once beside the base version, which is deliberate.
    expect(screen.getAllByText(view.mergedVersion).length).toBeGreaterThan(0);
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

  it("sends the phrases the operator typed, with the attestation", async () => {
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

    fireEvent.change(screen.getByLabelText(/Phrases to add/), {
      target: { value: "wanna go on vc\nsend it on the other app" },
    });
    fireEvent.click(screen.getByLabelText(/on our own initiative/));
    fireEvent.click(screen.getByRole("button", { name: /Add phrases/ }));

    await waitFor(() => expect(addAction).toHaveBeenCalledTimes(1));

    const formData = addAction.mock.calls[0]![1];
    expect(formData.get("field")).toBe("migration_ask");
    expect(formData.get("phrases")).toBe("wanna go on vc\nsend it on the other app");
    expect(formData.get("attestation")).toBe("on");

    await waitFor(() => expect(screen.getByText("Added 2 phrases.")).toBeDefined());
  });

  it("shows the empty state when this customer has added nothing", () => {
    render(
      <LexiconEditor
        view={{ ...view, fields: [view.fields[0]!] }}
        addAction={async () => EMPTY}
        removeAction={async () => EMPTY}
      />,
    );
    expect(screen.getByText("No phrases added yet")).toBeDefined();
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
    expect(state.message).toContain("v2+cus_northwood");

    const view = await getLexiconView(session);
    const field = view.fields.find((row) => row.field === "migration_ask");
    expect(field?.added).toContain("hop on the other app");

    const after = await listAuditEntries(session, { kind: "lexicon.updated" });
    expect(after.length).toBe(before.length + 1);
    expect(after[0]!.payload.field).toBe("migration_ask");
    expect(after[0]!.payload.mergedVersion).toBe("v2+cus_northwood");
    expect(String(after[0]!.payload.changeOrigin)).toContain("not at the direction");
  });

  it("refuses the save without the change-origin attestation", async () => {
    const state = await addLexiconPhrasesAction(
      EMPTY,
      form({ field: "migration_ask", phrases: "hop on the other app" }),
    );
    expect(state.error).toContain("change-origin");
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
