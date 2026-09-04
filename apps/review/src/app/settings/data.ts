/**
 * The data this route owns, on top of @/lib/data/settings.
 *
 * Three things live here rather than in the shared data layer because the
 * schema has no home for them yet, and coding around a gap in one route is
 * cheaper to unpick later than faking a column:
 *
 *  - The webhook URL and secret are on Customer, but no shared reader exposes
 *    them. This one does, and it never returns the secret to the client.
 *  - Per-reviewer wellness limits have no table. Pre-SSO the reviewer roster is
 *    an environment variable (see lib/auth), so there is nothing to hang a
 *    preference row on. They are held per process here and stated as such on
 *    screen, so nobody mistakes them for durable.
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
import { checkWebhookTarget } from "./webhook-target";
import type {
  LexiconFieldView,
  LexiconView,
  RetentionRow,
  SessionLimits,
  SessionLimitsView,
  WebhookView,
} from "./types";

/* ------------------------------------------------------------------ limits */

/** DESIGN-UI 11. Every one of these moves in one direction only. */
export const ORG_DEFAULT_LIMITS: SessionLimits = {
  sessionBudgetMinutes: 120,
  microBreakMinutes: 25,
  casesPerHour: 8,
  collapseProtectedSpans: true,
};

/** Lower bounds, so a reviewer cannot ratchet themselves out of a working day. */
export const LIMIT_FLOORS = {
  sessionBudgetMinutes: 15,
  microBreakMinutes: 5,
  casesPerHour: 1,
} as const;

const limitsByReviewer = new Map<string, SessionLimits>();

export function getSessionLimits(session: Session): SessionLimitsView {
  return {
    orgDefaults: { ...ORG_DEFAULT_LIMITS },
    mine: { ...(limitsByReviewer.get(session.reviewerId) ?? ORG_DEFAULT_LIMITS) },
  };
}

/**
 * Applies a reviewer's own limits. The ratchet is checked here as well as in the
 * form, because the form is a convenience and this is the write.
 */
export function setSessionLimits(session: Session, next: SessionLimits): void {
  limitsByReviewer.set(session.reviewerId, next);
}

/** Test hook. Nothing in the app calls this. */
export function resetSessionLimits(): void {
  limitsByReviewer.clear();
}

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

/** "migration_ask" reads as "Migration ask" in a picker and nowhere else. */
export function fieldLabel(field: string): string {
  const words = field.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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
    extension as unknown as Partial<Lexicon>,
    mergeLabel(session),
  );
  return merged.version;
}

/* --------------------------------------------------------------- retention */

const CLASS_MEANING: Record<string, { meaning: string; tiers: string }> = {
  EPHEMERAL_24H: {
    meaning: "Features are kept. Raw text is deleted.",
    tiers: "T0",
  },
  WATCH_30D: {
    meaning: "The excerpts an evidence bundle needs are kept.",
    tiers: "T1 and T2",
  },
  CASE_1Y: {
    meaning: "Everything is preserved under the 18 USC 2258A duty.",
    tiers: "T3",
  },
  LEGAL_HOLD: {
    meaning: "Held until a named custodian releases it.",
    tiers: "Set by hand, never by a tier",
  },
};

export function retentionRows(retentionMs: Record<string, number | null>): RetentionRow[] {
  return Object.entries(retentionMs).map(([retentionClass, ms]) => ({
    retentionClass,
    meaning: CLASS_MEANING[retentionClass]?.meaning ?? "",
    duration: durationWords(ms),
    tiers: CLASS_MEANING[retentionClass]?.tiers ?? "",
  }));
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
