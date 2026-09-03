import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { Kernel, MemoryKernelStore, ScriptIndex } from "@guardian/scorer";
import { loadScriptCorpus } from "@guardian/schema";
import {
  adultToMinorBenign,
  benign,
  evade,
  grooming,
  hardNegative,
  Rng,
  sextortion,
  teenRomance,
  trafficking,
  type Conversation,
} from "./generators.js";
import { confusionAt, median, runConversations, tierRank } from "./harness.js";

/**
 * The DESIGN.md section 10 suite. The base-rate simulation and the teen-romance
 * control are required before any threshold change merges (CLAUDE.md
 * conventions), so both return a hard pass or fail rather than a number to
 * squint at.
 *
 * What this suite is: a structural regression gate on the rule kernel. What it
 * is not: a measurement of production precision. Every public grooming dataset
 * is decoy-based and cannot be mirrored here, so the conversations are
 * generated from the documented case structures. The first honest precision
 * number comes from reviewer decisions on real traffic (DESIGN.md 12).
 */

export interface TestResult {
  name: string;
  pass: boolean;
  required: boolean;
  detail: string;
  metrics: Record<string, number | string | null>;
}

export interface SuiteResult {
  results: TestResult[];
  pass: boolean;
  requiredPass: boolean;
}

/**
 * `pnpm test` runs the suite in quick mode, about a tenth of the sample sizes,
 * so the required gates run on every change. `pnpm eval` runs the full sizes.
 */
export const QUICK = process.env.EVAL_QUICK === "1";
const scale = (n: number): number => (QUICK ? Math.max(20, Math.round(n / 10)) : n);

export async function runSuite(seed = 42): Promise<SuiteResult> {
  const results: TestResult[] = [
    await baseRateSimulation(seed),
    await teenRomanceControl(seed),
    await earlyWarningLatency(seed),
    await evasionRedTeam(seed),
    await sextortionScriptMatch(),
    await auditChainTamper(),
    await fanOutDetection(),
    await falsePositiveTraps(seed),
    await modelNeverEmitsT3(seed),
  ];

  return {
    results,
    pass: results.every((r) => r.pass),
    requiredPass: results.filter((r) => r.required).every((r) => r.pass),
  };
}

/**
 * Inject positives at 0.01% into a benign stream. PAN-12 is 3% positive; real
 * platforms are closer to 0.01%, and that gap is what wrecks naive thresholds
 * (DESIGN.md 6.4).
 *
 * The pass bar is T2 precision at or above 40%. Running a literal 0.01% base
 * rate needs 10,000 conversations per positive, so the harness runs a tractable
 * mix and reports the projected precision at the true base rate alongside the
 * measured one.
 */
async function baseRateSimulation(seed: number): Promise<TestResult> {
  const rng = new Rng(seed);
  const conversations: Conversation[] = [];
  const benignCount = scale(4000);
  const hardNegativeCount = scale(2000);
  const adultBenignCount = scale(500);
  const positiveCount = scale(40);

  for (let i = 0; i < benignCount; i++) conversations.push(benign(`b${i}`, rng));
  // Half the negative mass is the documented false-positive traps, because
  // ordinary small talk was never what threatened the queue.
  for (let i = 0; i < hardNegativeCount; i++) conversations.push(hardNegative(`h${i}`, rng));
  for (let i = 0; i < adultBenignCount; i++) conversations.push(adultToMinorBenign(`am${i}`, rng));
  for (let i = 0; i < positiveCount; i++) {
    const roll = rng.next();
    if (roll < 0.5) conversations.push(grooming(`g${i}`, rng));
    else if (roll < 0.8) conversations.push(sextortion(`s${i}`, rng));
    else conversations.push(trafficking(`t${i}`, rng));
  }

  const outcomes = await runConversations(conversations);
  const t2 = confusionAt(outcomes, "T2");

  // False positive rate on benign traffic is what projects to any base rate.
  const benignOutcomes = outcomes.filter((o) => !o.positive);
  const fpRate = t2.falsePositives / Math.max(1, benignOutcomes.length);
  const trueBaseRate = 0.0001;
  const projected =
    (trueBaseRate * t2.recall) / (trueBaseRate * t2.recall + (1 - trueBaseRate) * fpRate || 1e-9);

  const pass = t2.precision >= 0.4 && fpRate <= 0.002;

  return {
    name: "base-rate simulation",
    required: true,
    pass,
    detail: pass
      ? `T2 precision ${(t2.precision * 100).toFixed(1)}% with a ${(fpRate * 100).toFixed(3)}% false positive rate on benign pairs`
      : `T2 precision ${(t2.precision * 100).toFixed(1)}% (need 40%) and false positive rate ${(fpRate * 100).toFixed(3)}% (need 0.2% or lower)`,
    metrics: {
      benignConversations: benignOutcomes.length,
      hardNegatives: hardNegativeCount + adultBenignCount,
      positives: positiveCount,
      t2Precision: round(t2.precision),
      t2Recall: round(t2.recall),
      falsePositiveRatePerBenignPair: round(fpRate),
      projectedPrecisionAt0_01pct: round(projected),
    },
  };
}

