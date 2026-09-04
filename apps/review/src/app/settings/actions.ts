"use server";

import { revalidatePath } from "next/cache";
import { findAccusations, lexiconSchema } from "@guardian/schema";
import { requireRole, requireSession } from "@/lib/auth";
import { appendAudit } from "@/lib/data/audit";
import { getLexiconExtension, updateLexiconExtension } from "@/lib/data/settings";
import {
  assertExtensionMerges,
  baseLexicon,
  isPhraseField,
  LIMIT_FLOORS,
  ORG_DEFAULT_LIMITS,
  readExtension,
  sendTestDelivery,
  setSessionLimits,
  setWebhookUrl,
} from "./data";
import type {
  LexiconState,
  SessionLimits,
  SessionLimitsState,
  TestDeliveryState,
  WebhookState,
} from "./types";

/**
 * Every write on this page goes through one of these. Each one takes the
 * session from the cookie rather than from the form, so a posted customer id or
 * reviewer id is ignored.
 */

const ATTESTATION =
  "This change was made on our own initiative and not at the direction of a law enforcement request.";

/* ------------------------------------------------------------------ limits */

/** The wellness controls move one way only (DESIGN-UI 11). */
function readLimits(formData: FormData): SessionLimits | string {
  const budget = Number(formData.get("sessionBudgetMinutes"));
  const microBreak = Number(formData.get("microBreakMinutes"));
  const cases = Number(formData.get("casesPerHour"));
  const collapse = formData.get("collapseProtectedSpans") === "on";

  if (!Number.isInteger(budget) || !Number.isInteger(microBreak) || !Number.isInteger(cases)) {
    return "Each limit has to be a whole number of minutes or cases.";
  }
  if (budget > ORG_DEFAULT_LIMITS.sessionBudgetMinutes) {
    return `You can lower the session budget below ${ORG_DEFAULT_LIMITS.sessionBudgetMinutes} minutes, not raise it.`;
  }
  if (microBreak > ORG_DEFAULT_LIMITS.microBreakMinutes) {
    return `You can shorten the micro-break interval below ${ORG_DEFAULT_LIMITS.microBreakMinutes} minutes, not lengthen it.`;
  }
  if (cases > ORG_DEFAULT_LIMITS.casesPerHour) {
    return `You can lower the cases per hour below ${ORG_DEFAULT_LIMITS.casesPerHour}, not raise it.`;
  }
  if (budget < LIMIT_FLOORS.sessionBudgetMinutes) {
    return `The session budget cannot go below ${LIMIT_FLOORS.sessionBudgetMinutes} minutes.`;
  }
  if (microBreak < LIMIT_FLOORS.microBreakMinutes) {
    return `The micro-break interval cannot go below ${LIMIT_FLOORS.microBreakMinutes} minutes.`;
  }
  if (cases < LIMIT_FLOORS.casesPerHour) {
    return `Cases per hour cannot go below ${LIMIT_FLOORS.casesPerHour}.`;
  }
  if (!collapse && ORG_DEFAULT_LIMITS.collapseProtectedSpans) {
    return "Collapsing protected spans can be turned on and never off.";
  }
  return {
    sessionBudgetMinutes: budget,
    microBreakMinutes: microBreak,
    casesPerHour: cases,
    collapseProtectedSpans: collapse,
  };
}

export async function updateSessionLimitsAction(
  _previous: SessionLimitsState,
  formData: FormData,
): Promise<SessionLimitsState> {
  const session = await requireSession();
  const limits = readLimits(formData);
  if (typeof limits === "string") return { error: limits, message: null };

  setSessionLimits(session, limits);
  revalidatePath("/settings");
  return {
    error: null,
    message: `Saved. ${limits.sessionBudgetMinutes} minutes of case time a day, a break every ${limits.microBreakMinutes} minutes.`,
  };
}

/* ----------------------------------------------------------------- lexicon */

const MAX_PHRASE_LENGTH = 80;
const MAX_PHRASES_PER_SAVE = 25;

