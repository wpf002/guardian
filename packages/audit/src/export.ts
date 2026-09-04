import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.js";
import {
  GENESIS_HASH,
  entryDigest,
  type AuditEntry,
  type AuditKind,
  type AuditStore,
} from "./chain.js";

/**
 * Regulator and counsel export.
 *
 * Two outside pressures shape this file. Australia's eSafety undertaking of
 * August 2026 requires an independent third party to assess whether safety
 * measures actually work, which is a procurement category that did not exist
 * before (RESEARCH.md 2.7, ROADMAP.md phase 3). And Child Rescue Coalition is
 * the cautionary case in the other direction: prosecutors dropped cases rather
 * than disclose how the method worked (RESEARCH.md 2.3). So the artifact this
 * builds has to be checkable by somebody who has neither Guardian's code nor
 * Guardian's database, and it has to say plainly what it does not contain.
 *
 * The artifact is therefore self describing. It carries the range, the chain
 * head at export, the hashing algorithm and its exact preimage, the version
 * triples in force over the range, the entries, and a verification block that
 * spells out the recomputation by hand. It never carries the chain key. A
 * verifier gets that from the named custodian out of band, which is also why
 * producing an export needs no key at all and checking one does.
 *
 * Three things the export refuses to do quietly:
 *
 * 1. It will not span customers unless the caller says so in as many words.
 *    CLAUDE.md rule 8 forbids the silent cross customer join, so the normal
 *    case is a single customer and the other case needs a flag.
 * 2. When a row inside the range belongs to another customer it is present as
 *    position and hash only. The links still verify, no payload and no customer
 *    identity travels, and the row is visibly withheld rather than missing.
 * 3. A redacted export declares its redactions. Removing a payload field
 *    without declaring it reads as tampering, because the recomputed hash no
 *    longer matches and nothing in the artifact explains why.
 */

export const EXPORT_FORMAT = "guardian.audit.export/1";

/* -------------------------------------------------------------------------- */
/* Artifact shape                                                             */
/* -------------------------------------------------------------------------- */

/** A row the reader may see in full. Its hash can be recomputed. */
export interface ExportedEntry {
  seq: number;
  ts: string;
  kind: AuditKind;
  customerId: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  /**
   * Dotted paths removed from the payload under the redaction option. Present
   * only when something was removed, and its presence is what tells a verifier
   * that this row's hash is not recomputable from what it can see.
   */
  redactedPaths?: string[];
}

/** A row inside the range that belongs to another customer. */
export interface WithheldEntry {
  seq: number;
  prevHash: string;
  hash: string;
  withheld: "other_customer";
}

export type ExportRow = ExportedEntry | WithheldEntry;

export function isWithheld(row: ExportRow): row is WithheldEntry {
  return "withheld" in row;
}

/** A version triple seen in the range, with where it was seen. */
export interface ObservedVersions {
  modelVersion: string;
  lexiconVersion: string;
  fusionVersion: string;
  entryCount: number;
  firstSeq: number;
  lastSeq: number;
}

export interface ExportHeader {
  formatVersion: string;
  /** Deterministic id. The same range exported twice at the same instant is the same id. */
  exportId: string;
  exportedAt: string;
  producedBy: string;
  purpose: string | null;
  scope: {
    customerId: string | null;
    crossCustomer: boolean;
    note: string;
  };
  range: {
    requestedFrom: number;
    requestedTo: number | null;
    fromSeq: number;
    toSeq: number;
    entryCount: number;
    includedCount: number;
    withheldCount: number;
    firstEntryHash: string;
    lastEntryHash: string;
    /** The hash the first row points back at. GENESIS when the range starts at 1. */
    anchorHash: string;
  };
  chainHeadAtExport: { seq: number; hash: string };
  /** Every distinct version triple recorded on a score row in this range. */
  versions: ObservedVersions[];
  algorithm: ExportAlgorithm;
  redaction: {
    applied: boolean;
    keys: string[];
    entryCount: number;
    pathCount: number;
    note: string;
  };
}