/** Same-band romantic chat must stay out of the queue (DESIGN.md 10). */
async function teenRomanceControl(seed: number): Promise<TestResult> {
  const rng = new Rng(seed + 1);
  const conversations = Array.from({ length: scale(2000) }, (_, i) => teenRomance(`r${i}`, rng));
  const outcomes = await runConversations(conversations);

  const t2Count = outcomes.filter((o) => tierRank(o.peakTier) >= 2).length;
  const rate = t2Count / outcomes.length;
  const pass = rate <= 0.001;

  return {
    name: "teen-romance control",
    required: true,
    pass,
    detail: `${t2Count} of ${outcomes.length} same-band romantic conversations reached T2 (${(rate * 100).toFixed(3)}%, limit 0.1%)`,
    metrics: { conversations: outcomes.length, t2Count, t2Rate: round(rate) },
  };
}

/** Median messages to the first T1 on positives. Vogt 2021 protocol. */
async function earlyWarningLatency(seed: number): Promise<TestResult> {
  const rng = new Rng(seed + 2);
  const conversations = Array.from({ length: scale(200) }, (_, i) => grooming(`lg${i}`, rng));
  const outcomes = await runConversations(conversations);

  const latencies = outcomes
    .map((o) => o.messagesToT1)
    .filter((v): v is number => v !== null);
  const med = median(latencies);
  const detected = latencies.length / outcomes.length;
  const pass = med !== null && med <= 15 && detected >= 0.9;

  return {
    name: "early warning latency",
    required: false,
    pass,
    detail:
      med === null
        ? "no positive reached T1"
        : `median ${med} messages to first T1, ${(detected * 100).toFixed(1)}% of positives detected (limit 15 messages)`,
    metrics: { medianMessagesToT1: med, detectionRate: round(detected), samples: outcomes.length },
  };
}

/** Rewrite positives with emoji codes, leet and spacing. Recall drop 15 points or less. */
async function evasionRedTeam(seed: number): Promise<TestResult> {
  const rng = new Rng(seed + 3);
  const plain = Array.from({ length: scale(250) }, (_, i) => grooming(`eg${i}`, rng));
  const evaded = plain.map((c) => evade(c, rng));

  const plainOutcomes = await runConversations(plain);
  const evadedOutcomes = await runConversations(evaded);

  const plainRecall = confusionAt(plainOutcomes, "T2").recall;
  const evadedRecall = confusionAt(evadedOutcomes, "T2").recall;
  const drop = (plainRecall - evadedRecall) * 100;
  const pass = drop <= 15;

  return {
    name: "evasion red team",
    required: false,
    pass,
    detail: `T2 recall ${(plainRecall * 100).toFixed(1)}% plain, ${(evadedRecall * 100).toFixed(1)}% evaded, drop ${drop.toFixed(1)} points (limit 15)`,
    metrics: {
      plainRecall: round(plainRecall),
      evadedRecall: round(evadedRecall),
      dropPoints: round(drop),
    },
  };
}

/**
 * Script recall at or above 0.9, at or below 1 false positive per 100k
 * messages. Held-out variants are the corpus scripts with substitutions the
 * crews actually make.
 */
