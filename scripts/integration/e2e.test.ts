import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditLog, PrismaAuditStore, exportChain, isWithheld, verifyExport } from "@guardian/audit";
import {
  PrismaCustomerStore,
  PrismaDeliveryStore,
  RedisEventQueue,
  attemptDelivery,
  buildServer,
  enqueueDelivery,
  streamKey,
} from "@guardian/ingest";
import {
  buildReport,
  preserveUntil,
  scoreReportCompleteness,
  type ReportCustomer,
} from "@guardian/report";
import {
  Kernel,
  PrismaKernelStore,
  buildEvidenceBundle,
  persistScoredEvent,
  runWorker,
  type TimelineInput,
} from "@guardian/scorer";
import {
  hashUid,
  type AgeBand,
  type ReviewerContext,
  type SignalHit,
  type Stage,
} from "@guardian/schema";
import { createPrismaClient, type PrismaClient } from "@guardian/schema/db";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The reviewer console, by path rather than by package name: apps/review is a
// Next application and publishes no entrypoint. Rule 6 says T3 comes from one
// place, so the phase 3 leg drives that place rather than a copy of it.
import { markExcerptsViewed } from "../../apps/review/src/lib/data/cases.js";
import { disconnectPrisma } from "../../apps/review/src/lib/db.js";
import { recordDecision } from "../../apps/review/src/lib/decisions.js";
import type { Session } from "../../apps/review/src/lib/session.js";

/**
 * End to end against the live local Postgres and Redis: ingest edge to Redis
 * Stream to scorer worker to the pairs, events and audit tables.
 *
 * The conversation is the nine message grooming ladder from
 * apps/scorer/test/kernel.test.ts, sent adult to child through the HTTP edge
 * with the customer's real key. Everything the run creates is keyed to a
 * customer minted for this run and removed in afterAll, with one deliberate
 * exception: audit rows are never deleted.
 *
 * The chain is one global hash sequence. Deleting this run's entries out of
 * the middle of it leaves a sequence gap, verifyChain stops there, and
 * `pnpm cli verify-audit` reports the whole chain broken from that row on,
 * with no way to repair it. So the run appends under the deployment's own
 * AUDIT_CHAIN_SECRET and leaves what it wrote in place: those entries are as
 * genuine as any other.
 *
 * Skips, rather than fails, when either service is unreachable, when the
 * secret cannot be found, or when the database is not a local one.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://guardian:guardian@localhost:5433/guardian";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6381";
const STEP_TIMEOUT_MS = 60_000;

/**
 * apps/review builds its own client from the environment and reads an unset
 * DATABASE_URL as a signal to serve fixtures. The phase 3 leg drives the real
 * decision path against the real database, so both are stated here rather than
 * inferred. GUARDIAN_MOCK=0 is the explicit form of "not fixtures".
 */
process.env.DATABASE_URL = DATABASE_URL;
process.env.GUARDIAN_MOCK = "0";

/**
 * The deployment's chain secret, from the environment or from the repo .env
 * the bootstrap script writes it to. Appending under any other secret would
 * leave entries that no later verify can check, and they cannot be deleted.
 */
function auditSecret(): string | null {
  const fromEnv = process.env.AUDIT_CHAIN_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
  try {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const match = /^AUDIT_CHAIN_SECRET=(.+)$/.exec(line.trim());
      if (match && match[1]) return match[1].trim();
    }
  } catch {
    return null;
  }
  return null;
}

/** Local only. This run writes to a shared chain that cannot be cleaned up. */
function isLocalDatabase(url: string): boolean {
  if (process.env.GUARDIAN_E2E_ALLOW_REMOTE === "1") return true;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

type Infra = { db: PrismaClient; redis: Redis };

async function probe(): Promise<Infra | { unreachable: string }> {
  const db = createPrismaClient(DATABASE_URL);
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    await db.$disconnect().catch(() => undefined);
    return { unreachable: `postgres (DATABASE_URL): ${message(err)}` };
  }
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    await redis.ping();
  } catch (err) {
    redis.disconnect();
    await db.$disconnect().catch(() => undefined);
    return { unreachable: `redis (REDIS_URL): ${message(err)}` };
  }
  return { db, redis };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] ?? "" : String(err);
}

