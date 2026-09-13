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
    <Card title="This Report" density="padded">
      <p className={styles.lead}>{trail.headline}</p>

      {trail.events.length === 0 ? null : (
        <ol className={styles.trail}>
          {trail.events.map((event, index) => (
            <li key={`${event.stage}-${index}`}>
              <span className={styles.trailWhen}>{event.at.toLocaleString()}</span>
              <span className={styles.trailWhat}>{event.what}</span>
            </li>
          ))}
        </ol>
      )}

      {/*
        Two sentences a reporter needs: how long to keep their own records, and
        that NCMEC never says what happened next. They cited 18 USC 2258A and
        described which lines were "on the hash chain or on a stored row".
      */}
      {trail.preserveUntil ? (
        <p className={styles.note}>
          {`Keep your own records of this until ${trail.preserveUntil.toLocaleDateString()}. The law requires that for a year after a report.`}
        </p>
      ) : null}

      <p className={styles.note}>NCMEC doesn&apos;t tell reporters what happens next.</p>
    </Card>
  );
}
