import { describe, expect, it } from "vitest";
import {
  AuditLog,
  EXPORT_FORMAT,
  MemoryAuditStore,
  artifactDigest,
  exportAuditPayload,
  exportChain,
  isWithheld,
  verifyExport,
  type ExportArtifact,
  type ExportedEntry,
} from "../src/index.js";

const SECRET = "regulator-export-secret";

/**
 * A chain with two customers interleaved, which is the shape that makes the
 * scoping question real. cus_1 gets the odd seqs, cus_2 the even ones.
 */
async function seedTwoCustomers(pairs: number) {
  const store = new MemoryAuditStore();
  const log = new AuditLog(store, SECRET);
  for (let i = 0; i < pairs; i++) {
    await log.append({
      kind: "score.assigned",
      customerId: "cus_1",
      payload: {
        actorUid: `a${i}`,
        targetUid: `t${i}`,
        tier: "T1",
        versions: { modelVersion: "m-1", lexiconVersion: "v2", fusionVersion: "rules-v2" },
      },
      ts: new Date(1_800_000_000_000 + i * 2000),
    });
    await log.append({
      kind: "score.assigned",
      customerId: "cus_2",
      payload: {
        actorUid: `b${i}`,
        targetUid: `u${i}`,
        tier: "T2",
        versions: { modelVersion: "m-1", lexiconVersion: "v2", fusionVersion: "rules-v2" },
      },
      ts: new Date(1_800_000_000_000 + i * 2000 + 1000),
    });
  }
  return { store, log };
}

async function seedOneCustomer(n: number) {
  const store = new MemoryAuditStore();
  const log = new AuditLog(store, SECRET);
  for (let i = 0; i < n; i++) {
    await log.append({
      kind: "score.assigned",
      customerId: "cus_1",
      payload: {
        actorUid: `a${i}`,
        targetUid: `t${i}`,
        tier: "T1",
        versions: {
          modelVersion: i < 3 ? "m-1" : "m-2",
          lexiconVersion: "v2",
          fusionVersion: "rules-v2",
        },
      },
      ts: new Date(1_800_000_000_000 + i * 1000),
    });
  }
  return { store, log };
}

/** A regulator reads a file, not an object graph. */
function overTheWire(artifact: ExportArtifact): ExportArtifact {
  return JSON.parse(JSON.stringify(artifact)) as ExportArtifact;
}

function included(artifact: ExportArtifact): ExportedEntry[] {
  return artifact.entries.filter((row): row is ExportedEntry => !isWithheld(row));
}

