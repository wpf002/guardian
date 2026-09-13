/**
 * The data this route owns, on top of @/lib/data/settings.
 *
 * Two things live here rather than in the shared data layer because the schema
 * has no home for them yet, and coding around a gap in one route is cheaper to
 * unpick later than faking a column:
 *
 *  - The webhook URL and secret are on Customer, but no shared reader exposes
 *    them. This one does, and it never returns the secret to the client.
 *  - The lexicon view is assembled from the base file plus the customer
 *    extension. The merge label is the customer id, which is what the scorer
 *    uses, so the version string this page prints is the one a score row
 *    records.
 */

import {
  latestLexiconVersion,
  loadLexicon,
  mergeLexicon,
  PHRASE_FIELDS,
  signPayload,
  webhookPayloadSchema,
  type Lexicon,
  type WebhookPayload,
} from "@guardian/schema";
import type { Session } from "@/lib/auth";
import { getPrisma, isMockMode } from "@/lib/db";
import { getLexiconExtension } from "@/lib/data/settings";
import { checkWebhookTarget } from "@guardian/schema/webhook-target";
import type {
  LexiconFieldView,
  LexiconView,
  RetentionRow,
  WebhookView,
} from "./types";

/* ----------------------------------------------------------------- webhook */

/** Mock mode has no Customer row, so the URL lives here for the life of the process. */
const mockWebhookUrl = new Map<string, string | null>();

/** Never rendered, never returned to the client. Mock mode only. */
const MOCK_WEBHOOK_SECRET = "guardian-mock-webhook-secret-not-for-real-use";

export async function getWebhookView(session: Session): Promise<WebhookView> {
  if (isMockMode()) {
    return {
      url: mockWebhookUrl.get(session.customerId) ?? null,
      secretConfigured: true,
    };
  }
  const prisma = await getPrisma();
  const row = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: { webhookUrl: true, webhookSecret: true },
  });
  return {
    url: row?.webhookUrl ?? null,
    secretConfigured: Boolean(row?.webhookSecret),
  };
}

export async function setWebhookUrl(session: Session, url: string | null): Promise<void> {
  if (isMockMode()) {
    mockWebhookUrl.set(session.customerId, url);
    return;
  }
  const prisma = await getPrisma();
  await prisma.customer.update({
    where: { id: session.customerId },
    data: { webhookUrl: url },
  });
}

async function webhookSecret(session: Session): Promise<string | null> {
  if (isMockMode()) return MOCK_WEBHOOK_SECRET;
  const prisma = await getPrisma();
  const row = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: { webhookSecret: true },
  });
  return row?.webhookSecret ?? null;
}

/**
 * A sample tier event. Every identifier in it is the literal word example, so a
 * delivery that lands in a customer's log cannot be mistaken for a real pair,
 * and the rationale says what it is (RESEARCH 6.10 step 6).
 */
export function sampleWebhookPayload(session: Session, scoredAt = new Date()): WebhookPayload {
  return webhookPayloadSchema.parse({
    event: "tier.assigned",
    customerId: session.customerId,
    actorUid: "example-actor-not-a-real-account",
    targetUid: "example-target-not-a-real-account",
    tier: "T2",
    rationale: [
      "Example delivery from the Guardian settings page. No traffic was scored to produce it.",
    ],
    criticalSignals: [],
    versions: {
      modelVersion: "rules-v2",
      lexiconVersion: mergedLexiconVersion(session),
      fusionVersion: "rules-v2",
    },
    scoredAt,
  });
}

export interface TestDeliveryOutcome {
  attempted: boolean;
  delivered: boolean;
  /** True when the endpoint answered with a redirect, which is not a delivery. */
  redirected?: boolean;
  /**
   * Set only where the reason is Guardian's own configuration. A failure from
   * the far end never carries a status code or a transport error: the
   * difference between a refused connection, a timeout and a live service is a
   * host-and-port oracle for Guardian's private network.
   */
  error?: string;
  /** The body that was signed, pretty printed. */
  sample: string;
}