/**
 * Key names that would mean bytes had reached a structure that must never hold
 * them. Checked by name rather than by value, because a field called `bytes`
 * holding nothing today is still a field the next writer will fill.
 */
const BYTE_BEARING_KEYS = new Set([
  "bytes",
  "content",
  "data",
  "file",
  "fileBytes",
  "image",
  "imageBytes",
  "media",
  "payloadBytes",
  "thumbnail",
  "video",
]);

/** Every key name anywhere in a structure, including inside arrays. */
function keysAnywhere(value: unknown, seen = new Set<object>()): string[] {
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((item) => keysAnywhere(item, seen));
  const out: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out.push(key);
    out.push(...keysAnywhere(entry, seen));
  }
  return out;
}

const AUDIT_SECRET = auditSecret();
/**
 * The console reads the chain key from the environment and refuses to append
 * without one. This run appends through it, so the secret found in the repo
 * .env is put where that module looks for it.
 */
if (AUDIT_SECRET) process.env.AUDIT_CHAIN_SECRET = AUDIT_SECRET;

const infra = !isLocalDatabase(DATABASE_URL)
  ? { unreachable: "DATABASE_URL is not local; set GUARDIAN_E2E_ALLOW_REMOTE=1 to override" }
  : AUDIT_SECRET === null
    ? { unreachable: "AUDIT_CHAIN_SECRET is not set and no .env holds one" }
    : await probe();
const skipReason = "unreachable" in infra ? infra.unreachable : null;
const live = skipReason === null ? describe : describe.skip;
if (skipReason) console.warn(`e2e skipped, ${skipReason}`);

/** Minutes after the conversation start. Copied from the kernel tests. */
interface Line {
  from: "actor" | "target";
  text: string;
  at: number;
}

const groomingLadder: Line[] = [
  { from: "actor", text: "hey nice build in that game", at: 0 },
  { from: "target", text: "thanks lol", at: 1 },
  { from: "actor", text: "what do you like to play? i can send you some robux if you want", at: 3 },
  { from: "target", text: "omg really", at: 4 },
  { from: "actor", text: "yeah. are your parents home right now? do they check your phone?", at: 8 },
  { from: "target", text: "no theyre at work", at: 9 },
  { from: "actor", text: "cool. add me on 👻 my snap is ryan_xx99, easier to talk there", at: 12 },
  { from: "target", text: "ok", at: 13 },
  { from: "actor", text: "dont tell anyone we talk ok, our secret", at: 15 },
];

const T0 = new Date("2026-09-02T12:00:00Z").getTime();
const ADULT_BAND: AgeBand = "A21_PLUS";
const CHILD_BAND: AgeBand = "A9_12";

/**
 * The sha256 of a file this repository never holds, never fetches and never
 * writes down in any other form. It is the whole of Guardian's media story
 * (CLAUDE.md rule 1) and the phase 3 leg asserts that it stays the whole of it
 * all the way into the built report.
 */
const MEDIA_SHA256 = "9f".repeat(32);