describe("export header", () => {
  it("round trips a scoped range and describes what it is", async () => {
    const { store, log } = await seedOneCustomer(6);
    const head = await log.head();

    const artifact = await exportChain(store, {
      customerId: "cus_1",
      keyCustodian: "Counsel of record, named in the processor agreement",
      purpose: "Independent assessment of safety measure effectiveness",
      exportedAt: new Date("2026-09-04T10:00:00Z"),
    });

    expect(artifact.header.formatVersion).toBe(EXPORT_FORMAT);
    expect(artifact.header.exportId).toMatch(/^[a-f0-9]{32}$/);
    expect(artifact.header.exportedAt).toBe("2026-09-04T10:00:00.000Z");
    expect(artifact.header.scope.customerId).toBe("cus_1");
    expect(artifact.header.scope.crossCustomer).toBe(false);
    expect(artifact.header.range.fromSeq).toBe(1);
    expect(artifact.header.range.toSeq).toBe(6);
    expect(artifact.header.range.entryCount).toBe(6);
    expect(artifact.header.range.withheldCount).toBe(0);
    expect(artifact.header.range.anchorHash).toBe("0".repeat(64));
    expect(artifact.header.chainHeadAtExport).toEqual({ seq: head.seq, hash: head.hash });
    expect(artifact.header.range.lastEntryHash).toBe(head.hash);
    expect(artifact.entries).toHaveLength(6);
    expect(included(artifact)[0]!.payload["actorUid"]).toBe("a0");
  });

  it("carries the version triples in force over the range", async () => {
    const { store } = await seedOneCustomer(6);
    const artifact = await exportChain(store, { customerId: "cus_1" });

    expect(artifact.header.versions).toHaveLength(2);
    expect(artifact.header.versions[0]).toMatchObject({
      modelVersion: "m-1",
      lexiconVersion: "v2",
      fusionVersion: "rules-v2",
      entryCount: 3,
      firstSeq: 1,
      lastSeq: 3,
    });
    expect(artifact.header.versions[1]).toMatchObject({
      modelVersion: "m-2",
      entryCount: 3,
      firstSeq: 4,
      lastSeq: 6,
    });
  });

  it("states the algorithm in enough detail to recompute without Guardian's code", async () => {
    const { store } = await seedOneCustomer(2);
    const artifact = await exportChain(store, { customerId: "cus_1" });
    const algorithm = artifact.header.algorithm;

    expect(algorithm.digest).toBe("HMAC-SHA256");
    expect(algorithm.outputEncoding).toBe("hex");
    expect(algorithm.genesisHash).toBe("0".repeat(64));
    expect(algorithm.preimageFieldOrder).toEqual([
      "customerId",
      "kind",
      "payload",
      "prevHash",
      "seq",
      "ts",
    ]);
    expect(algorithm.canonicalization.length).toBeGreaterThan(3);
    expect(algorithm.preimageTemplate).toContain("prevHash");

    // The key is what a verifier has to be given, and the export says so
    // instead of shipping it.
    expect(artifact.verification.key.included).toBe(false);
    expect(artifact.verification.key.whatTheVerifierNeeds).toBeTruthy();
    expect(artifact.verification.key.delivery).toContain("out of band");
    expect(JSON.stringify(artifact)).not.toContain(SECRET);
  });

  it("does not alias the rows the store still holds", async () => {
    const { store } = await seedOneCustomer(3);
    const artifact = await exportChain(store, { customerId: "cus_1" });
    store.tamper(2, (e) => {
      e.payload = { actorUid: "rewritten" };
    });
    expect(included(artifact)[1]!.payload["actorUid"]).toBe("a1");
  });
});

describe("offline verification", () => {
  it("verifies an artifact with the artifact and the key alone", async () => {
    const { store } = await seedOneCustomer(8);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("full");
    expect(result.checked).toBe(8);
    expect(result.recomputed).toBe(8);
    expect(result.linkOnly).toBe(0);
  });

  it("verifies a mid chain range without the history before it", async () => {
    const { store } = await seedOneCustomer(10);
    const artifact = overTheWire(
      await exportChain(store, { customerId: "cus_1", fromSeq: 4, toSeq: 7 }),
    );

    expect(artifact.header.range.fromSeq).toBe(4);
    expect(artifact.header.range.toSeq).toBe(7);
    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(true);
    expect(result.ok && result.recomputed).toBe(4);
  });

  it("fails on the wrong key rather than passing quietly", async () => {
    const { store } = await seedOneCustomer(4);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));

    const result = verifyExport(artifact, "not-the-chain-key");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hash_mismatch");
    expect(result.brokenAt).toBe(1);
  });
});