async function sextortionScriptMatch(): Promise<TestResult> {
  const corpus = loadScriptCorpus();
  const index = new ScriptIndex();
  for (const s of corpus.scripts) index.add(s.id, s.label, s.text);

  const variants = corpus.scripts.map((s) => ({
    id: s.id,
    text: s.text
      .replace(/\bdont\b/g, "do not")
      .replace(/\bi\b/g, "I")
      .replace(/\byou\b/g, "u")
      .replace(/\bmoney\b/g, "cash")
      .replace(/\bsend\b/g, "sending"),
  }));

  const matched = variants.filter((v) => index.query(v.text.toLowerCase(), 0.35)?.id === v.id).length;
  const recall = matched / variants.length;

  const rng = new Rng(99);
  const negatives: string[] = [];
  const negativeCount = scale(100_000);
  for (let i = 0; i < negativeCount; i++) {
    negatives.push(
      benign(`n${i}`, rng)
        .turns.map((t) => t.text)
        .join(" ")
        .slice(0, 200),
    );
  }
  const falsePositives = negatives.filter((n) => index.query(n, 0.35) !== null).length;

  const pass = recall >= 0.9 && falsePositives <= 1;

  return {
    name: "sextortion script match",
    required: false,
    pass,
    detail: `recall ${(recall * 100).toFixed(1)}% on reworded scripts, ${falsePositives} false positives in ${negatives.length} benign strings`,
    metrics: { recall: round(recall), falsePositives, negatives: negatives.length },
  };
}

/** Tamper a stored row. Verification must fail and name the row (DESIGN.md 10). */
async function auditChainTamper(): Promise<TestResult> {
  const store = new MemoryAuditStore();
  const log = new AuditLog(store, "eval-secret");
  for (let i = 0; i < 50; i++) {
    await log.append({ kind: "score.assigned", customerId: "cus_eval", payload: { i, tier: "T1" } });
  }

  store.tamper(23, (entry) => {
    entry.payload = { i: 22, tier: "T0" };
  });

  const verdict = await log.verify();
  const pass = !verdict.ok && verdict.brokenAt === 23;

  return {
    name: "audit chain tamper",
    required: true,
    pass,
    detail: verdict.ok
      ? "verification passed on a tampered chain, which is a failure"
      : `verification failed at row ${verdict.brokenAt}: ${verdict.detail}`,
    metrics: { entries: 50, brokenAt: verdict.ok ? null : verdict.brokenAt },
  };
}

/** One account opening conversations with many accounts in younger bands. */
async function fanOutDetection(): Promise<TestResult> {
  const rng = new Rng(7);
  const kernel = new Kernel({ store: new MemoryKernelStore() });
  const base = Date.parse("2026-09-02T00:00:00Z");

  // One actor contacts 60 different accounts in minor bands over three days.
  for (let target = 0; target < 60; target++) {
    for (let msg = 0; msg < 3; msg++) {
      await kernel.score({
        externalId: `f-${target}-${msg}`,
        customerId: "cus_eval",
        actorUid: "wide-actor",
        targetUid: `kid-${target}`,
        channel: "general",
        ts: new Date(base + target * 3_600_000 + msg * 60_000),
        text: msg === 1 ? "hey you seem cool, how old are you" : "hi",
        media: null,
        actorBand: "A21_PLUS",
        targetBand: "A9_12",
        actorRole: "unknown",
        actorAccountAgeHours: 48,
        deviceHints: null,
        provenance: { surface: "platform_sdk", sourceId: "eval" },
        retention: "EPHEMERAL_24H",
        expiresAt: new Date(base + 86_400_000),
      });
    }
  }

  const final = await kernel.score({
    externalId: "f-final",
    customerId: "cus_eval",
    actorUid: "wide-actor",
    targetUid: "kid-0",
    channel: "general",
    ts: new Date(base + 60 * 3_600_000),
    text: "are your parents home",
    media: null,
    actorBand: "A21_PLUS",
    targetBand: "A9_12",
    actorRole: "unknown",
    actorAccountAgeHours: 48,
    deviceHints: null,
    provenance: { surface: "platform_sdk", sourceId: "eval" },
    retention: "EPHEMERAL_24H",
    expiresAt: new Date(base + 86_400_000),
  });

  const fanOut = final?.result.actor.minorFanOut7d ?? 0;
  const contributed = (final?.result.actor.score ?? 0) > 0;
  const pass = fanOut >= 50 && contributed;
  void rng;

  return {
    name: "actor fan-out",
    required: false,
    pass,
    detail: `fan-out to ${fanOut} accounts in minor bands, actor score ${final?.result.actor.score ?? 0}`,
    metrics: { minorFanOut7d: fanOut, actorScore: final?.result.actor.score ?? 0 },
  };
}