/** Enough detail to recompute a hash with a general purpose HMAC and no Guardian code. */
export interface ExportAlgorithm {
  digest: "HMAC-SHA256";
  keyed: true;
  keyEncoding: "utf-8";
  outputEncoding: "hex";
  genesisHash: string;
  canonicalization: string[];
  /** The exact byte string the HMAC is taken over, with substitution points named. */
  preimageTemplate: string;
  preimageFieldOrder: string[];
  linkRule: string;
}

export interface VerificationExpectation {
  seq: number;
  hash: string;
  recomputable: boolean;
  /** Why not, when recomputable is false. */
  limitedTo?: "link_only";
  reason?: "redacted" | "withheld";
}

export interface VerificationBlock {
  /** One line per row in the range. A row present here and missing from entries is a dropped row. */
  expected: VerificationExpectation[];
  counts: { total: number; recomputable: number; linkOnly: number };
  recipe: string[];
  key: {
    included: false;
    algorithm: "HMAC-SHA256";
    whatTheVerifierNeeds: string;
    whyItIsNotHere: string;
    custodian: string;
    delivery: string;
  };
}

export interface ExportArtifact {
  header: ExportHeader;
  entries: ExportRow[];
  verification: VerificationBlock;
}

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export interface ExportOptions {
  /** First seq in the range. Defaults to the start of the chain. */
  fromSeq?: number;
  /** Last seq in the range. Defaults to the chain head at export. */
  toSeq?: number;
  /**
   * Scope to one customer. This is the normal case: a regulator or counsel
   * asking about one operator gets one operator.
   */
  customerId?: string;
  /**
   * Required to export a range that is not scoped to a single customer. Named
   * rather than inferred, because CLAUDE.md rule 8 forbids the silent join.
   */
  crossCustomer?: boolean;
  /**
   * Payload keys to remove, at any depth. For a reader who should see that a
   * score happened without seeing the identifiers behind it.
   */
  redactPayloadKeys?: string[];
  exportedAt?: Date;
  producedBy?: string;
  purpose?: string;
  /** Who holds the chain key on the receiving side. Named in the artifact. */
  keyCustodian?: string;
}

/* -------------------------------------------------------------------------- */
/* Building the artifact                                                      */
/* -------------------------------------------------------------------------- */