describe("tampering", () => {
  it("names the row when a payload is edited in the artifact", async () => {
    const { store } = await seedOneCustomer(10);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));

    const target = artifact.entries[5] as ExportedEntry;
    target.payload = { ...target.payload, tier: "T0" };

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hash_mismatch");
    expect(result.brokenAt).toBe(6);
    expect(result.detail).toContain("6");
  });

  it("names the row when a payload field is dropped without declaring it", async () => {
    const { store } = await seedOneCustomer(6);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));

    const target = artifact.entries[2] as ExportedEntry;
    const stripped = { ...target.payload };
    delete stripped["actorUid"];
    target.payload = stripped;

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hash_mismatch");
    expect(result.brokenAt).toBe(3);
  });

  it("catches a row lifted out of the middle of the range", async () => {
    const { store } = await seedOneCustomer(6);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));

    artifact.entries.splice(3, 1);
    artifact.verification.expected.splice(3, 1);
    artifact.header.range.entryCount = artifact.entries.length;

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("sequence_gap");
    expect(result.brokenAt).toBe(5);
  });

  it("catches a row dropped from the entries but left in the manifest", async () => {
    const { store } = await seedOneCustomer(6);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));

    artifact.entries.splice(2, 1);
    artifact.header.range.entryCount = artifact.entries.length;

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("manifest_mismatch");
    expect(result.brokenAt).toBe(3);
  });

  it("catches a re-hashed row, since the key is not in the export", async () => {
    const { store } = await seedOneCustomer(5);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));

    const target = artifact.entries[1] as ExportedEntry;
    target.payload = { actorUid: "rewritten" };
    target.hash = "f".repeat(64);
    artifact.verification.expected[1]!.hash = "f".repeat(64);

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.brokenAt).toBe(2);
  });

  it("catches a header that names a head the entries do not reach", async () => {
    const { store } = await seedOneCustomer(4);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));
    artifact.header.range.lastEntryHash = "a".repeat(64);

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("range_mismatch");
  });
});

describe("customer scope", () => {
  it("refuses an unscoped export without the explicit flag", async () => {
    const { store } = await seedTwoCustomers(3);
    await expect(exportChain(store, {})).rejects.toThrow(/crossCustomer/);
    await expect(exportChain(store, { crossCustomer: false })).rejects.toThrow(/rule 8/);
  });

  it("refuses a customer scope and a cross customer flag together", async () => {
    const { store } = await seedTwoCustomers(2);
    await expect(
      exportChain(store, { customerId: "cus_1", crossCustomer: true }),
    ).rejects.toThrow(/One scope per export/);
  });

  it("withholds the other customer's rows rather than dropping them", async () => {
    const { store } = await seedTwoCustomers(4);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));

    expect(artifact.header.range.entryCount).toBe(8);
    expect(artifact.header.range.includedCount).toBe(4);
    expect(artifact.header.range.withheldCount).toBe(4);

    const withheld = artifact.entries.filter(isWithheld);
    expect(withheld).toHaveLength(4);
    for (const row of withheld) {
      expect(row.withheld).toBe("other_customer");
      expect(Object.keys(row).sort()).toEqual(["hash", "prevHash", "seq", "withheld"]);
    }
    // No other customer's identity and no other customer's payload travels.
    expect(JSON.stringify(artifact.entries)).not.toContain("cus_2");
    expect(JSON.stringify(artifact.entries)).not.toContain("targetUid\":\"u0");

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("structural");
    expect(result.recomputed).toBe(4);
    expect(result.withheldEntries).toBe(4);
  });

  it("exports across customers when the caller says so", async () => {
    const { store } = await seedTwoCustomers(3);
    const artifact = overTheWire(await exportChain(store, { crossCustomer: true }));

    expect(artifact.header.scope.customerId).toBeNull();
    expect(artifact.header.scope.crossCustomer).toBe(true);
    expect(artifact.header.range.withheldCount).toBe(0);

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(true);
    expect(result.ok && result.mode).toBe("full");
  });

  it("names the row when a foreign customer is spliced into a scoped export", async () => {
    const { store } = await seedTwoCustomers(2);
    const artifact = overTheWire(await exportChain(store, { crossCustomer: true }));
    artifact.header.scope.customerId = "cus_1";

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("scope_mismatch");
    expect(result.brokenAt).toBe(2);
    expect(result.detail).toContain("cus_2");
  });
});

