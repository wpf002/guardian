import Link from "next/link";
import { EmptyState, TierBadge } from "@/components";
import { requireSession } from "@/lib/auth";
import { listQueue, RANKING_SENTENCE } from "@/lib/data/cases";
import styles from "./cases.module.css";
import caseStyles from "@/components/case/Case.module.css";

/**
 * The entrance to the case detail.
 *
 * Three lines per row, never four, and nothing on a row is a person: the
 * heading names the pair, the middle line names the pattern, and the last line
 * is counts and elapsed time. No excerpt, no handle, no fused score. A list you
 * can read without reading anybody's words is the point.
 */
export default async function CasesPage() {
  const session = await requireSession();
  const page = await listQueue(session);

  return (
    <div className={`container ${caseStyles.routeState}`}>
      <h1 className={styles.title}>Cases</h1>
      <p className={styles.ranking}>{RANKING_SENTENCE}</p>
      <p className={styles.count}>
        {page.summary.total} open in {page.summary.partitionName}, {page.summary.criticalCount}{" "}
        carrying a critical signal.
      </p>

      {page.cases.length === 0 ? (
        <EmptyState
          title="No case is open in your partition."
          detail="The scorer keeps writing, and a case appears here when one reaches a tier that needs a person."
          meta={
            page.summary.lastArrivalAt
              ? `Last arrival ${page.summary.lastArrivalAt.toLocaleString()}.`
              : "Nothing has arrived here yet."
          }
        />
      ) : (
        <ul className={styles.list}>
          {page.cases.map((row) => (
            <li key={row.pairId} className={styles.row} data-tier={row.tier}>
              <Link className={styles.link} href={`/cases/${row.pairId}`}>
                <span className={styles.lineOne}>
                  <TierBadge tier={row.tier} criticalSignals={row.criticalSignals} />
                  <span className={styles.pair}>Pair {row.shortId}</span>
                  <span className={styles.where}>
                    {row.channel ?? "channel not recorded"}
                  </span>
                  <span className={styles.claim}>
                    {row.claim.state === "unclaimed"
                      ? "unclaimed"
                      : `claimed by ${row.claim.who}, ${row.claim.sinceMinutes}m ago`}
                  </span>
                </span>
                <span className={styles.lineTwo}>{row.patternClause}</span>
                <span className={styles.lineThree}>
                  {row.actorContext} · {row.messageCount} messages over {row.spanHours}h ·{" "}
                  {row.slaRemainingMinutes === null
                    ? "no SLA (watch)"
                    : `${row.slaRemainingMinutes}m left`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.note}>
        Resolved cases are not listed here. They are reached from the decision that closed them.
      </p>
    </div>
  );
}
