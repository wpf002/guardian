import Link from "next/link";
import { Card } from "@/components";
import type { ReportTrail as Trail } from "@/lib/data/reports";
import styles from "./Case.module.css";

/**
 * What happened to this case's report, and what Guardian does not know.
 *
 * The last line is the point. A filing goes to NCMEC and NCMEC publishes no
 * outcome back to the reporter, so a trail that stopped at "submitted" without
 * saying so would read as though somebody was still watching. Tickets vanishing
 * into a black box is the grievance that pushed civilian hunters into
 * publishing instead of reporting; the fix is not to pretend there is a status
 * to show, it is to say plainly where Guardian's knowledge ends.
 */
export function ReportTrail({ trail }: { trail: Trail }) {
  return (
    <Card title="What Happened to This Report" density="padded">
      <p className={styles.lead}>{trail.headline}</p>

      {trail.events.length === 0 ? null : (
        <ol className={styles.trail}>
          {trail.events.map((event, index) => (
            <li key={`${event.stage}-${index}`}>
              <span className={styles.trailWhen}>
                {event.at.toISOString().replace("T", " ").slice(0, 16)} UTC
              </span>
              <span className={styles.trailWhat}>{event.what}</span>
              {event.auditSeq === null ? null : (
                <Link className={styles.trailLink} href={`/audit/${event.auditSeq}`}>
                  chain entry {event.auditSeq}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}

      {trail.preserveUntil ? (
        <p className={styles.note}>
          Preserve your own records of this case until{" "}
          {trail.preserveUntil.toISOString().slice(0, 10)}. That is one year from submission under
          18 USC 2258A, and it is a duty on you as the provider, not on Guardian.
        </p>
      ) : null}

      <p className={styles.note}>
        NCMEC does not report an outcome back to the reporter, so nothing here will ever say what an
        investigator did. What this list can say is what Guardian holds, and every line of it is on
        the hash chain or on a stored row.
      </p>
    </Card>
  );
}