describe("redaction", () => {
  it("verifies structurally and declares what was removed", async () => {
    const { store } = await seedOneCustomer(5);
    const artifact = overTheWire(
      await exportChain(store, {
        customerId: "cus_1",
        redactPayloadKeys: ["actorUid", "targetUid"],
      }),
    );

    expect(artifact.header.redaction.applied).toBe(true);
    expect(artifact.header.redaction.keys).toEqual(["actorUid", "targetUid"]);
    expect(artifact.header.redaction.entryCount).toBe(5);
    expect(artifact.header.redaction.pathCount).toBe(10);

    for (const row of included(artifact)) {
      expect(row.redactedPaths).toEqual(["actorUid", "targetUid"]);
      expect(row.payload["actorUid"]).toBeUndefined();
      // The reader still sees that a score happened, and at what tier, on
      // which versions.
      expect(row.payload["tier"]).toBe("T1");
      expect(row.payload["versions"]).toBeTruthy();
    }
    expect(JSON.stringify(artifact.entries)).not.toContain("a0");

    // Every row is link_only, so the chain key was never used. That is not a
    // pass: it refuses unless the caller asks for a positional check.
    const refused = verifyExport(artifact, SECRET);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("nothing_recomputed");

    const result = verifyExport(artifact, SECRET, { allowStructural: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("structural");
    expect(result.recomputed).toBe(0);
    expect(result.linkOnly).toBe(5);
    expect(result.redactedEntries).toBe(5);
  });

  /**
   * The reason the default had to change. With every row link_only nothing
   * touches the key, so a rewritten row, its rewritten hash, the next row's
   * prevHash and the manifest are all values the forger holds both sides of.
   * The old default returned the same ok:true for the right key, the wrong key
   * and an empty string, and a verifier checking result.ok would have accepted
   * a fabricated reviewer decision, which under rule 6 is the one field only a
   * human may set.
   */
  it("refuses a fully redacted artifact identically whatever key it is handed", async () => {
    const { store } = await seedOneCustomer(3);
    const artifact = overTheWire(
      await exportChain(store, { customerId: "cus_1", redactPayloadKeys: ["actorUid"] }),
    );

    // Rewrite a row and relink around it, the way a forger would.
    const forged = artifact.entries[1]!;
    forged.payload["tier"] = "T3";
    forged.hash = "b".repeat(64);
    artifact.entries[2]!.prevHash = forged.hash;
    artifact.verification.expected[1]!.hash = forged.hash;

    for (const key of [SECRET, "the-wrong-key", ""]) {
      const result = verifyExport(artifact, key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("nothing_recomputed");
    }
  });

  /**
   * The refusal keys on nothing being recomputed, not on the mode. An ordinary
   * scoped export is already partly structural because another customer's rows
   * are withheld, and it still proves what it carries.
   */
  it("still passes a scoped export where only some rows are link_only", async () => {
    const { store } = await seedTwoCustomers(3);
    const artifact = await exportChain(store, { customerId: "cus_1" });

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("structural");
    expect(result.recomputed).toBeGreaterThan(0);
    expect(result.withheldEntries).toBeGreaterThan(0);
  });

  it("keeps the version triple in the header even when the payload key is redacted", async () => {
    const { store } = await seedOneCustomer(4);
    const artifact = await exportChain(store, {
      customerId: "cus_1",
      redactPayloadKeys: ["versions"],
    });

    expect(included(artifact)[0]!.payload["versions"]).toBeUndefined();
    expect(artifact.header.versions.length).toBeGreaterThan(0);
    expect(artifact.header.versions[0]!.fusionVersion).toBe("rules-v2");
  });

  it("removes a key at any depth and records the path", async () => {
    const { store } = await seedOneCustomer(2);
    const artifact = await exportChain(store, {
      customerId: "cus_1",
      redactPayloadKeys: ["modelVersion"],
    });

    const row = included(artifact)[0]!;
    expect(row.redactedPaths).toEqual(["versions.modelVersion"]);
    const versions = row.payload["versions"] as Record<string, unknown>;
    expect(versions["modelVersion"]).toBeUndefined();
    expect(versions["fusionVersion"]).toBe("rules-v2");
  });

  it("rejects a redaction the header does not declare", async () => {
    const { store } = await seedOneCustomer(3);
    const artifact = overTheWire(
      await exportChain(store, { customerId: "cus_1", redactPayloadKeys: ["actorUid"] }),
    );

    // A row claims a redaction that the header never announced, which is what
    // a quietly short export looks like.
    const target = artifact.entries[1] as ExportedEntry;
    target.redactedPaths = ["actorUid", "tier"];
    const stripped = { ...target.payload };
    delete stripped["tier"];
    target.payload = stripped;

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("redaction_undeclared");
    expect(result.brokenAt).toBe(2);
    expect(result.detail).toContain("tier");
  });

  it("leaves an unredacted export fully recomputable", async () => {
    const { store } = await seedOneCustomer(3);
    const artifact = await exportChain(store, { customerId: "cus_1" });
    expect(artifact.header.redaction.applied).toBe(false);
    expect(artifact.header.redaction.entryCount).toBe(0);
    expect(verifyExport(artifact, SECRET).ok).toBe(true);
  });
});

describe("the export as a recorded act", () => {
  it("has a stable digest and an audit manifest that carries no payload content", async () => {
    const { store } = await seedOneCustomer(4);
    const opts = { customerId: "cus_1", exportedAt: new Date("2026-09-04T10:00:00Z") };

    const first = await exportChain(store, opts);
    const second = await exportChain(store, opts);
    expect(first.header.exportId).toBe(second.header.exportId);
    expect(artifactDigest(first)).toBe(artifactDigest(second));

    const payload = exportAuditPayload(first);
    expect(payload["exportId"]).toBe(first.header.exportId);
    expect(payload["artifactDigest"]).toBe(artifactDigest(first));
    expect(payload["scopeCustomerId"]).toBe("cus_1");
    expect(payload["fromSeq"]).toBe(1);
    expect(payload["toSeq"]).toBe(4);
    expect(JSON.stringify(payload)).not.toContain("actorUid");
  });

  it("appends cleanly under bundle.exported without disturbing the range it describes", async () => {
    const { store, log } = await seedOneCustomer(4);
    const artifact = await exportChain(store, { customerId: "cus_1" });

    await log.append({
      kind: "bundle.exported",
      customerId: "cus_1",
      payload: exportAuditPayload(artifact),
    });

    expect(verifyExport(artifact, SECRET).ok).toBe(true);
    const chain = await log.verify();
    expect(chain.ok).toBe(true);
  });
});

describe("edges", () => {
  it("produces an empty artifact for an empty chain rather than throwing", async () => {
    const store = new MemoryAuditStore();
    const artifact = await exportChain(store, { customerId: "cus_1" });

    expect(artifact.entries).toHaveLength(0);
    expect(artifact.header.range.entryCount).toBe(0);
    expect(artifact.header.range.lastEntryHash).toBe("0".repeat(64));
    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(true);
    expect(result.ok && result.checked).toBe(0);
  });

  it("refuses a backwards range", async () => {
    const { store } = await seedOneCustomer(4);
    await expect(
      exportChain(store, { customerId: "cus_1", fromSeq: 4, toSeq: 2 }),
    ).rejects.toThrow(/range is empty/);
    await expect(exportChain(store, { customerId: "cus_1", fromSeq: 0 })).rejects.toThrow(
      /1 or greater/,
    );
  });

  it("clamps a range that runs past the head", async () => {
    const { store } = await seedOneCustomer(3);
    const artifact = await exportChain(store, { customerId: "cus_1", toSeq: 99 });
    expect(artifact.header.range.requestedTo).toBe(99);
    expect(artifact.header.range.toSeq).toBe(3);
    expect(verifyExport(artifact, SECRET).ok).toBe(true);
  });

  it("rejects an artifact in a format it does not know", async () => {
    const { store } = await seedOneCustomer(2);
    const artifact = overTheWire(await exportChain(store, { customerId: "cus_1" }));
    artifact.header.formatVersion = "guardian.audit.export/99";

    const result = verifyExport(artifact, SECRET);
    expect(result.ok).toBe(false);
    expect(result.ok || result.reason).toBe("format_unsupported");
  });
});