export async function addLexiconPhrasesAction(
  _previous: LexiconState,
  formData: FormData,
): Promise<LexiconState> {
  const session = await requireRole("operator");

  const field = String(formData.get("field") ?? "");
  if (!isPhraseField(field)) {
    return {
      error: "Pick one of the phrase lists before saving.",
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }
  if (formData.get("attestation") !== "on") {
    return {
      error: `Confirm the change-origin line before saving. ${ATTESTATION}`,
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }

  const base = baseLexicon();
  const existing = readExtension(await getLexiconExtension(session));
  const already = new Set(
    [...base[field], ...(existing[field] ?? [])].map((phrase) => phrase.toLowerCase()),
  );

  const raw = String(formData.get("phrases") ?? "");
  const candidates: string[] = [];
  for (const line of raw.split("\n")) {
    const phrase = line.trim().replace(/\s+/g, " ");
    if (phrase.length === 0) continue;
    if (phrase.length > MAX_PHRASE_LENGTH) {
      return {
        error: `"${phrase.slice(0, 40)}" is longer than ${MAX_PHRASE_LENGTH} characters. The lexicon matches phrases, not paragraphs.`,
        offendingFragment: null,
        instead: null,
        message: null,
      };
    }
    // The strings a customer adds are the half that ships without review, so
    // they pass the wording guard at write time (DESIGN-UI 5.8).
    const findings = findAccusations(phrase);
    if (findings.length > 0) {
      const first = findings[0]!;
      return {
        error: `"${phrase}" was refused: it ${first.why}. Guardian never labels a person.`,
        offendingFragment: first.match,
        instead: first.instead,
        message: null,
      };
    }
    if (already.has(phrase.toLowerCase())) continue;
    already.add(phrase.toLowerCase());
    candidates.push(phrase);
  }

  if (candidates.length === 0) {
    return {
      error: "Nothing new to add. Every phrase in the box is already on that list.",
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }
  if (candidates.length > MAX_PHRASES_PER_SAVE) {
    return {
      error: `That is ${candidates.length} phrases. Save at most ${MAX_PHRASES_PER_SAVE} at a time so each one is reviewable.`,
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }

  const next = { ...existing, [field]: [...(existing[field] ?? []), ...candidates] };

  // Two checks, in order: the extension parses on its own, and it still merges
  // into a lexicon the kernel can load.
  const parsed = lexiconSchema.partial().safeParse(next);
  if (!parsed.success) {
    return {
      error: `That extension does not match the lexicon schema: ${parsed.error.issues[0]?.message ?? "unknown reason"}.`,
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }
  let mergedVersion: string;
  try {
    mergedVersion = assertExtensionMerges(session, next);
  } catch (err) {
    return {
      error: `The merge failed, so nothing was saved: ${err instanceof Error ? err.message : String(err)}.`,
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }

  await updateLexiconExtension(session, next);
  await appendAudit(session, {
    kind: "lexicon.updated",
    payload: {
      action: "phrases.added",
      field,
      added: candidates,
      baseVersion: base.version,
      mergedVersion,
      reviewerId: session.reviewerId,
      changeOrigin: ATTESTATION,
    },
  });

  revalidatePath("/settings");
  return {
    error: null,
    offendingFragment: null,
    instead: null,
    message: `Added ${candidates.length} ${candidates.length === 1 ? "phrase" : "phrases"}. Scores now record lexicon ${mergedVersion}.`,
  };
}

/** Removes a phrase this customer added. Base entries are never touched. */
export async function removeLexiconPhraseAction(
  _previous: LexiconState,
  formData: FormData,
): Promise<LexiconState> {
  const session = await requireRole("operator");
  const field = String(formData.get("field") ?? "");
  const phrase = String(formData.get("phrase") ?? "");
  if (!isPhraseField(field) || phrase.length === 0) {
    return {
      error: "That phrase is no longer on the list.",
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }

  const existing = readExtension(await getLexiconExtension(session));
  const kept = (existing[field] ?? []).filter((item) => item !== phrase);
  if (kept.length === (existing[field] ?? []).length) {
    return {
      error: "That phrase is no longer on the list.",
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }

  const next = { ...existing, [field]: kept };
  if (kept.length === 0) delete next[field];
  const mergedVersion = assertExtensionMerges(session, next);

  await updateLexiconExtension(session, next);
  await appendAudit(session, {
    kind: "lexicon.updated",
    payload: {
      action: "phrase.removed",
      field,
      removed: phrase,
      baseVersion: baseLexicon().version,
      mergedVersion,
      reviewerId: session.reviewerId,
      changeOrigin: ATTESTATION,
    },
  });

  revalidatePath("/settings");
  return {
    error: null,
    offendingFragment: null,
    instead: null,
    message: `Removed one phrase from ${field}. Base entries are unaffected.`,
  };
}

/* ----------------------------------------------------------------- webhook */

export async function updateWebhookUrlAction(
  _previous: WebhookState,
  formData: FormData,
): Promise<WebhookState> {
  const session = await requireRole("operator");
  const raw = String(formData.get("url") ?? "").trim();

  if (raw.length === 0) {
    await setWebhookUrl(session, null);
    revalidatePath("/settings");
    return { error: null, message: "Cleared. Tier events are not being delivered anywhere." };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "That is not a URL. It needs a scheme and a host.", message: null };
  }
  if (url.protocol !== "https:") {
    return { error: "The endpoint has to be https. Tier events are not sent in the clear.", message: null };
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return {
      error:
        "Drop the query string and the fragment. Nothing about a pair belongs in a URL, so Guardian will not store one that carries parameters.",
      message: null,
    };
  }

  await setWebhookUrl(session, url.toString());
  revalidatePath("/settings");
  return { error: null, message: `Saved. Tier events will be posted to ${url.host}.` };
}

// useActionState hands every action a previous state and a form. This one reads
// neither: the button carries no fields, and the outcome is built fresh.
export async function sendTestDeliveryAction(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _previous: TestDeliveryState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<TestDeliveryState> {
  const session = await requireRole("operator");
  const outcome = await sendTestDelivery(session);

  if (!outcome.attempted) {
    return {
      error: outcome.error ?? "Nothing was sent.",
      message: null,
      sample: outcome.sample,
      attempted: false,
    };
  }
  if (!outcome.delivered) {
    return {
      error: outcome.status
        ? `Your endpoint answered ${outcome.status}. Guardian treats anything outside 2xx as a failed delivery and retries a real event.`
        : `The request did not complete: ${outcome.error ?? "no response"}.`,
      message: null,
      sample: outcome.sample,
      attempted: true,
    };
  }
  return {
    error: null,
    message: `Your endpoint answered ${outcome.status}. The signature header it verified was built the same way a real tier event is.`,
    sample: outcome.sample,
    attempted: true,
  };
}