live(`ingest to scorer to postgres (${skipReason ?? "live"})`, () => {
  const { db, redis } = infra as Infra;
  const run = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const adultUid = `adult-${run}`;
  const childUid = `child-${run}`;

  const customers = new PrismaCustomerStore(db);
  const audit = new AuditLog(new PrismaAuditStore(db), AUDIT_SECRET ?? "");

  let customerId = "";
  let idSalt = "";
  let apiKey = "";
  let app: ReturnType<typeof buildServer> | null = null;
  let seqBefore = 0;
  let rootVerifiedBefore = false;

  // Carried from one leg of the run to the next. Vitest runs a file's tests in
  // order, and these are one story rather than three independent ones.
  let pairId = "";
  let deliveryId = "";

  const reviewerA: Session = {
    reviewerId: `rev-a-${run}`,
    displayName: "First reviewer",
    role: "reviewer",
    customerId: "",
    issuedAt: Date.now(),
  };
  const reviewerB: Session = {
    reviewerId: `rev-b-${run}`,
    displayName: "Second reviewer",
    role: "owner",
    customerId: "",
    issuedAt: Date.now(),
  };

  function inbound(line: Line, index: number) {
    const fromActor = line.from === "actor";
    return {
      externalId: `m${index}`,
      actorUid: fromActor ? adultUid : childUid,
      targetUid: fromActor ? childUid : adultUid,
      channel: "general",
      ts: new Date(T0 + line.at * 60_000).toISOString(),
      text: line.text,
      actorBand: fromActor ? ADULT_BAND : CHILD_BAND,
      targetBand: fromActor ? CHILD_BAND : ADULT_BAND,
      provenance: { surface: "discord", sourceId: `guild-${run}` },
    };
  }

  async function post(payload: unknown) {
    if (!app) throw new Error("server not built");
    return app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "application/json", "x-guardian-key": apiKey },
      payload: JSON.stringify(payload),
    });
  }

  beforeAll(async () => {
    const created = await customers.createCustomer(`Integration run ${run}`);
    customerId = created.customer.id;
    idSalt = created.customer.idSalt;
    apiKey = created.apiKey;
    reviewerA.customerId = customerId;
    reviewerB.customerId = customerId;
    seqBefore = (await audit.head()).seq;
    // If the chain already verified from the root, it still must afterwards.
    rootVerifiedBefore = (await audit.verify()).ok;

    app = buildServer({
      customers,
      queue: new RedisEventQueue(redis),
      audit,
      violations: {
        record: (id, violations) => customers.recordViolation(id, violations),
      },
    });
  }, STEP_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    // The reviewer console caches its own client on globalThis. Dropped before
    // the rows it holds open are deleted.
    await disconnectPrisma().catch(() => undefined);
    if (customerId) {
      const where = { customerId };
      // Reviews reference the pair with onDelete: Restrict, deliberately: a
      // reviewer's decision is never removed by a pair expiring. So they go
      // first, and only for this run's pairs.
      await db.review.deleteMany({ where: { pair: { customerId } } });
      await db.webhookDelivery.deleteMany({ where });
      await db.evidenceBundle.deleteMany({ where });
      await db.pair.deleteMany({ where });
      await db.event.deleteMany({ where });
      await db.actor.deleteMany({ where });
      await db.customerViolation.deleteMany({ where });
      // Audit rows stay. seq is one global sequence and every later row hashes
      // the one before it, so deleting this run's entries would break
      // verification for the whole chain with no way back. That now covers the
      // evidence.read and review.decision entries the phase 3 leg appends as
      // well as the scores. There is no foreign key from audit_entries to
      // customers, so the customer row still goes.
      await db.customer.delete({ where: { id: customerId } });
      await redis.del(streamKey(customerId));
    }
    await redis.quit().catch(() => undefined);
    await db.$disconnect();
  }, STEP_TIMEOUT_MS);

  /**
   * Runs the scorer worker until `expected` events have been persisted in this
   * run, or the step budget is spent. Returns how many it persisted.
   */
  async function drain(expected: number): Promise<number> {
    const store = PrismaKernelStore.fromClient(db);
    const kernel = new Kernel({ store });
    let persisted = 0;
    const deadline = Date.now() + STEP_TIMEOUT_MS / 2;
    await runWorker(
      {
        redis,
        kernel,
        audit,
        customerIds: [customerId],
        consumerName: `e2e-${run}`,
        blockMs: 250,
        persist: async (event, scored) => {
          await persistScoredEvent(db, store, event, scored);
          persisted += 1;
        },
      },
      () => persisted >= expected || Date.now() > deadline,
    );
    return persisted;
  }

  it(
    "accepts the ladder at the edge and scores it to T2 with text kept and the chain intact",
    async () => {
      const res = await post({ events: groomingLadder.map(inbound) });
      expect({ status: res.statusCode, body: res.json() }).toEqual({
        status: 202,
        body: { accepted: groomingLadder.length, rejected: [] },
      });

      expect(await drain(groomingLadder.length)).toBe(groomingLadder.length);

      const actorUid = hashUid(adultUid, idSalt);
      const targetUid = hashUid(childUid, idSalt);
      const pair = await db.pair.findUnique({
        where: { customerId_actorUid_targetUid: { customerId, actorUid, targetUid } },
      });
      expect(pair?.tier).toBe("T2");
      expect(pair?.retention).toBe("WATCH_30D");

      const lastIndex = groomingLadder.length - 1;
      const last = await db.event.findUnique({
        where: { customerId_externalId: { customerId, externalId: `m${lastIndex}` } },
      });
      expect(last?.text).toBe(groomingLadder[lastIndex]?.text);
      expect(last?.retention).toBe("WATCH_30D");
      expect(last?.actorUid).toBe(actorUid);

      // One event.ingested entry plus one score.assigned per message.
      const verdict = await audit.verify(seqBefore + 1);
      expect(verdict.ok).toBe(true);
      expect(verdict.checked).toBeGreaterThanOrEqual(groomingLadder.length + 1);

      // And from the root. The run appends to the deployment's own chain, so
      // a chain that verified before this test must still verify after it.
      if (rootVerifiedBefore) {
        const fromRoot = await audit.verify();
        expect(fromRoot.ok ? null : `${fromRoot.reason} at ${fromRoot.brokenAt}`).toBeNull();
      }
    },
    STEP_TIMEOUT_MS,
  );

  it(
    "keeps the chain contiguous under concurrent appends from two clients",
    async () => {
      // A second client stands in for a second process (the scorer beside
      // ingest). Without the advisory lock in PrismaAuditStore these would
      // race for the same seq.
      const db2 = createPrismaClient(DATABASE_URL);
      try {
        const audit2 = new AuditLog(new PrismaAuditStore(db2), AUDIT_SECRET ?? "");
        const start = (await audit.head()).seq;
        const writers = [audit, audit2];
        const appends = Array.from({ length: 12 }, (_, i) =>
          writers[i % 2]!.append({
            kind: "lexicon.updated",
            customerId,
            payload: { probe: i },
          }),
        );
        const entries = await Promise.all(appends);
        const seqs = entries.map((e) => e.seq).sort((a, b) => a - b);
        expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => start + 1 + i));
        const verdict = await audit.verify(seqBefore + 1);
        expect(verdict.ok).toBe(true);
      } finally {
        await db2.$disconnect();
      }
    },
    STEP_TIMEOUT_MS,
  );

  it(
    "records a customer violation when a data uri is posted",
    async () => {
      const res = await post({
        ...inbound(groomingLadder[0]!, 99),
        text: "data:image/png;base64,iVBORw0KGgo=",
      });
      expect({ status: res.statusCode, error: res.json().error }).toEqual({
        status: 422,
        error: "media bytes are never accepted",
      });

      const violations = await db.customerViolation.count({ where: { customerId } });
      expect(violations).toBeGreaterThanOrEqual(1);
      const queued = await db.event.count({ where: { customerId, externalId: "m99" } });
      expect(queued).toBe(0);
    },
    STEP_TIMEOUT_MS,
  );

  /* ------------------------------------------------------------------------ */
  /* Phase 3: reviewer confirmation, report, delivery, audit export            */
  /* ------------------------------------------------------------------------ */

  it(
    "takes the T2 pair through a second reviewer's concurrence to T3 and builds a report of hashes",
    async () => {
      const actorUid = hashUid(adultUid, idSalt);
      const targetUid = hashUid(childUid, idSalt);

      // A tenth message carrying media as a sha256 and the operator's own
      // scanner verdict. Nothing in this repository ever holds the file: the
      // edge refuses bytes, the event row has no column for them, and the
      // assertions below follow the hash all the way into the report.
      const withMedia = await post({
        externalId: "m9",
        actorUid: adultUid,
        targetUid: childUid,
        channel: "general",
        ts: new Date(T0 + 18 * 60_000).toISOString(),
        text: "send me one back",
        media: { sha256: MEDIA_SHA256, knownCsamVerdict: "no_match", kind: "image" },
        actorBand: ADULT_BAND,
        targetBand: CHILD_BAND,
        provenance: { surface: "discord", sourceId: `guild-${run}` },
      });
      expect({ status: withMedia.statusCode, body: withMedia.json() }).toEqual({
        status: 202,
        body: { accepted: 1, rejected: [] },
      });
      expect(await drain(1)).toBe(1);

      const pair = await db.pair.findUniqueOrThrow({
        where: { customerId_actorUid_targetUid: { customerId, actorUid, targetUid } },
      });
      pairId = pair.id;
      expect(pair.tier).toBe("T2");
      expect(pair.soleAutomatedBasis).toBe(false);

      const versions = {
        modelVersion: pair.modelVersion ?? "kernel-v0",
        lexiconVersion: pair.lexiconVersion ?? "v2",
        fusionVersion: pair.fusionVersion ?? "rules-v2",
      };
      const events = await db.event.findMany({ where: { customerId }, orderBy: { ts: "asc" } });
      const timeline: TimelineInput[] = events.map((e) => ({
        ts: e.ts,
        channel: e.channel,
        direction: e.actorUid === actorUid ? "actor_to_target" : "target_to_actor",
        text: e.text,
        mediaSha256: e.mediaSha256,
        knownCsamVerdict: e.knownCsamVerdict as TimelineInput["knownCsamVerdict"],
        stage: e.stage as Stage | null,
        signals: [],
        surface: e.surface,
        channelVisibility: e.channelVisibility,
        actorAge: {
          band: e.actorBand as AgeBand,
          confidence: e.actorBandConfidence,
          provenance: e.actorBandProvenance,
        },
        targetAge: {
          band: e.targetBand as AgeBand,
          confidence: e.targetBandConfidence,
          provenance: e.targetBandProvenance,
        },
      }));

      // What the customer record would supply once those columns exist. Passed
      // in rather than invented by the builder: Guardian holds no provider
      // name, no ESP id and no jurisdiction of its own.
      const bundleInput = {
        customerId,
        actorUid,
        targetUid,
        timeline,
        signals: pair.signals as unknown as SignalHit[],
        versions,
        provenance: [],
        auditHead: (await audit.head()).hash,
        jurisdiction: { country: "US", subdivision: "TX" } as const,
        legalBasis: "provider_2258a" as const,
        timezone: "America/Chicago",
        reporter: {
          providerName: `Integration run ${run}`,
          espId: `esp-${run}`,
          filingMode: "guardian_as_agent" as const,
          contactOnFile: true,
        },
      };

      // The kernel's bundle: tier T2, and every excerpt unread, because nobody
      // has opened one. This is the row the console reads from.
      const draft = buildEvidenceBundle({ ...bundleInput, tier: "T2" });
      expect(draft.timeline.every((r) => r.viewedByHuman === false)).toBe(true);
      await db.evidenceBundle.create({
        data: {
          bundleId: draft.bundleId,
          customerId,
          pairId,
          actorUid,
          targetUid,
          tier: "T2",
          timeline: draft.timeline as never,
          signals: draft.signals as never,
          provenance: [] as never,
          jurisdictionCountry: "US",
          jurisdictionSubdivision: "TX",
          legalBasis: "provider_2258a",
          modelVersion: versions.modelVersion,
          lexiconVersion: versions.lexiconVersion,
          fusionVersion: versions.fusionVersion,
          auditHead: draft.auditHead,
          retention: "WATCH_30D",
        },
      });

      // A confirm or a proposal is refused until an excerpt has actually been
      // rendered to a person, and the server checks its own record rather than
      // the browser's claim.
      await expect(
        recordDecision({
          session: reviewerA,
          pairId,
          decision: "report",
          reasonCode: "propose.online_enticement",
          notes: { timeline: "Nothing has been opened yet." },
        }),
      ).rejects.toThrow(/no excerpt/i);

      const excerptIds = draft.timeline.map((_, index) => `${draft.bundleId}_${index}`);
      const marked = await markExcerptsViewed(reviewerA, pairId, excerptIds);
      expect(marked).toEqual(excerptIds);

      const notes = {
        timeline:
          "Robux offer at three minutes, supervision probe at eight, a handle handoff at twelve and a secrecy instruction at fifteen, then an image request with a hash at eighteen.",
        outsideContext: "The receiving account's server role puts it in the 9 to 12 band.",
        recommendation:
          "The whole sequence runs inside twenty minutes, which is the compressed pattern rather than a slow build, and the operator's own scanner returned no match on the one file involved.",
      };

      const proposal = await recordDecision({
        session: reviewerA,
        pairId,
        decision: "report",
        reasonCode: "propose.online_enticement",
        notes,
        viewedExcerptCount: marked.length,
        lawEnforcementRequested: false,
      });
      // Rule 6, first half: a proposal on its own writes no tier at all.
      expect({ state: proposal.state, tier: proposal.resultTier }).toEqual({
        state: "proposed",
        tier: "T2",
      });
      expect((await db.pair.findUniqueOrThrow({ where: { id: pairId } })).tier).toBe("T2");

      // Rule 6, second half: the same reviewer cannot be the second reviewer.
      await expect(
        recordDecision({
          session: reviewerA,
          pairId,
          decision: "report",
          reasonCode: "propose.online_enticement",
          notes,
          concurrence: {
            proposalReviewId: proposal.review.id,
            proposerReviewerId: reviewerA.reviewerId,
            upheld: true,
          },
        }),
      ).rejects.toThrow(/second reviewer cannot be/i);

      const upheld = await recordDecision({
        session: reviewerB,
        pairId,
        decision: "report",
        reasonCode: "propose.online_enticement",
        notes,
        viewedExcerptCount: marked.length,
        concurrence: {
          proposalReviewId: proposal.review.id,
          proposerReviewerId: reviewerA.reviewerId,
          upheld: true,
        },
      });
      expect({ state: upheld.state, tier: upheld.resultTier }).toEqual({
        state: "upheld",
        tier: "T3",
      });

      const confirmed = await db.pair.findUniqueOrThrow({ where: { id: pairId } });
      expect({ tier: confirmed.tier, retention: confirmed.retention }).toEqual({
        tier: "T3",
        retention: "CASE_1Y",
      });

      const reviewer: ReviewerContext = {
        reviewerId: reviewerB.reviewerId,
        reviewId: upheld.review.id,
        decision: "report",
        modelTier: "T2",
        resultTier: "T3",
        decidedAt: upheld.review.createdAt,
        reasonCode: "propose.online_enticement",
        notes,
        viewedExcerptCount: marked.length,
        concurringReviewerId: reviewerA.reviewerId,
      };

      // The per-excerpt read flags come back off the stored bundle, not off a
      // claim the test makes. A bundle may only say a person read a line where
      // markExcerptsViewed wrote that line's id.
      const stored = await db.evidenceBundle.findUniqueOrThrow({
        where: { bundleId: draft.bundleId },
      });
      const readFlags = (stored.timeline as unknown as Array<{ viewedByHuman?: boolean }>).map(
        (r) => r.viewedByHuman === true,
      );
      expect(readFlags.every(Boolean)).toBe(true);
      expect(stored.humanViewedByReviewerId).toBe(reviewerA.reviewerId);

      const bundle = buildEvidenceBundle({
        ...bundleInput,
        tier: "T3",
        retention: "CASE_1Y",
        reviewer,
        timeline: timeline.map((row, index) => ({
          ...row,
          viewedByHuman: readFlags[index] ?? false,
        })),
      });

      const reportCustomer: ReportCustomer = {
        customerId,
        providerName: `Integration run ${run}`,
        platform: "Integration run chat",
        reportingPerson: {
          firstName: "Dana",
          lastName: "Okafor",
          email: "trust-and-safety@example.test",
          phone: "+1-555-0100",
        },
        contactPerson: { firstName: "Dana", lastName: "Okafor", email: "legal@example.test" },
        // The customer's own account ids, mapped back from the salted hashes
        // Guardian holds. A hash NCMEC cannot resolve is the same as no
        // identifier at all, which is why the completeness scorer blocks on it.
        reportedAccount: {
          espIdentifier: adultUid,
          screenName: adultUid,
          espService: "Integration run chat",
          ipCaptureEvent: [
            {
              ipAddress: "203.0.113.24",
              eventName: "Message Sent",
              dateTime: "2026-09-02T07:18:00-05:00",
            },
          ],
          estimatedLocation: { city: "Austin", region: "TX", countryCode: "US" },
        },
        victimAccount: { espIdentifier: childUid, screenName: childUid, person: { age: 11 } },
        mediaScanner: "PhotoDNA run by the provider",
        bytesHeldByOperator: true,
        environment: "test",
      };

      const report = buildReport(bundle, reportCustomer, reviewer);

      expect(report.environment).toBe("test");
      expect(report.guardian.tier).toBe("T3");
      expect(report.guardian.reviewerId).toBe(reviewerB.reviewerId);
      expect(report.guardian.concurringReviewerId).toBe(reviewerA.reviewerId);
      expect(report.guardian.excerptsViewedByHuman).toBe(report.guardian.excerptsTotal);
      expect(report.reporter.companyName).toBe(`Integration run ${run}`);
      expect(report.incidentSummary.incidentType).toBe(
        "Online Enticement of Children for Sexual Acts",
      );

      // The number NCMEC publishes about report quality. Over a tenth of 2025
      // industry reports could not answer it.
      const completeness = scoreReportCompleteness(report);
      expect(completeness.jurisdictionDeterminable).toBe(true);
      expect(completeness.jurisdictionBasis).toBe("ip_capture_with_timestamp");
      expect(completeness.blocking).toEqual([]);

      // Rule 1, followed through the whole pipeline. The one media event is a
      // hash and an operator verdict, and the serialized report holds no data
      // uri, no long base64 run and no key that could carry a file.
      expect(report.mediaHashes).toEqual([
        {
          sha256: MEDIA_SHA256,
          hashType: "SHA256",
          operatorVerdict: "no_match",
          operatorScanner: "PhotoDNA run by the provider",
          fileViewedByEsp: false,
          exifViewedByEsp: false,
          bytesHeldByOperator: true,
        },
      ]);
      const serialized = JSON.stringify(report);
      expect(/data:(image|video|application\/octet-stream)/i.test(serialized)).toBe(false);
      expect(/[A-Za-z0-9+/]{512,}={0,2}/.test(serialized)).toBe(false);
      expect(keysAnywhere(report).filter((k) => BYTE_BEARING_KEYS.has(k))).toEqual([]);

      // 18 USC 2258A(h): one year of preservation from submission.
      const submittedAt = new Date(report.builtAt);
      const until = preserveUntil(submittedAt);
      expect(until.getUTCFullYear()).toBe(submittedAt.getUTCFullYear() + 1);
    },
    STEP_TIMEOUT_MS,
  );

  it(
    "queues the tier as a durable delivery and backs off on an endpoint that will not take it",
    async () => {
      const store = new PrismaDeliveryStore(db as never);
      const actorUid = hashUid(adultUid, idSalt);
      const targetUid = hashUid(childUid, idSalt);

      const queued = await enqueueDelivery(store, {
        customerId,
        kind: "tier.assigned",
        url: `https://webhook.invalid/${run}`,
        payload: {
          event: "tier.assigned",
          customerId,
          actorUid,
          targetUid,
          tier: "T3",
          rationale: ["reviewer confirmed the pair after reading the timeline"],
          criticalSignals: [],
          versions: {
            modelVersion: "kernel-v0",
            lexiconVersion: "v2",
            fusionVersion: "rules-v2",
          },
          scoredAt: new Date(),
        },
      });
      deliveryId = queued.id;
      expect(queued.status).toBe("pending");
      expect(queued.attempt).toBe(0);
      // A delivery carrying a reviewer-confirmed T3 is under the same
      // preservation duty as the rest of the case.
      expect(queued.retention).toBe("CASE_1Y");
      // The row holds the tier and the two salted hashes. There is no column
      // for message text and nothing put any on it.
      expect(keysAnywhere(queued.payload).filter((k) => BYTE_BEARING_KEYS.has(k))).toEqual([]);

      // The real target check runs immediately before every request, against
      // the address the name resolves to at that moment rather than the one it
      // resolved to when the operator saved it. webhook.invalid does not
      // resolve, so the row is dead with no request made and nothing signed.
      const refused = await attemptDelivery(store, queued, {
        fetchImpl: async () => {
          throw new Error("the delivery worker must not reach a refused target");
        },
        secretFor: () => "whsec_integration_run",
      });
      expect({ status: refused.status, error: refused.error }).toEqual({
        status: "dead",
        error: "target_refused",
      });
      const revived = await store.requeue(queued.id, new Date());
      expect(revived).not.toBeNull();

      // Equal jitter with the random half pinned to zero, so the schedule is
      // the nominal wait halved: 500ms, 1s, 2s. The target check is injected
      // for the rest of this test, because the schedule is what is under test.
      const refusing: typeof fetch = async () => new Response("busy", { status: 503 });
      const delays: number[] = [];
      let current = revived!;
      for (let i = 0; i < 3; i += 1) {
        const outcome = await attemptDelivery(store, current, {
          fetchImpl: refusing,
          checkTarget: () => ({ ok: true }),
          secretFor: () => "whsec_integration_run",
          rand: () => 0,
        });
        expect(outcome.status).toBe("failed");
        delays.push(outcome.delayMs);
        const next = await store.get(queued.id);
        expect(next).not.toBeNull();
        current = next!;
      }
      expect(delays).toEqual([500, 1_000, 2_000]);
      expect({
        attempt: current.attempt,
        status: current.status,
        code: current.lastStatusCode,
        error: current.lastError,
      }).toEqual({ attempt: 3, status: "failed", code: 503, error: "http_503" });

      // A 2xx on the next attempt settles it, and nothing is retried after.
      const accepting: typeof fetch = async () => new Response(null, { status: 204 });
      const done = await attemptDelivery(store, current, {
        fetchImpl: accepting,
        checkTarget: () => ({ ok: true }),
        secretFor: () => "whsec_integration_run",
        rand: () => 0,
      });
      expect({ status: done.status, delay: done.delayMs }).toEqual({
        status: "delivered",
        delay: 0,
      });
      const settled = await store.get(queued.id);
      expect(settled?.deliveredAt).toBeInstanceOf(Date);
    },
    STEP_TIMEOUT_MS,
  );

  it(
    "exports this run's slice of the audit chain and verifies it with nothing but the artifact",
    async () => {
      const artifact = await exportChain(new PrismaAuditStore(db), {
        customerId,
        fromSeq: seqBefore + 1,
        producedBy: "scripts/integration/e2e.test.ts",
        purpose: "Phase 3 integration: prove an export verifies away from Guardian.",
        keyCustodian: "the operator's named custodian",
      });

      expect(artifact.header.scope).toMatchObject({
        customerId,
        crossCustomer: false,
      });
      expect(artifact.header.range.fromSeq).toBe(seqBefore + 1);
      // The chain key is what a verifier needs, and it is never in the artifact.
      expect(JSON.stringify(artifact)).not.toContain(AUDIT_SECRET ?? "");

      const verdict = verifyExport(artifact, AUDIT_SECRET ?? "");
      expect(verdict.ok ? null : `${verdict.reason} at ${verdict.brokenAt}`).toBeNull();

      // flatMap rather than filter: isWithheld narrows to the withheld case, so
      // the ternary is what tells the compiler these rows carry a payload.
      const mine = artifact.entries.flatMap((row) => (isWithheld(row) ? [] : [row]));
      for (const row of mine) expect(row.customerId).toBe(customerId);
      // Rule 8: a row inside the range belonging to somebody else is present as
      // a position and a hash so the links still check, and as nothing else.
      for (const row of artifact.entries.filter(isWithheld)) {
        expect(Object.keys(row).sort()).toEqual(["hash", "prevHash", "seq", "withheld"]);
      }

      const kinds = new Set(mine.map((row) => row.kind));
      expect(kinds.has("event.ingested")).toBe(true);
      expect(kinds.has("score.assigned")).toBe(true);
      expect(kinds.has("evidence.read")).toBe(true);
      expect(kinds.has("review.decision")).toBe(true);

      // The version triple is the auditor's first question, so it is in the
      // header rather than only inside the rows.
      expect(artifact.header.versions.length).toBeGreaterThan(0);
    },
    STEP_TIMEOUT_MS,
  );

});
