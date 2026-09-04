import Link from "next/link";
import { Card, TierBadge } from "@/components";
import { bandWord } from "@/lib/mock/fixtures";
import type { BandReading, QueueCase } from "@/lib/data/types";
import styles from "./Case.module.css";

function bandPhrase(reading: BandReading): string {
  const confidence =
    reading.confidence === null
      ? "no confidence published"
      : `confidence ${reading.confidence.toFixed(2)}`;
  return `${bandWord(reading.band)}, ${reading.provenance.replace(/_/g, " ")}, ${confidence}`;
}

export interface SeverityStripProps {
  queue: QueueCase;
  /** Where "Defer, I need a buffer" goes. Leaving is always available. */
  deferHref: string;
}

/**
 * Rendered from the pair row alone, before the evidence is fetched, so a
 * reviewer can dismiss, watch or defer without reading anything. Both escapes
 * are links, so they work with no client JavaScript and cost no exposure.
 */
export function SeverityStrip({ queue, deferHref }: SeverityStripProps) {
  const critical =
    queue.criticalSignals.length > 0
      ? queue.criticalSignals.map((signal) => signal.replace(/_/g, " ")).join(", ")
      : null;

  return (
    <Card title="Severity" aside={`scored for ${queue.customerName}`} density="padded">
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
          Open the timeline
        </a>
        <Link className={styles.linkAction} href={deferHref}>
          Defer, I need a buffer
        </Link>
      </div>
      <p className={styles.note}>
        Deferring leaves this case without a decision. It logs no reason and it does not count
        as a skip.
      </p>
    </Card>
  );
}
