import { describe, expect, it } from "vitest";
import {
  preserveUntil,
  ratchetForPreservation,
  recordSubmission,
  type PreservationClient,
  type PreservationTx,
} from "../src/preservation.js";

const SUBMITTED = new Date("2026-09-04T10:00:00Z");
const UNTIL = preserveUntil(SUBMITTED);

/**
 * A twin of the two delegates, with a flag that says whether the callback ran
 * inside a transaction. The point of the test is that both rows move together,
 * so a fake that applies writes outside one would prove nothing.
 */
function fakeClient(bundle: { retention?: string | null; expiresAt?: Date | null } | null) {
  const writes: Array<{ table: string; data: Record<string, unknown> }> = [];
  let committed = false;
  const tx: PreservationTx = {
    cyberTiplineReport: {
      async update(args) {
        writes.push({ table: "report", data: args.data });
        return undefined;
      },
    },
    evidenceBundle: {
      async findUnique() {
        return bundle;
      },
      async update(args) {
        writes.push({ table: "bundle", data: args.data });
        return undefined;
      },
    },
  };
  const client: PreservationClient = {
    async $transaction(fn) {
      const out = await fn(tx);
      committed = true;
      return out;
    },
  };
  return { client, writes, committed: () => committed };
}

const record = {
  bundleId: "bdl_1",
  customerId: "cus_1",
  ncmecReportId: "ncmec-42",
  submittedAt: SUBMITTED,
  preserveUntil: UNTIL,
};

describe("recordSubmission", () => {
  it("writes the report and ratchets the bundle in one transaction", async () => {
    const { client, writes, committed } = fakeClient({ retention: "WATCH_30D", expiresAt: null });
    await recordSubmission(client, record);

    expect(committed()).toBe(true);
    expect(writes.map((w) => w.table)).toEqual(["report", "bundle"]);
    expect(writes[0]!.data).toMatchObject({
      ncmecReportId: "ncmec-42",
      status: "submitted",
      submittedAt: SUBMITTED,
      preserveUntil: UNTIL,
      retention: "CASE_1Y",
    });
    expect(writes[1]!.data).toEqual({ retention: "CASE_1Y", expiresAt: UNTIL });
  });

  it("refuses a preservation date that is not after the submission", async () => {
    const { client } = fakeClient({ retention: "WATCH_30D" });
    await expect(
      recordSubmission(client, { ...record, preserveUntil: SUBMITTED }),
    ).rejects.toThrow(/must be after submittedAt/);
  });

  it("refuses when the bundle the report names is not there", async () => {
    const { client } = fakeClient(null);
    await expect(recordSubmission(client, record)).rejects.toThrow(/no evidence bundle bdl_1/);
  });
});

describe("ratchetForPreservation", () => {
  it("raises a watch bundle to a one year case", () => {
    expect(ratchetForPreservation({ retention: "WATCH_30D", expiresAt: null }, UNTIL)).toEqual({
      retention: "CASE_1Y",
      expiresAt: UNTIL,
    });
  });

  /**
   * The ratchet is a floor. A second report on the same bundle, or a bundle
   * already held further out, must not have its expiry pulled in.
   */
  it("keeps an expiry that is already further out", () => {
    const later = new Date("2030-01-01T00:00:00Z");
    expect(ratchetForPreservation({ retention: "CASE_1Y", expiresAt: later }, UNTIL)).toEqual({
      retention: "CASE_1Y",
      expiresAt: later,
    });
  });

  it("leaves a legal hold alone and does not give it an expiry", () => {
    expect(ratchetForPreservation({ retention: "LEGAL_HOLD", expiresAt: null }, UNTIL)).toEqual({
      retention: "LEGAL_HOLD",
      expiresAt: null,
    });
  });
});
