"use server";

import { revalidatePath } from "next/cache";
import { findAccusations, lexiconSchema } from "@guardian/schema";
import { requireRole } from "@/lib/auth";
import { COUNTRY_CODES } from "@/lib/countries";
import { appendAudit } from "@/lib/data/audit";
import {
  getLexiconExtension,
  updateLexiconExtension,
  updateReportingDetails,
} from "@/lib/data/settings";
import {
  assertExtensionMerges,
  baseLexicon,
  isPhraseField,
  readExtension,
  sendTestDelivery,
  setWebhookUrl,
} from "./data";
import { checkWebhookTarget } from "@guardian/schema/webhook-target";
import type {
  LexiconState,
  ReportingState,
  TestDeliveryState,
  WebhookState,
} from "./types";

/**
 * Every write on this page goes through one of these. Each one takes the
 * session from the cookie rather than from the form, so a posted customer id or
 * reviewer id is ignored.
 */

const ATTESTATION = "This is our own decision. No police or government agency asked us to make it.";

/* ----------------------------------------------------------------- lexicon */

const MAX_PHRASE_LENGTH = 80;
const MAX_PHRASES_PER_SAVE = 25;

export async function addLexiconPhrasesAction(
  _previous: LexiconState,
  formData: FormData,
): Promise<LexiconState> {
  const session = await requireRole("operator");

  const field = formString(formData, "field");
  if (!isPhraseField(field)) {
    return {
      error: "Pick what kind of phrase this is.",
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }
  if (formData.get("attestation") !== "on") {
    return {
      error: `Check the box first: "${ATTESTATION}"`,
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

  const raw = formString(formData, "phrases");
  const candidates: string[] = [];
  for (const line of raw.split("\n")) {
    const phrase = line.trim().replace(/\s+/g, " ");
    if (phrase.length === 0) continue;
    if (phrase.length > MAX_PHRASE_LENGTH) {
      return {
        error: `"${phrase.slice(0, 40)}" is too long. Keep each phrase under ${MAX_PHRASE_LENGTH} characters.`,
        offendingFragment: null,
        instead: null,
        message: null,
      };
    }
    // The strings a customer adds are the half that ships without review, so
    // they pass the wording guard at write time (DESIGN-UI 5.8).
    const findings = findAccusations(phrase);
    if (findings.length > 0) {
      const first = findings[0];
      return {
        error: `"${phrase}" can't be added: it ${first.why}.`,
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
      error: "Those phrases are already on the list.",
      offendingFragment: null,
      instead: null,
      message: null,
    };
  }
  if (candidates.length > MAX_PHRASES_PER_SAVE) {
    return {
      error: `That's ${candidates.length} phrases. Add up to ${MAX_PHRASES_PER_SAVE} at a time.`,
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
      error: "Those phrases couldn't be saved. Try again, or add fewer at a time.",
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
      error: "Those phrases couldn't be saved. Nothing changed.",
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
    message: `Added ${candidates.length} ${candidates.length === 1 ? "phrase" : "phrases"}.`,
  };
}

/** Removes a phrase this customer added. Base entries are never touched. */
export async function removeLexiconPhraseAction(
  _previous: LexiconState,
  formData: FormData,
): Promise<LexiconState> {
  const session = await requireRole("operator");
  const field = formString(formData, "field");
  const phrase = formString(formData, "phrase");
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
    message: "Removed.",
  };
}

/* ----------------------------------------------------------------- webhook */

export async function updateWebhookUrlAction(
  _previous: WebhookState,
  formData: FormData,
): Promise<WebhookState> {
  const session = await requireRole("operator");
  const raw = formString(formData, "url").trim();

  if (raw.length === 0) {
    await setWebhookUrl(session, null);
    revalidatePath("/settings");
    return { error: null, message: "Cleared. Alerts won't be sent to your system." };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "That isn't a web address. It should start with https://.", message: null };
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return {
      error:
        "Drop the query string and the fragment. Nothing about a pair belongs in a URL, so Guardian will not store one that carries parameters.",
      message: null,
    };
  }
  // https, and a host that is actually on the public internet. Guardian's own
  // container makes this request, so an endpoint inside its network would make
  // this field a way to reach it.
  const target = await checkWebhookTarget(url);
  if (!target.ok) {
    return { error: target.reason, message: null };
  }

  await setWebhookUrl(session, url.toString());
  revalidatePath("/settings");
  return { error: null, message: `Saved. Alerts will be sent to ${url.host}.` };
}

// useActionState hands every action a previous state and a form. This one reads
// neither: the button carries no fields, and the outcome is built fresh.
export async function sendTestDeliveryAction(
  _previous: TestDeliveryState,
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
      // No status code and no transport error. Guardian makes this request from
      // its own network, so a precise failure would report on hosts and ports
      // the person pressing the button has no business enumerating.
      error: outcome.redirected
        ? "Your endpoint answered with a redirect. Guardian does not follow one on a delivery, because a redirect can move a signed request onto plain http or onto another host. Point the URL at the final endpoint."
        : "The delivery did not succeed. Guardian treats anything outside 2xx, and anything that does not complete, as a failed delivery and retries a real event.",
      message: null,
      sample: outcome.sample,
      attempted: true,
    };
  }
  return {
    error: null,
    message:
      "Your endpoint answered inside 2xx. The signature header it verified was built the same way a real tier event is.",
    sample: outcome.sample,
    attempted: true,
  };
}

/**
 * A form field, as a string.
 *
 * FormData.get returns a string or a File, and String(file) is
 * "[object File]": a filename-shaped value that passes every length check and
 * means nothing. A field that arrived as a file is not a field the caller
 * asked for, so it reads as absent.
 */
/* --------------------------------------------------------------- reporting */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Blank means not set, and is stored as null rather than as an empty string. */
function optional(form: FormData, name: string, max: number): string | null {
  const value = formString(form, name).trim();
  return value === "" ? null : value.slice(0, max);
}

export async function saveReportingDetailsAction(
  _previous: ReportingState,
  formData: FormData,
): Promise<ReportingState> {
  const session = await requireRole("owner");

  const contactEmail = optional(formData, "contactEmail", 200);
  if (contactEmail && !EMAIL.test(contactEmail)) {
    return { error: "That email address doesn't look right.", message: null };
  }
  const country = optional(formData, "country", 2)?.toUpperCase() ?? null;
  if (country && !COUNTRY_CODES.includes(country)) {
    return { error: "Pick a country from the list.", message: null };
  }
  const timezone = optional(formData, "timezone", 64);
  if (timezone && !Intl.supportedValuesOf("timeZone").includes(timezone)) {
    return { error: "Pick a time zone from the list.", message: null };
  }

  await updateReportingDetails(session, {
    organizationName: optional(formData, "organizationName", 120),
    contactName: optional(formData, "contactName", 120),
    contactEmail,
    country,
    region: optional(formData, "region", 3)?.toUpperCase() ?? null,
    timezone,
  });
  revalidatePath("/settings");
  return { error: null, message: "Saved." };
}

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
