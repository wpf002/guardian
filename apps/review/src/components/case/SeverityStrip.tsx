import { Card, TierBadge } from "@/components";
import { bandWord } from "@/lib/mock/fixtures";
import type { BandReading, QueueCase } from "@/lib/data/types";
import styles from "./Case.module.css";

/*
 * A band nobody read is said plainly, not dressed as a weak reading.
 *
 * "unknown, unknown, no confidence published" is three fields printed beside a
 * tier, and it reads as evidence. It is the opposite: it is Guardian saying it
 * has no age for this account, which happens whenever somebody arrives through
 * a game-chat bridge rather than as a member of the server (ROADMAP 2c).
 */
function bandPhrase(reading: BandReading): string {
  if (reading.band === "UNKNOWN") return "not known to Guardian";
  const confidence =
    reading.confidence === null
      ? "no confidence published"
      : `confidence ${reading.confidence.toFixed(2)}`;
  return `${bandWord(reading.band)}, ${reading.provenance.replace(/_/g, " ")}, ${confidence}`;
}

/*
 * How Guardian knows these two were talking, in the words a reviewer needs
 * before they propose a federal report (ROADMAP 2b.3).
 *
 * A reply is a statement by the sender about who they were addressing.
 * Adjacency is Guardian's inference from who else was in the channel, and it
 * can be wrong in a way a reply cannot: two people posting in a quiet channel
 * are not necessarily talking to each other. Saying which is not a caveat, it
 * is the difference between two sentences a reviewer would write differently
 * on a CyberTipline report.
 */
const PAIRED_BY: Record<string, string> = {
  reply: "These two were replying to each other.",
  mention: "One named the other directly.",
  adjacency:
    "Guardian paired these two because they were the only people talking in this channel. Nobody replied to anybody, so read the timeline before you treat this as one conversation.",
  unrecorded: "How these two were paired was not recorded.",
};

export interface SeverityStripProps {
  queue: QueueCase;
}

/**
 * Rendered from the pair row alone, before the evidence is fetched, so a
 * reviewer can dismiss or watch without reading anything. The one control is a
 * link, so it works with no client JavaScript and costs no exposure.
 *
 * There was a second control here, "Defer, I need a buffer", which released the
 * claim with no reason recorded. A claim is not persisted on this deployment,
 * so it released nothing: it was a link back to the queue with a sentence under
 * it. Leaving is the browser Back button and the Queue link in the nav.
 */
export function SeverityStrip({ queue }: SeverityStripProps) {
  const critical =
    queue.criticalSignals.length > 0
      ? queue.criticalSignals.map((signal) => signal.replace(/_/g, " ")).join(", ")
      : null;

  return (
    <Card title="What Guardian Recorded" aside={`scored for ${queue.customerName}`} density="padded">
      <div className={styles.stripTop}>
        <TierBadge tier={queue.tier} withMeaning criticalSignals={queue.criticalSignals} />
        <span className={styles.criticalWord}>
          {critical ? `critical: ${critical}` : "critical: none"}
        </span>
      </div>

      <div className={styles.stripFacts}>
        <span>
          Older-band account: <strong>{bandPhrase(queue.actorBand)}</strong>
        </span>
        <span>
          Younger-band account: <strong>{bandPhrase(queue.targetBand)}</strong>
        </span>
        <span>
          <strong>{queue.messageCount}</strong> messages over{" "}
          <strong>{queue.spanHours}h</strong>, and{" "}
          <strong>{queue.mediaEventCount}</strong> media event
          {queue.mediaEventCount === 1 ? "" : "s"}. Guardian holds hashes, never bytes.
        </span>
        <span>
          {PAIRED_BY[queue.targetSource ?? "unrecorded"]}
        </span>
        {queue.actorBand.band === "UNKNOWN" && queue.targetBand.band === "UNKNOWN" ? (
          <span className={styles.posture}>
            Guardian has no age for either account, so the age gap counted for nothing in this
            tier. That happens when both arrive through a game-chat bridge rather than as members
            of the server. What is here rests on what was said.
          </span>
        ) : null}
        {queue.suggestedPosture === "support" ? (
          <span className={styles.posture}>
            Support posture suggested. No enforcement action is offered on this case.
          </span>
        ) : null}
        {queue.soleAutomatedBasis ? (
          <span className={styles.posture}>
            This tier rests on the per-actor score alone, with no conversational fact on the
            pair. A report cannot be proposed from it.
          </span>
        ) : null}
      </div>

      <div className={styles.stripActions}>
        <a className={styles.linkAction} href="#timeline">
          Open the Timeline
        </a>
      </div>
    </Card>
  );
}
