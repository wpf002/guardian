"use client";

import { useState } from "react";
import { Button } from "@/components";
import styles from "./Decision.module.css";

export interface ConsequenceCopyProps {
  context: "confirm" | "propose" | "readonly";
}

const WHY: Record<ConsequenceCopyProps["context"], string> = {
  confirm:
    "A correct decision followed by a screenshot into a mod channel is the failure this product is designed against. Guardian's own audit found servers whose members run predator-catch channels, and the alert card is publication to a third party the moment somebody photographs it.",
  propose:
    "A report goes to NCMEC because 18 USC 2258A makes the provider the reporter, and because a report that arrives through a person rather than through the CyberTipline loses the chain of custody that makes it usable. Guardian drafts. The operator files.",
  readonly:
    "You are reading a case somebody else claimed. Everything you can see here is still evidence held under a retention class, and the prohibitions apply to a reader as much as to a decider.",
};

/**
 * The three prohibitions. They appear at the confirm step, the propose step and
 * the read-only view, and nowhere else, so they stay legible rather than
 * becoming furniture.
 */
export function ConsequenceCopy({ context }: ConsequenceCopyProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <ul className={styles.prohibitions}>
        <li>Do not message either account about this case.</li>
        <li>
          Do not post this, or a screenshot of it, anywhere, including a private mod channel.
        </li>
        <li>
          If this needs reporting, it goes to NCMEC and Guardian drafts it. It does not go to
          the police.
        </li>
      </ul>
      <div className={styles.why}>
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Why?"}
        </Button>
        {open ? <p className={styles.whyBody}>{WHY[context]}</p> : null}
      </div>
    </div>
  );
}