/**
 * Posts the sample payload to the configured URL, signed the same way the
 * scorer signs a real one (same headers, same HMAC over `timestamp.body`), so a
 * customer testing their verifier is testing the real thing.
 */
export async function sendTestDelivery(
  session: Session,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number } = {},
): Promise<TestDeliveryOutcome> {
  const payload = sampleWebhookPayload(session, new Date((opts.now ?? Date.now)()));
  const body = JSON.stringify(payload);
  const pretty = JSON.stringify(payload, null, 2);

  const view = await getWebhookView(session);
  if (!view.url) {
    return {
      attempted: false,
      delivered: false,
      error: "No webhook URL is set, so nothing was sent.",
      sample: pretty,
    };
  }
  const secret = await webhookSecret(session);
  if (!secret) {
    return {
      attempted: false,
      delivered: false,
      error: "This customer has no signing secret, so nothing was sent.",
      sample: pretty,
    };
  }
  if (isMockMode()) {
    return {
      attempted: false,
      delivered: false,
      error:
        "This deployment is running on fixtures, so no request left the machine. The body below is what would have been signed and sent.",
      sample: pretty,
    };
  }

  // Re-checked here and not only on the save, because a name that answered
  // publicly when it was stored can answer privately now.
  const target = await checkWebhookTarget(new URL(view.url));
  if (!target.ok) {
    return { attempted: false, delivered: false, error: target.reason, sample: pretty };
  }

  const timestamp = Math.floor((opts.now ?? Date.now)() / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  const send = opts.fetchImpl ?? fetch;
  try {
    const res = await send(view.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-guardian-timestamp": String(timestamp),
        "x-guardian-signature": signPayload(body, secret, timestamp),
      },
      body,
      // Manual, so a first hop that answers 302 cannot walk this request onto
      // plain http or onto an address the https check never saw, carrying the
      // customer's signature headers with it.
      redirect: "manual",
      signal: controller.signal,
    });
    // A redirect is not a delivery. It also is not an endpoint answering, so it
    // says so in its own words rather than reporting a status.
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      return {
        attempted: true,
        delivered: false,
        redirected: true,
        sample: pretty,
      };
    }
    return { attempted: true, delivered: res.ok, sample: pretty };
  } catch {
    // Deliberately not the underlying error. The exact failure mode separates a
    // refused connection from a timeout from a live service, which turns this
    // button into a scanner for whatever Guardian's own network can reach.
    return { attempted: true, delivered: false, sample: pretty };
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------------------------------------------- lexicon */

/** The merge label the scorer uses, so the version string here is the real one. */
export function mergeLabel(session: Session): string {
  return session.customerId;
}

export function mergedLexiconVersion(session: Session): string {
  return `${latestLexiconVersion()}+${mergeLabel(session)}`;
}

/*
 * Each phrase list, named for what is in it, checked against lexicon v3.
 *
 * The picker showed the field names with underscores turned into spaces:
 * "Coercion mark qualifier", "Supervision probe", "Economic bait". Somebody
 * adding their server's slang has to know which list it belongs in, and none
 * of those names says.
 */
const FIELD_WORDS: Record<string, string> = {
  platforms: "Other apps, like Snapchat or Telegram",
  migration_ask: "Asking to move to another app",
  supervision_probe: "Asking whether anyone is watching",
  secrecy: "Keeping it secret",
  economic_bait: "Offering free things, like Robux or gift cards",
  payment_platforms: "Payment apps, like Cash App",
  payment_verbs: "Asking to be paid",
  payment_demand: "Demanding money",
  age_relationship_framing: "Talk about age or dating",
  image_solicitation: "Asking for pictures",
  threat_templates: "Threats",
  meetup_logistics: "Planning to meet in person",
  trafficking_recruitment: "Offers of money, work or a place to stay",
  coercion_selfharm_directive: "Telling someone to hurt themselves",
  coercion_mark_directive: "Telling someone to cut or write a name on their body",
  coercion_mark_noun: "Words for a name cut or written on the body",
  coercion_mark_qualifier: "Whose name, like \"with my name\"",
  coercion_compliance_demand: "Demanding proof",
};

export function fieldLabel(field: string): string {
  const words = FIELD_WORDS[field];
  if (words) return words;
  const fallback = field.split("_").join(" ");
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

export function isPhraseField(value: string): value is (typeof PHRASE_FIELDS)[number] {
  return (PHRASE_FIELDS as readonly string[]).includes(value);
}

export function baseLexicon(): Lexicon {
  return loadLexicon();
}

/** The customer's extension, narrowed to the phrase fields it is allowed to add to. */
export function readExtension(raw: Record<string, unknown> | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw) return out;
  for (const field of PHRASE_FIELDS) {
    const value = raw[field];
    if (!Array.isArray(value)) continue;
    const phrases = value.filter((item): item is string => typeof item === "string");
    if (phrases.length > 0) out[field] = phrases;
  }
  return out;
}

export async function getLexiconView(session: Session): Promise<LexiconView> {
  const base = baseLexicon();
  const extension = readExtension(await getLexiconExtension(session));

  const fields: LexiconFieldView[] = PHRASE_FIELDS.map((field) => ({
    field,
    label: fieldLabel(field),
    added: extension[field] ?? [],
    baseCount: base[field].length,
  }));

  return {
    baseVersion: base.version,
    mergedVersion: `${base.version}+${mergeLabel(session)}`,
    fields,
    addedTotal: fields.reduce((total, row) => total + row.added.length, 0),
  };
}

/**
 * Proves the extension still merges into a valid lexicon before it is stored.
 * Throws with the zod message, which the action turns into a sentence.
 */
export function assertExtensionMerges(
  session: Session,
  extension: Record<string, string[]>,
): string {
  const merged = mergeLexicon(
    baseLexicon(),
    extension,
    mergeLabel(session),
  );
  return merged.version;
}

/* --------------------------------------------------------------- retention */

/*
 * What each kind of record is, in words, and what happens to it.
 *
 * The table printed EPHEMERAL_24H and WATCH_30D, which tiers each applied to,
 * and "preserved under the 18 USC 2258A duty". A person checking how long
 * their members' messages are kept needs the four answers and nothing else.
 */
/*
 * Each kind of record and how long it stays, as two short values.
 *
 * It printed EPHEMERAL_24H and the tiers each class covered, then became a
 * sentence per class ("Messages are deleted after 24 hours."). A person
 * checking retention is reading a duration off a list, so the duration is the
 * value and the label says what it applies to.
 */
const CLASS_LABEL: Record<string, string> = {
  EPHEMERAL_24H: "Nothing stood out",
  WATCH_30D: "Being watched or waiting for a look",
  CASE_1Y: "Reported",
  LEGAL_HOLD: "Put on hold by your team",
};

export function retentionRows(retentionMs: Record<string, number | null>): RetentionRow[] {
  return Object.entries(retentionMs).map(([retentionClass, ms]) => {
    const duration = ms === null ? "Until released" : durationWords(ms);
    return {
      retentionClass,
      tiers: CLASS_LABEL[retentionClass] ?? retentionClass,
      duration,
      meaning: duration,
    };
  });
}

export function durationWords(ms: number | null): string {
  if (ms === null) return "No expiry";
  const hours = ms / (60 * 60 * 1000);
  // The T0 rule is written as 24 hours everywhere else in the product, so it
  // reads as 24 hours here rather than as one day.
  if (hours <= 24) return `${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  if (days < 365) return days === 1 ? "1 day" : `${days} days`;
  const years = Math.round(days / 365);
  return years === 1 ? "1 year" : `${years} years`;
}
