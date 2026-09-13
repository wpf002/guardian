"use client";

import styles from "./Decision.module.css";

export interface ConsequenceCopyProps {
  context: "confirm" | "propose" | "readonly";
}

/**
 * Three things not to do, shown where somebody is about to act.
 *
 * The third line said a report "does not go to the police". NCMEC's own
 * reporting page says the opposite for an emergency: "If you or someone you
 * know is in immediate danger, please call 911 or your local police
 * immediately." A parent reading "it does not go to the police" about a child
 * in danger could wait when they should not. Rule 4 is about what Guardian
 * builds, one reporting path and no feature that sends anything to police, and
 * it was never a reason to tell a person not to call 911.
 *
 * The "Why?" disclosure is gone. It explained 18 USC 2258A and chain of
 * custody to somebody deciding about a conversation.
 */
export function ConsequenceCopy(_props: ConsequenceCopyProps) {
  return (
    <ul className={styles.prohibitions}>
      <li>Don&apos;t message either account about this.</li>
      <li>Don&apos;t post this, or a screenshot of it, anywhere. That includes a private moderator channel.</li>
      <li>
        If a child is in danger right now, call 911 or your local police. Otherwise, reports go to
        NCMEC, and Guardian writes them for you.
      </li>
    </ul>
  );
}