/**
 * The false-positive traps from DESIGN.md 5, one class at a time. The point is
 * not only that these stay out of the queue but that they stay out for the
 * right reason: the detectors fire and the gates hold them down. A class where
 * nothing fires at all would pass this test while telling us nothing, so the
 * detection rate is asserted too.
 */
async function falsePositiveTraps(seed: number): Promise<TestResult> {
  const rng = new Rng(seed + 6);
  const classes: Array<{ name: string; build: (i: number) => Conversation }> = [
    { name: "peer_handle_swap", build: (i) => hardNegative(`ph${i}`, rng, "peer_handle_swap") },
    { name: "giveaway", build: (i) => hardNegative(`gv${i}`, rng, "giveaway") },
    { name: "family_talk", build: (i) => hardNegative(`ft${i}`, rng, "family_talk") },
    { name: "friend_plans", build: (i) => hardNegative(`fp${i}`, rng, "friend_plans") },
    { name: "adult_to_adult", build: (i) => hardNegative(`aa${i}`, rng, "adult_to_adult") },
    { name: "adult_moderator", build: (i) => adultToMinorBenign(`am${i}`, rng) },
  ];

  const metrics: Record<string, number | string | null> = {};
  const failures: string[] = [];
  const perClass = scale(300);

  for (const klass of classes) {
    const outcomes = await runConversations(Array.from({ length: perClass }, (_, i) => klass.build(i)));
    const t2 = outcomes.filter((o) => tierRank(o.peakTier) >= 2).length;
    const t1 = outcomes.filter((o) => o.peakTier === "T1").length;
    const fired = outcomes.filter((o) => o.stagesHit.length > 0 || o.peakTier !== "T0").length;

    metrics[`${klass.name}_t2`] = t2;
    metrics[`${klass.name}_t1`] = t1;
    metrics[`${klass.name}_exercised`] = round(fired / perClass);

    if (t2 > 0) failures.push(`${klass.name} put ${t2} conversations in the review queue`);
    // A class that never trips anything is not testing the gate.
    if (fired / perClass < 0.5) {
      failures.push(
        `${klass.name} exercised only ${((fired / perClass) * 100).toFixed(0)}% of the time, so the gate is untested`,
      );
    }
  }

  return {
    name: "false-positive traps",
    required: true,
    pass: failures.length === 0,
    detail:
      failures.length === 0
        ? `all ${classes.length} trap classes stayed out of the review queue while still exercising the detectors`
        : failures.join("; "),
    metrics,
  };
}

/** CLAUDE.md rule 6. The model tops out at T2 whatever the traffic looks like. */
async function modelNeverEmitsT3(seed: number): Promise<TestResult> {
  const rng = new Rng(seed + 5);
  const worst: Conversation[] = [
    ...Array.from({ length: scale(100) }, (_, i) => grooming(`w${i}`, rng, 1)),
    ...Array.from({ length: scale(100) }, (_, i) => sextortion(`ws${i}`, rng)),
    ...Array.from({ length: scale(100) }, (_, i) => trafficking(`wt${i}`, rng)),
  ];
  const outcomes = await runConversations(worst);
  const t3 = outcomes.filter((o) => o.peakTier === "T3").length;

  return {
    name: "model never emits T3",
    required: true,
    pass: t3 === 0,
    detail: t3 === 0 ? `0 of ${outcomes.length} conversations reached T3 from the model` : `${t3} conversations reached T3 without a reviewer`,
    metrics: { conversations: outcomes.length, t3Count: t3 },
  };
}

function round(value: number): number {
  return Number(value.toFixed(5));
}
