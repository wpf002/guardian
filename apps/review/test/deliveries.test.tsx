import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isAccusatory } from "@guardian/schema";
import { ChainExportPanel } from "@/components/dashboard";
import { deadLetterReason, hostOf, type DeadLetterRow } from "@/lib/data/deliveries";

function row(overrides: Partial<DeadLetterRow> = {}): DeadLetterRow {
  return {
    id: "wd_1",
    kind: "tier.assigned",
    host: "customer.example",
    tier: "T2",
    attempt: 8,
    lastError: "http_500",
    lastStatusCode: 500,
    createdAt: new Date("2026-09-04T10:00:00Z"),
    updatedAt: new Date("2026-09-04T12:00:00Z"),
    ...overrides,
  };
}

/**
 * The dead-letter view lists a host and never a path or a query. An endpoint
 * url can carry a token in its query string, and this list is read by more
 * people than the settings page that set it.
 */
describe("hostOf", () => {
  it("keeps the host and drops the path, the query and the credentials", () => {
    expect(hostOf("https://customer.example/hooks/guardian?token=secret")).toBe("customer.example");
    expect(hostOf("https://customer.example:8443/x")).toBe("customer.example:8443");
  });

  it("says so rather than throwing on something that is not a url", () => {
    expect(hostOf("not a url")).toBe("unparseable endpoint");
  });
});

describe("deadLetterReason", () => {
  it("translates each stored class into the operator's words", () => {
    expect(deadLetterReason(row({ lastError: "target_refused" }))).toMatch(/private range/);
    expect(deadLetterReason(row({ lastError: "redirected" }))).toMatch(/never followed/);
    expect(deadLetterReason(row({ lastError: "missing_webhook_secret" }))).toMatch(/settings/);
  });

  it("falls through to the status code rather than inventing a cause", () => {
    expect(deadLetterReason(row())).toBe("Gave up after 8 attempts. Last response: HTTP 500.");
    expect(deadLetterReason(row({ lastStatusCode: null, lastError: "ECONNRESET" }))).toBe(
      "Gave up after 8 attempts. Last failure: ECONNRESET.",
    );
    expect(deadLetterReason(row({ lastError: null }))).toMatch(/no error recorded/);
  });

  it("says nothing about a person in any branch", () => {
    for (const error of ["target_refused", "redirected", "missing_webhook_secret", "http_500", null]) {
      expect(isAccusatory(deadLetterReason(row({ lastError: error })))).toBe(false);
    }
  });
});

describe("the chain export panel", () => {
  it("produces an artifact and saves it under the name the action chose", async () => {
    const saved: Array<{ filename: string; contents: string }> = [];
    const action = vi.fn(async (purpose?: string) => ({
      ok: true,
      artifact: JSON.stringify({ purpose: purpose ?? null }),
      filename: "guardian-audit-cus_1-20260904T100000.json",
      headline: "12 entries, sequence 1 to 12.",
      detail: "Verify it with the chain key, delivered separately.",
    }));

    render(
      <ChainExportPanel
        exportChain={action}
        save={(filename, contents) => saved.push({ filename, contents })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Why This Export Is Being Produced"), {
      target: { value: "Regulator request 2026-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Produce an Export" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(action).toHaveBeenCalledWith("Regulator request 2026-09");
    expect(saved[0]!.filename).toBe("guardian-audit-cus_1-20260904T100000.json");
    expect(JSON.parse(saved[0]!.contents).purpose).toBe("Regulator request 2026-09");
    expect(screen.getByText("12 entries, sequence 1 to 12.")).toBeTruthy();
  });

  /**
   * A refusal has to read as a refusal. Saving nothing while showing a success
   * line is the failure mode that makes an operator think they have an export.
   */
  it("saves nothing and says why when the export refuses", async () => {
    const saved: string[] = [];
    render(
      <ChainExportPanel
        exportChain={async () => ({
          ok: false,
          artifact: null,
          filename: null,
          headline: "The export could not be produced.",
          detail: "AUDIT_CHAIN_SECRET must be set to a real value",
        })}
        save={(filename) => saved.push(filename)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Produce an Export" }));
    await waitFor(() => {
      expect(screen.getByText("The export could not be produced.")).toBeTruthy();
    });
    expect(saved).toEqual([]);
  });

  it("reports a thrown action rather than leaving the button spinning", async () => {
    render(
      <ChainExportPanel
        exportChain={async () => {
          throw new Error("network");
        }}
        save={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Produce an Export" }));
    await waitFor(() => expect(screen.getByText("The export did not run.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Produce an Export" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
