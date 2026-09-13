import Link from "next/link";
import type { CaseDetail, StagePoint } from "@/lib/data/types";
import { accountLabel, SUPPORT_POSTURE_NOTE } from "@/components/queue/words";
import styles from "./CaseSummary.module.css";

/**
 * What happened, who was in it, and how far it has gone. One card.
 *
 * This replaces seven panels that sat above the conversation: a severity strip
 * with the tier code and two confidence figures, a bar chart of fusion weights
 * with a paragraph explaining that none of them is a probability, a list of
 * which lexicon entries fired, a six-stage ladder with elapsed hours, an
 * account panel with fan-in and fan-out counts and a salted hash, the
 * operator's written policy for the tier, and a version triple with a chain
 * reference. All of it is recorded, and the Evidence Log keeps every score.
 * None of it helps a person read a conversation and decide what to do.
 *
 * It names two accounts and their ages and describes what was said. It says
 * nothing about who either account belongs to (rule 5).
 */

const AGE_WORDS: Record<string, string> = {
  UNDER_9: "under 9",
  A9_12: "9 to 12",
  A13_15: "13 to 15",
  A16_17: "16 to 17",
  A18_20: "18 to 20",
  A21_PLUS: "21 or over",
  UNKNOWN: "age unknown",
};

/** The six steps grooming usually follows (DESIGN.md 1), as a person says them. */
const STEP_WORDS: Record<string, string> = {
  contact: "Started talking",
  trust: "Built trust",
  probe: "Asked whether anyone is watching",
  migrate: "Asked to move to another app",
  sexualize: "Made it sexual",
  coerce: "Pressured or threatened",
};

/*
 * How Guardian knows these two were talking (ROADMAP 2b.3).
 *
 * A reply is the sender saying who they meant. A guess from who else was in the
 * channel can be wrong in a way a reply cannot, and somebody about to report
 * has to know which one they are looking at. This was on the strip that sat
 * above the conversation, and it stays when the strip is gone.
 */
const PAIRED_BY: Record<string, { text: string; caution: boolean }> = {
  reply: { text: "They were replying to each other.", caution: false },
  mention: { text: "One of them mentioned the other by name.", caution: false },
  adjacency: {
    text: "Guardian put these two together because nobody else was talking in the channel. Neither replied to the other, so read the messages to check it's really one conversation.",
    caution: true,
  },
  unrecorded: { text: "Guardian didn't record how it knew these two were talking.", caution: true },
};

function reached(path: StagePoint[]): string[] {
  return path.filter((point) => point.reachedAt !== null).map((point) => STEP_WORDS[point.stage] ?? point.stage);
}

function accountAge(hours: number | null): string | null {
  if (hours === null) return null;
  const days = Math.floor(hours / 24);
  if (days < 1) return "created today";
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"} old`;
  return `${Math.floor(days / 30)} months old`;
}

export function CaseSummary({ detail }: { detail: CaseDetail }) {
  const { queue, actor } = detail;
  const older = accountLabel(queue.actorUid);
  const younger = accountLabel(queue.targetUid);
  const steps = reached(detail.stagePath);
  const age = accountAge(actor.accountAgeHours);
  const others = Math.max(0, actor.minorFanOut7d - 1);
  const paired = PAIRED_BY[queue.targetSource ?? "unrecorded"]!;

  return (
    <section className={styles.summary} aria-label="What happened">
      <Link className={styles.back} href="/queue">
        Back to Dashboard
      </Link>

      <h1 className={styles.headline}>{queue.patternClause}</h1>

      <p className={styles.who}>
        <span className={styles.account}>{older}</span>
        <span className={styles.age}>{AGE_WORDS[queue.actorBand.band]}</span>
        <span className={styles.to}>to</span>
        <span className={styles.account}>{younger}</span>
        <span className={styles.age}>{AGE_WORDS[queue.targetBand.band]}</span>
        {queue.channel ? <span className={styles.where}>{`in ${queue.channel}`}</span> : null}
      </p>

      <p className={styles.why}>{detail.whySentence}</p>

      {/*
        What changes how this should be read, when it applies. Each was on the
        old strip in the scorer's words: "Support posture suggested", "the age
        gap counted for nothing in this tier", "the per-actor score alone".
      */}
      {queue.suggestedPosture === "support" ? <p className={styles.caution}>{SUPPORT_POSTURE_NOTE}</p> : null}
      {queue.actorBand.band === "UNKNOWN" && queue.targetBand.band === "UNKNOWN" ? (
        <p className={styles.caution}>
          Guardian doesn&apos;t know how old either account is, so age played no part in this. That
          usually means they&apos;re messaging from inside a game. It&apos;s here because of what was
          said.
        </p>
      ) : null}
      {queue.soleAutomatedBasis ? (
        <p className={styles.caution}>
          Nothing in this conversation stood out on its own. It&apos;s here because of what the older
          account did in other conversations, so it can&apos;t be reported by itself.
        </p>
      ) : null}
      <p className={paired.caution ? styles.caution : styles.about}>{paired.text}</p>

      {steps.length > 0 ? (
        <ol className={styles.steps} aria-label="What has happened so far">
          {steps.map((step, index) => (
            <li key={step} className={styles.stepItem}>
              {index > 0 ? (
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
              ) : null}
              <span className={styles.step}>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {/*
        The one account fact that changes how this reads: whether it is doing
        the same thing to other children. Its age is second, because an account
        made days ago to do this is common.
      */}
      {others > 0 || age ? (
        <p className={styles.about}>
          {others > 0 ? (
            <strong>{`${older} is talking to ${others} other young ${others === 1 ? "account" : "accounts"} this week.`}</strong>
          ) : null}
          {age ? <span>{` The account is ${age}.`}</span> : null}
        </p>
      ) : null}
    </section>
  );
}