export async function exportChain(
  store: AuditStore,
  opts: ExportOptions = {},
): Promise<ExportArtifact> {
  const scoped = typeof opts.customerId === "string" && opts.customerId.length > 0;
  const crossCustomer = opts.crossCustomer === true;

  if (!scoped && !crossCustomer) {
    throw new Error(
      "exportChain needs either customerId or crossCustomer: true. " +
        "An unscoped export spans customers, and rule 8 forbids that without an explicit flag.",
    );
  }
  if (scoped && crossCustomer) {
    throw new Error(
      "exportChain cannot take customerId and crossCustomer together. One scope per export.",
    );
  }

  const head = await store.head();
  const requestedFrom = opts.fromSeq ?? 1;
  const requestedTo = opts.toSeq ?? null;
  if (requestedFrom < 1) throw new Error("exportChain fromSeq must be 1 or greater");
  if (requestedTo !== null && requestedTo < requestedFrom) {
    throw new Error(`exportChain range is empty: ${requestedFrom} to ${requestedTo}`);
  }

  const upper = requestedTo === null ? head.seq : Math.min(requestedTo, head.seq);
  const limit = upper < requestedFrom ? 0 : upper - requestedFrom + 1;
  const source =
    limit === 0 ? [] : (await store.read(requestedFrom, limit)).filter((e) => e.seq <= upper);

  const redactKeys = new Set(opts.redactPayloadKeys ?? []);
  const versions = collectVersions(source);

  const rows: ExportRow[] = [];
  let redactedEntryCount = 0;
  let redactedPathCount = 0;

  for (const entry of source) {
    if (scoped && entry.customerId !== opts.customerId) {
      rows.push({
        seq: entry.seq,
        prevHash: entry.prevHash,
        hash: entry.hash,
        withheld: "other_customer",
      });
      continue;
    }

    const { payload, paths } = redactPayload(entry.payload, redactKeys);
    const row: ExportedEntry = {
      seq: entry.seq,
      ts: entry.ts,
      kind: entry.kind,
      customerId: entry.customerId,
      payload,
      prevHash: entry.prevHash,
      hash: entry.hash,
    };
    if (paths.length > 0) {
      row.redactedPaths = paths;
      redactedEntryCount += 1;
      redactedPathCount += paths.length;
    }
    rows.push(row);
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const withheldCount = rows.filter(isWithheld).length;
  const exportedAt = (opts.exportedAt ?? new Date()).toISOString();

  const header: ExportHeader = {
    formatVersion: EXPORT_FORMAT,
    exportId: "",
    exportedAt,
    producedBy: opts.producedBy ?? "guardian-audit",
    purpose: opts.purpose ?? null,
    scope: {
      customerId: scoped ? (opts.customerId as string) : null,
      crossCustomer,
      note: scoped
        ? "Scoped to one customer. Rows inside the range that belong to another customer are present as position and hash only, with no payload and no customer identity, so the chain links still verify and no cross customer join is possible."
        : "Not scoped to a single customer. The caller asked for this in as many words, and the range below spans every customer that appears in it.",
    },
    range: {
      requestedFrom,
      requestedTo,
      fromSeq: first ? first.seq : requestedFrom,
      toSeq: last ? last.seq : requestedFrom - 1,
      entryCount: rows.length,
      includedCount: rows.length - withheldCount,
      withheldCount,
      firstEntryHash: first ? first.hash : GENESIS_HASH,
      lastEntryHash: last ? last.hash : GENESIS_HASH,
      anchorHash: first ? first.prevHash : GENESIS_HASH,
    },
    chainHeadAtExport: { seq: head.seq, hash: head.hash },
    versions,
    algorithm: describeAlgorithm(),
    redaction: {
      applied: redactKeys.size > 0,
      keys: [...redactKeys].sort(),
      entryCount: redactedEntryCount,
      pathCount: redactedPathCount,
      note:
        redactKeys.size === 0
          ? "No payload field was removed. Every included row carries the payload as it was hashed."
          : "Payload fields were removed by key before this artifact was written. A row that lost a field carries the paths it lost, and its hash cannot be recomputed from what is shown, so it is checked for position and linkage only. The removal is declared here so a redacted export reads as redacted rather than as short.",
    },
  };

  header.exportId = deriveExportId(header);

  const artifact: ExportArtifact = {
    header,
    entries: rows,
    verification: buildVerification(rows, opts.keyCustodian),
  };
  return artifact;
}

/** Stable id for the artifact itself, so counsel and Guardian can tell two exports apart. */
export function artifactDigest(artifact: ExportArtifact): string {
  return createHash("sha256").update(canonicalJson(artifact)).digest("hex");
}

/**
 * The manifest to append to the chain under kind "bundle.exported" once an
 * export leaves the building. It names the artifact and its range and carries
 * no payload content, so recording an export does not copy the export.
 */
export function exportAuditPayload(artifact: ExportArtifact): Record<string, unknown> {
  const { header } = artifact;
  return {
    exportId: header.exportId,
    artifactDigest: artifactDigest(artifact),
    formatVersion: header.formatVersion,
    exportedAt: header.exportedAt,
    producedBy: header.producedBy,
    purpose: header.purpose,
    scopeCustomerId: header.scope.customerId,
    crossCustomer: header.scope.crossCustomer,
    fromSeq: header.range.fromSeq,
    toSeq: header.range.toSeq,
    entryCount: header.range.entryCount,
    withheldCount: header.range.withheldCount,
    chainHeadAtExport: header.chainHeadAtExport.hash,
    redactionKeys: header.redaction.keys,
    redactedEntryCount: header.redaction.entryCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Offline verification                                                       */
/* -------------------------------------------------------------------------- */

export type ExportVerifyReason =
  | "format_unsupported"
  | "manifest_mismatch"
  | "range_mismatch"
  | "scope_mismatch"
  | "redaction_undeclared"
  | "sequence_gap"
  | "root_mismatch"
  | "link_mismatch"
  | "hash_mismatch"
  | "nothing_recomputed";

export interface VerifyExportOptions {
  /**
   * Accept an artifact where no row could be recomputed.
   *
   * Every check other than the hash recomputation compares values that all live
   * inside the artifact: the manifest against the entries, each row's prevHash
   * against the row before it, the last hash against the header. A forger holds
   * both sides of all of them. The chain key is what makes any of it evidence,
   * and on an artifact where every row is link_only the key is never used at
   * all: the right key, the wrong key and an empty string return the same
   * answer. So an all-link_only artifact fails by default, and a caller who
   * genuinely wants a structural pass has to ask for it and say why in their
   * own report.
   */
  allowStructural?: boolean;
}

export type ExportVerifyResult =
  | {
      ok: true;
      /** full when every row was recomputed, structural when some could only be linked. */
      mode: "full" | "structural";
      checked: number;
      recomputed: number;
      linkOnly: number;
      redactedEntries: number;
      withheldEntries: number;
      lastHash: string;
    }
  | {
      ok: false;
      checked: number;
      /** The row that broke, or null when the artifact itself is inconsistent. */
      brokenAt: number | null;
      reason: ExportVerifyReason;
      detail: string;
    };

/**
 * Re-verify an artifact with nothing but the artifact and the chain key, so a
 * regulator can check it on their own machine with no access to Guardian.
 * Failures name the row, which is the DESIGN.md 10 audit test carried into the
 * export.
 */
export function verifyExport(
  artifact: ExportArtifact,
  secret: string,
  options: VerifyExportOptions = {},
): ExportVerifyResult {
  const { header, entries, verification } = artifact;

  if (header.formatVersion !== EXPORT_FORMAT) {
    return fail(0, null, "format_unsupported", `unknown export format ${header.formatVersion}`);
  }

  if (entries.length !== header.range.entryCount) {
    return fail(
      0,
      null,
      "range_mismatch",
      `header declares ${header.range.entryCount} entries, artifact carries ${entries.length}`,
    );
  }

  const manifestCheck = checkManifest(entries, verification.expected);
  if (manifestCheck) return manifestCheck;

  const declaredRedactions = new Set(header.redaction.keys);
  let prevHash: string | undefined =
    header.range.fromSeq === 1 ? GENESIS_HASH : header.range.anchorHash;
  let prevSeq: number | undefined;
  let recomputed = 0;
  let linkOnly = 0;
  let redactedEntries = 0;
  let withheldEntries = 0;

  for (let i = 0; i < entries.length; i++) {
    const row = entries[i]!;

    if (prevSeq !== undefined && row.seq !== prevSeq + 1) {
      return fail(
        i,
        row.seq,
        "sequence_gap",
        `expected seq ${prevSeq + 1}, found ${row.seq}. A row was removed from the range.`,
      );
    }

    if (prevHash !== undefined && row.prevHash !== prevHash) {
      return fail(
        i,
        row.seq,
        i === 0 ? "root_mismatch" : "link_mismatch",
        `entry ${row.seq} points at ${short(row.prevHash)}, the row before it hashes to ${short(prevHash)}`,
      );
    }

    if (isWithheld(row)) {
      withheldEntries += 1;
      linkOnly += 1;
    } else {
      if (header.scope.customerId !== null && row.customerId !== header.scope.customerId) {
        return fail(
          i,
          row.seq,
          "scope_mismatch",
          `entry ${row.seq} carries customer ${row.customerId} in an export scoped to ${header.scope.customerId}`,
        );
      }

      const paths = row.redactedPaths ?? [];
      if (paths.length > 0) {
        const undeclared = paths.filter((p) => !declaredRedactions.has(lastSegment(p)));
        if (undeclared.length > 0) {
          return fail(
            i,
            row.seq,
            "redaction_undeclared",
            `entry ${row.seq} removed ${undeclared.join(", ")}, which the header does not declare`,
          );
        }
        redactedEntries += 1;
        linkOnly += 1;
      } else {
        const expected = entryDigest(
          {
            seq: row.seq,
            ts: row.ts,
            kind: row.kind,
            customerId: row.customerId,
            payload: row.payload,
            prevHash: row.prevHash,
          },
          secret,
        );
        if (expected !== row.hash) {
          return fail(
            i,
            row.seq,
            "hash_mismatch",
            `entry ${row.seq} (${row.kind}, customer ${row.customerId}) does not match its recorded hash. ` +
              "Either the row was edited after it was written, or this artifact was verified with the wrong key.",
          );
        }
        recomputed += 1;
      }
    }

    prevHash = row.hash;
    prevSeq = row.seq;
  }

  const lastHash = prevHash ?? GENESIS_HASH;
  if (lastHash !== header.range.lastEntryHash) {
    return fail(
      entries.length,
      prevSeq ?? null,
      "range_mismatch",
      `header names ${short(header.range.lastEntryHash)} as the last hash in the range, the entries end at ${short(lastHash)}`,
    );
  }

  // Nothing was recomputed, so nothing here was checked against the key. Keyed
  // on recomputed rather than on mode, because an ordinary scoped export is
  // already partly structural: another customer's rows are withheld and can
  // only be linked, and that artifact still proves what it carries.
  if (recomputed === 0 && entries.length > 0 && options.allowStructural !== true) {
    return fail(
      entries.length,
      null,
      "nothing_recomputed",
      `no row in this artifact could be recomputed (${redactedEntries} redacted, ${withheldEntries} withheld), so the chain key was never used and this pass proves nothing about the content of any row. Only position and linkage were checked, and a forger controls both sides of those. Re-export without redacting the keys every row carries, or pass allowStructural to accept a positional check.`,
    );
  }

  return {
    ok: true,
    mode: linkOnly === 0 ? "full" : "structural",
    checked: entries.length,
    recomputed,
    linkOnly,
    redactedEntries,
    withheldEntries,
    lastHash,
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function fail(
  checked: number,
  brokenAt: number | null,
  reason: ExportVerifyReason,
  detail: string,
): ExportVerifyResult {
  return { ok: false, checked, brokenAt, reason, detail };
}

function checkManifest(
  entries: ExportRow[],
  expected: VerificationExpectation[],
): ExportVerifyResult | null {
  // Name the row before counting rows. A dropped entry is the interesting
  // failure, and "one row short" is a worse answer than "seq 3 is gone".
  const present = new Set(entries.map((row) => row.seq));
  for (const want of expected) {
    if (!present.has(want.seq)) {
      return fail(
        0,
        want.seq,
        "manifest_mismatch",
        `the verification block expects seq ${want.seq}, the artifact does not carry it`,
      );
    }
  }
  const listed = new Set(expected.map((want) => want.seq));
  for (const row of entries) {
    if (!listed.has(row.seq)) {
      return fail(
        0,
        row.seq,
        "manifest_mismatch",
        `entry ${row.seq} is in the artifact and not in the verification block`,
      );
    }
  }
  if (entries.length !== expected.length) {
    return fail(
      0,
      null,
      "manifest_mismatch",
      `the verification block lists ${expected.length} rows, the artifact carries ${entries.length}`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i]!;
    const row = entries[i]!;
    if (row.seq !== want.seq) {
      return fail(
        i,
        want.seq,
        "manifest_mismatch",
        `the verification block expects seq ${want.seq} at position ${i}, the artifact has seq ${row.seq}`,
      );
    }
    if (row.hash !== want.hash) {
      return fail(
        i,
        want.seq,
        "manifest_mismatch",
        `entry ${want.seq} carries ${short(row.hash)}, the verification block expects ${short(want.hash)}`,
      );
    }
    const recomputable = !isWithheld(row) && (row.redactedPaths ?? []).length === 0;
    if (recomputable !== want.recomputable) {
      return fail(
        i,
        want.seq,
        "manifest_mismatch",
        `entry ${want.seq} is ${recomputable ? "shown in full" : "not shown in full"}, the verification block says otherwise`,
      );
    }
  }
  return null;
}

function buildVerification(rows: ExportRow[], custodian: string | undefined): VerificationBlock {
  const expected: VerificationExpectation[] = rows.map((row) => {
    if (isWithheld(row)) {
      return {
        seq: row.seq,
        hash: row.hash,
        recomputable: false,
        limitedTo: "link_only" as const,
        reason: "withheld" as const,
      };
    }
    if ((row.redactedPaths ?? []).length > 0) {
      return {
        seq: row.seq,
        hash: row.hash,
        recomputable: false,
        limitedTo: "link_only" as const,
        reason: "redacted" as const,
      };
    }
    return { seq: row.seq, hash: row.hash, recomputable: true };
  });

  const recomputable = expected.filter((e) => e.recomputable).length;

  return {
    expected,
    counts: {
      total: expected.length,
      recomputable,
      linkOnly: expected.length - recomputable,
    },
    recipe: [
      "1. Obtain the chain key from the custodian named below. It is not in this file.",
      "2. For each entry marked recomputable, build the preimage named in header.algorithm.preimageTemplate from that entry's own fields, serializing the payload by the canonicalization rules in header.algorithm.canonicalization.",
      "3. Compute HMAC-SHA256 over the preimage bytes with the key as a raw UTF-8 byte string, and write the result as lower case hex.",
      "4. Compare that value with the entry's hash field and with the same seq in verification.expected. All three agree on an untouched row.",
      "5. Check linkage: entry N's prevHash equals entry N-1's hash. The first entry in a range that starts at seq 1 points at the genesis hash in header.algorithm.genesisHash.",
      "6. Check continuity: seq increases by exactly one across the range. A jump is a removed row.",
      "7. Rows marked link_only carry less than they were hashed over, either because a payload field was redacted or because the row belongs to another customer and was withheld. Their hash cannot be recomputed here. They are still checked for position and linkage, and the header declares how many there are.",
      "8. A row that fails step 4 while claiming to be recomputable was edited after it was written, unless the key itself is wrong, in which case every recomputable row fails.",
      "9. Steps 5 and 6 compare values that all live inside this file, so they show the artifact is internally consistent and nothing more. Only step 4 uses the key, and only step 4 shows a row's content is what was written. If counts.recomputable is 0, the key was never used and this file proves nothing about the content of any row; the verifier reports that rather than a pass.",
    ],
    key: {
      included: false,
      algorithm: "HMAC-SHA256",
      whatTheVerifierNeeds:
        "This artifact and the audit chain key, which is a byte string used as the HMAC key. Nothing else. No Guardian code, no database access, and no network call.",
      whyItIsNotHere:
        "The key is what makes the chain unforgeable. An export travels, so the key never rides with it. Anyone holding both could rewrite a row and re-hash it.",
      custodian: custodian ?? "not named in this export",
      delivery:
        "Guardian supplies the key to the named custodian out of band, under the agreement that names them.",
    },
  };
}

function describeAlgorithm(): ExportAlgorithm {
  return {
    digest: "HMAC-SHA256",
    keyed: true,
    keyEncoding: "utf-8",
    outputEncoding: "hex",
    genesisHash: GENESIS_HASH,
    canonicalization: [
      "Object keys are sorted ascending by UTF-16 code unit order, recursively, at every depth.",
      "Keys whose value is undefined are omitted entirely.",
      "Dates are written as ISO 8601 in UTC with milliseconds, for example 2026-01-01T00:00:00.000Z.",
      "Arrays keep their order and are canonicalized element by element.",
      "There is no whitespace between tokens. Strings are escaped as in ECMA-404 JSON.",
      "NaN and Infinity are rejected when a row is written, so no such value can appear in a payload.",
    ],
    preimageTemplate:
      '{"customerId":<customerId>,"kind":<kind>,"payload":<canonical payload>,"prevHash":<prevHash>,"seq":<seq>,"ts":<ts>}',
    preimageFieldOrder: ["customerId", "kind", "payload", "prevHash", "seq", "ts"],
    linkRule:
      "prevHash of entry N is the hash of entry N-1. The first entry of the chain points at the genesis hash. The hash field is never part of its own preimage.",
  };
}

/**
 * Remove payload fields by key at any depth, recording the dotted path of each
 * one. Always returns a fresh object, so the artifact does not alias rows the
 * store still holds.
 */
function redactPayload(
  payload: Record<string, unknown>,
  keys: Set<string>,
): { payload: Record<string, unknown>; paths: string[] } {
  const paths: string[] = [];

  const walk = (value: unknown, prefix: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((item, i) => walk(item, prefix === "" ? String(i) : `${prefix}.${i}`));
    }
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        if (keys.has(key)) {
          paths.push(path);
          continue;
        }
        out[key] = walk(item, path);
      }
      return out;
    }
    return value;
  };

  return { payload: walk(payload, "") as Record<string, unknown>, paths };
}

/**
 * The version triples in force over the range. Read before redaction, because
 * the triple is the first thing an auditor asks for and the last thing that
 * should go missing from a redacted export.
 */
function collectVersions(entries: AuditEntry[]): ObservedVersions[] {
  const seen = new Map<string, ObservedVersions>();

  for (const entry of entries) {
    const triple = readTriple(entry.payload);
    if (!triple) continue;
    const key = `${triple.modelVersion}\u0000${triple.lexiconVersion}\u0000${triple.fusionVersion}`;
    const existing = seen.get(key);
    if (existing) {
      existing.entryCount += 1;
      existing.lastSeq = entry.seq;
      continue;
    }
    seen.set(key, {
      ...triple,
      entryCount: 1,
      firstSeq: entry.seq,
      lastSeq: entry.seq,
    });
  }

  return [...seen.values()].sort((a, b) => a.firstSeq - b.firstSeq);
}

function readTriple(
  payload: Record<string, unknown>,
): { modelVersion: string; lexiconVersion: string; fusionVersion: string } | null {
  const nested = payload["versions"];
  const source =
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : payload;
  const model = source["modelVersion"];
  const lexicon = source["lexiconVersion"];
  const fusion = source["fusionVersion"];
  if (typeof model !== "string" || typeof lexicon !== "string" || typeof fusion !== "string") {
    return null;
  }
  return { modelVersion: model, lexiconVersion: lexicon, fusionVersion: fusion };
}

/**
 * Deterministic id over what the export is, not over when somebody clicked. The
 * same range at the same instant with the same scope yields the same id, so two
 * copies of one export are recognizable as one export.
 */
function deriveExportId(header: ExportHeader): string {
  const material = canonicalJson({
    formatVersion: header.formatVersion,
    exportedAt: header.exportedAt,
    customerId: header.scope.customerId,
    crossCustomer: header.scope.crossCustomer,
    fromSeq: header.range.fromSeq,
    toSeq: header.range.toSeq,
    lastEntryHash: header.range.lastEntryHash,
    chainHead: header.chainHeadAtExport.hash,
    redactionKeys: header.redaction.keys,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

function lastSegment(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1] ?? path;
}

function short(hash: string): string {
  return `${hash.slice(0, 12)}...`;
}
