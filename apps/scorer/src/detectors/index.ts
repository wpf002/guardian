import type { AgeBand, Lexicon, SignalKind, Stage } from "@guardian/schema";
import { normalize, type NormalizedText } from "@guardian/schema";
import {
  findHandoffs,
  findPatterns,
  findPaymentEntity,
  findPhrases,
  findPlatformMove,
  type Match,
} from "./entities.js";
import type { ScriptIndex } from "./minhash.js";

/**
 * Phase 1 detection is rules over the versioned lexicon plus the script index.
 * The stage classifier lands in phase 2 (CLAUDE.md build order) and will feed
 * `stageProbs` alongside these hits rather than replace them: the reviewer
 * needs to see which concrete phrase fired, not only a probability.
 *
 * A detector reports what it saw. It does not decide what it means. Gating on
 * age gap, direction, and asymmetry happens in the pair scorer, because the
 * same phrase between two 14 year olds is not the same event as the same phrase
 * from an adult to a 10 year old (DESIGN.md 5, false-positive traps).
 */

export interface Detection {
  kind: SignalKind;
  stage: Stage;
  /** Base weight before gating. */
  weight: number;
  matched: string;
  excerpt: string;
  /** Extra facts the pair scorer or reviewer needs. */
  meta?: Record<string, unknown>;
}

export interface DetectContext {
  lexicon: Lexicon;
  scripts?: ScriptIndex;
  actorBand: AgeBand;
  targetBand: AgeBand;
  /** Similarity above which a message counts as a known script. */
  scriptThreshold?: number;
}

/** Weights from DESIGN.md 5. Critical signals also trip the tier override. */
export const BASE_WEIGHT = {
  high: 1.0,
  med: 0.6,
  crit: 3.0,
} as const;

interface Rule {
  kind: SignalKind;
  stage: Stage;
  weight: number;
  field: keyof Pick<
    Lexicon,
    | "supervision_probe"
    | "secrecy"
    | "economic_bait"
    | "age_relationship_framing"
    | "image_solicitation"
    | "meetup_logistics"
    | "migration_ask"
    | "trafficking_recruitment"
  >;
}

const PHRASE_RULES: Rule[] = [
  { kind: "supervision_probe", stage: "probe", weight: BASE_WEIGHT.high, field: "supervision_probe" },
  { kind: "off_platform_migration", stage: "migrate", weight: BASE_WEIGHT.high, field: "migration_ask" },
  { kind: "secrecy_instruction", stage: "migrate", weight: BASE_WEIGHT.high, field: "secrecy" },
  { kind: "economic_bait", stage: "trust", weight: BASE_WEIGHT.med, field: "economic_bait" },
  {
    kind: "age_relationship_framing",
    stage: "sexualize",
    weight: BASE_WEIGHT.high,
    field: "age_relationship_framing",
  },
  { kind: "image_solicitation", stage: "sexualize", weight: BASE_WEIGHT.high, field: "image_solicitation" },
  { kind: "meetup_logistics", stage: "coerce", weight: BASE_WEIGHT.crit, field: "meetup_logistics" },
  {
    kind: "economic_bait",
    stage: "trust",
    weight: BASE_WEIGHT.med,
    field: "trafficking_recruitment",
  },
];

export function detectMessage(text: string, ctx: DetectContext): {
  normalized: NormalizedText;
  detections: Detection[];
} {
  const normalized = normalize(text, ctx.lexicon);
  return { normalized, detections: detectNormalized(normalized, ctx) };
}

export function detectNormalized(n: NormalizedText, ctx: DetectContext): Detection[] {
  const out: Detection[] = [];
  const lex = ctx.lexicon;

  for (const rule of PHRASE_RULES) {
    for (const match of findPhrases(n, lex[rule.field])) {
      out.push(toDetection(rule.kind, rule.stage, rule.weight, match, { field: rule.field }));
    }
  }

  // "talk to me on telegram" carries no listed phrase but is the same ask.
  for (const match of findPlatformMove(n, lex)) {
    out.push(toDetection("off_platform_migration", "migrate", BASE_WEIGHT.high, match));
  }

  // A platform name plus a handle is a concrete handoff, not just chat about apps.
  for (const match of findHandoffs(n, lex)) {
    out.push(
      toDetection("off_platform_migration", "migrate", BASE_WEIGHT.high, match, {
        concrete_handoff: true,
      }),
    );
  }

  // Threat templates: exact phrases first, then near-duplicate script match.
  for (const match of findPhrases(n, lex.threat_templates)) {
    out.push(toDetection("threat_template", "coerce", BASE_WEIGHT.crit, match, { exact: true }));
  }
  for (const match of findPatterns(n, lex.countdown_patterns)) {
    out.push(toDetection("threat_template", "coerce", BASE_WEIGHT.crit, match, { countdown: true }));
  }
  if (ctx.scripts && n.normalized.length >= 20) {
    const hit = ctx.scripts.query(n.normalized, ctx.scriptThreshold ?? 0.35);
    if (hit) {
      out.push({
        kind: "threat_template",
        stage: "coerce",
        weight: BASE_WEIGHT.crit,
        matched: `script:${hit.id} (${hit.label})`,
        excerpt: n.original.slice(0, 280),
        meta: { similarity: Number(hit.similarity.toFixed(3)), scriptId: hit.id },
      });
    }
  }

  // Payment entities. On their own these are only economic signals; the
  // temporal join in the pair scorer is what makes them critical.
  const payment = findPaymentEntity(n, lex);
  if (payment) {
    out.push(
      toDetection("economic_bait", "coerce", BASE_WEIGHT.med, payment.match, {
        payment_entity: true,
        via: payment.via,
        amounts: payment.amounts,
      }),
    );
  }

  return dedupe(out);
}

function toDetection(
  kind: SignalKind,
  stage: Stage,
  weight: number,
  match: Match,
  meta: Record<string, unknown> = {},
): Detection {
  return {
    kind,
    stage,
    weight,
    matched: match.matched,
    excerpt: match.excerpt,
    meta: { ...meta, form: match.form },
  };
}

/**
 * One message that says "add me on snap, my snap is x" should count once.
 * Keeping the highest-weight hit per kind preserves the strongest evidence.
 */
function dedupe(detections: Detection[]): Detection[] {
  const best = new Map<string, Detection>();
  for (const d of detections) {
    const key = `${d.kind}:${d.stage}`;
    const existing = best.get(key);
    if (!existing || d.weight > existing.weight) best.set(key, d);
  }
  return [...best.values()];
}

/**
 * Rule-based stage estimate for phase 1. Returns the highest stage any detector
 * reached, which is what the trajectory scorer needs. Phase 2 replaces this
 * with the fine-tuned encoder's distribution.
 */
export function stageFromDetections(detections: Detection[]): Stage {
  const order: Stage[] = ["none", "contact", "trust", "probe", "migrate", "sexualize", "coerce"];
  let best = 0;
  for (const d of detections) {
    const idx = order.indexOf(d.stage);
    if (idx > best) best = idx;
  }
  return order[best]!;
}

export { ScriptIndex } from "./minhash.js";
export * from "./entities.js";
