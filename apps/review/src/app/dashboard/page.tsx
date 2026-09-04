import { Card, EmptyState, Stat } from "@/components";
import { AuditChainPanel, BarChart, TargetMeter, type BarDatum } from "@/components/dashboard";
import { requireRole } from "@/lib/auth";
import { assertCopy } from "@/lib/compose";
import { verifyChainNow } from "./actions";
import { countWords, minutesWords, percentWords, shortHash, stampUtc } from "./format";
import {
  getDashboardMetrics,
  REVIEWER_MINUTES_TARGET,
  T2_SLA_MINUTES,
  TARGET_PPV,
  type DashboardMetrics,
} from "./metrics";
import { describeVerification } from "./verification";
import styles from "./page.module.css";

export const metadata = { title: "Health" };

/**
 * The operator dashboard (RESEARCH 6.9).
 *
 * One screen for the trust and safety lead, on a weekly cadence rather than a
 * live wall. It answers three questions and stops: is the queue keeping up,
 * what does it cost and is it calibrated, and can the retention and audit
 * promises be shown to somebody. Nothing here is a feed, nothing counts people,
 * and nothing ranks reviewers.
 *
 * Operator and owner only. A reviewer who reaches this route gets the not-found
 * state, because a 403 confirms the route means something here.
 */

export const dynamic = "force-dynamic";

const LEDE = assertCopy(
  "dashboard.lede",
  "Counts of pairs, decisions, signals and minutes on your own partition. The four hour figure is a target for how long a pair waits in the queue, not a stopwatch on a reviewer, and no figure on this page is scoped to one person.",
);

const QUEUE_NOTE = assertCopy(
  "dashboard.queueNote",
  "Time in queue is measured from the score being assigned to the decision being recorded. Reviewer handling time is not shown here and is not compared between people.",
);

const CRITICAL_NOTE = assertCopy(
  "dashboard.criticalNote",
  "A critical signal forces tier T2 or higher regardless of the fused score. These are counts of pairs a signal fired on, taken from the audit chain, so a pair already resolved still counts toward the window it fired in.",
);

const PPV_NOTE = assertCopy(
  "dashboard.ppvNote",
  "These are the targets from the design, not measurements of this partition. The realized figure sits beside them and reads as unavailable until there are enough decisions to compute one.",
);

const TIER_NOTE = assertCopy(
  "dashboard.tierNote",
  "Counts of pairs that reached each tier. A rising count after a version change is a measurement artifact until the version history below says otherwise.",
);

const NOT_HERE = assertCopy(
  "dashboard.notHere",
  "Not on this page, deliberately: no map, no list of accounts, no live feed of alerts, and no ranking of reviewers by pace. Each of those turns a weekly read into a wall somebody watches.",
);

export default async function DashboardPage() {
  const session = await requireRole("operator");
  const metrics = await getDashboardMetrics(session);
  return <DashboardView metrics={metrics} verify={verifyChainNow} />;
}

export interface DashboardViewProps {
  metrics: DashboardMetrics;
  verify: () => Promise<{
    state: "ok" | "broken" | "unavailable";
    headline: string;
    detail: string;
    checkedAt: string;
  }>;
}

/** Split out so the render can be exercised without a request. */
export function DashboardView({ metrics, verify }: DashboardViewProps) {
  const { queue, cost, retention, audit } = metrics;

  const tierBars: BarDatum[] = metrics.tierRates.map((row) => ({
    key: `${row.tier}-${row.windowDays}`,
    label: `${row.tier}, ${row.windowDays} days`,
    value: row.count,
    display: countWords(row.count, "pair", "pairs"),
    meta: percentWords(row.sharePercent),
    tone: row.tier === "T1" ? "t1" : row.tier === "T2" ? "t2" : "t3",
  }));

  const decisionBars: BarDatum[] = metrics.decisionMix.map((row) => ({
    key: row.decision,
    label: row.label,
    value: row.count,
    display: countWords(row.count, "decision", "decisions"),
    meta: percentWords(row.sharePercent),
  }));

  const signalBars: BarDatum[] = metrics.criticalSignals.map((row) => ({
    key: row.kind,
    label: row.label,
    value: row.count,
    display: countWords(row.count, "pair", "pairs"),
  }));

  const retentionBars: BarDatum[] = retention.rows.map((row) => ({
    key: row.retentionClass,
    label: row.label,
    value: row.pairs,
    display: countWords(row.pairs, "pair", "pairs"),
  }));

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>Health</h1>
        <p className={styles.lede}>{LEDE}</p>
        <p className={styles.stamp}>
          {metrics.customerName} · {countWords(metrics.activeSeats, "seat", "seats")} · read{" "}
          {stampUtc(metrics.generatedAt)}
        </p>
      </header>

      {metrics.isEmpty ? (
        <EmptyState
          title="Nothing has been scored on this partition yet."
          detail="The queue is empty, no decision has been recorded, and the audit chain has no entries. That is what a partition looks like before the first event arrives, not a failure."
          meta={`Checked ${stampUtc(metrics.generatedAt)}.`}
        />
      ) : (
        <div className={styles.rows}>
          <Card title="Queue health" density="padded" aside={`${metrics.shortWindowDays} day window`}>
            <div className={styles.stats}>
              <Stat label="Open at T2" value={queue.openT2} />
              <Stat label="Open at T1" value={queue.openT1} />
              <Stat
                label="Open T2 with under an hour left"
                value={queue.breachRiskCount}
                target="a breach forecast, not a breach count"
              />
              <Stat
                label="Unclaimed"
                value={queue.unclaimedCount}
                target="claim state is not persisted yet"
              />
            </div>

            <div className={`${styles.stats} ${styles.factsSpaced}`}>
              <TargetMeter
                label="Oldest open T2, time in queue"
                value={queue.oldestT2AgeMinutes}
                display={minutesWords(queue.oldestT2AgeMinutes)}
                unavailableNote="no T2 is open"
                target={T2_SLA_MINUTES}
                targetDisplay="4 hours"
                direction="at-or-below"
                note={
                  queue.oldestT2SlaRemainingMinutes === null
                    ? undefined
                    : `${minutesWords(queue.oldestT2SlaRemainingMinutes)} left on the target.`
                }
              />
              <Stat
                label="Median time from score to decision"
                value={
                  queue.medianMinutesToDecision === null
                    ? null
                    : minutesWords(queue.medianMinutesToDecision)
                }
                unavailableNote="no decision has a score time to measure from"
                target={`sampled over ${countWords(queue.latencySampleSize, "decision", "decisions")}`}
              />
            </div>

            <p className={styles.note}>{QUEUE_NOTE}</p>
            <p className={styles.note}>
              Last arrival {stampUtc(queue.lastArrivalAt)}. Partition {queue.partitionName}.
            </p>
          </Card>

          <div className={styles.pair}>
            <Card title="Cost" density="padded">
              <TargetMeter
                label="Reviewer minutes per 1,000 users per day"
                value={cost.reviewerMinutesPer1kUsers}
                display={`${cost.reviewerMinutesPer1kUsers} minutes`}
                unavailableNote="no active user count for this partition"
                target={REVIEWER_MINUTES_TARGET}
                targetDisplay="2 minutes or fewer"
                direction="at-or-below"
                note={`${countWords(cost.minutesLogged, "minute", "minutes")} logged across ${countWords(
                  cost.decisionsCounted,
                  "decision",
                  "decisions",
                )}, against an assumed ${cost.assumedActiveUsers.toLocaleString("en-US")} monthly active accounts.`}
              />
              <p className={styles.note}>
                This is the number a prospective customer staffs against, and the pass mark in the
                evaluation suite. It is an aggregate for the partition and cannot be broken down by
                person on this page.
              </p>
            </Card>

            <Card title="Calibration" density="padded">
              <Stat
                label={`Realized T2 predictive value, ${metrics.shortWindowDays} days`}
                value={cost.realizedT2Ppv === null ? null : `${Math.round(cost.realizedT2Ppv * 100)}%`}
                unavailableNote={`fewer than ${cost.minSampleForRate} decisions on T2 pairs in this window`}
                target={`from ${countWords(cost.ppvSampleSize, "decision on a T2 pair", "decisions on T2 pairs")}`}
              />
              <dl className={`${styles.facts} ${styles.factsSpaced}`}>
                {(["T1", "T2", "T3"] as const).map((tier) => (
                  <div key={tier} className={styles.fact}>
                    <dt>{tier} target predictive value</dt>
                    <dd className="tabular">{TARGET_PPV[tier]}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.note}>{PPV_NOTE}</p>
            </Card>
          </div>

          <div className={styles.pair}>
            <Card title="Tier rates" density="padded" aside="7 and 30 days">
              <BarChart
                caption={`Pairs by tier, over ${metrics.shortWindowDays} and ${metrics.longWindowDays} days`}
                data={tierBars}
                valueHeader="Pairs"
                metaHeader="Share of the window"
                emptyMessage="No pair reached a tier in either window."
              />
              <p className={styles.note}>{TIER_NOTE}</p>
            </Card>

            <Card
              title="Decision mix"
              density="padded"
              aside={`${metrics.longWindowDays} day window`}
            >
              <BarChart
                caption={`Recorded decisions by kind, over ${metrics.longWindowDays} days`}
                data={decisionBars}
                valueHeader="Decisions"
                metaHeader="Share of decisions"
                emptyMessage="No decision has been recorded in this window."
              />
              <p className={styles.note}>
                A decision to send to a second reviewer is a proposal and not a tier. Only the
                second reviewer upholding it produces T3.
              </p>
            </Card>
          </div>

          <Card
            title="Critical signals"
            density="padded"
            aside={`${countWords(metrics.criticalSignalTotal, "hit", "hits")} in ${metrics.shortWindowDays} days`}
          >
            <BarChart
              caption={`Critical signals by kind, over ${metrics.shortWindowDays} days`}
              data={signalBars}
              valueHeader="Pairs"
              emptyMessage="No critical signal fired in this window."
            />
            <p className={styles.note}>{CRITICAL_NOTE}</p>
          </Card>

          <div className={styles.pair}>
            <Card title="Retention" density="padded">
              <BarChart
                caption="Pairs by retention class"
                data={retentionBars}
                valueHeader="Pairs"
                emptyMessage="No pair is being retained on this partition."
              />
              <dl className={`${styles.facts} ${styles.factsSpaced}`}>
                <div className={styles.fact}>
                  <dt>Earliest scheduled deletion</dt>
                  <dd>{stampUtc(retention.earliestExpiryAt)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Last sweep</dt>
                  <dd>
                    {stampUtc(retention.lastSweepAt)}
                    {retention.lastSweepSeq === null ? "" : `, chain entry ${retention.lastSweepSeq}`}
                  </dd>
                </div>
                <div className={styles.fact}>
                  <dt>Rows deleted in the last sweep</dt>
                  <dd className="tabular">
                    {retention.lastSweepDeleted === null
                      ? "the chain entry recorded no count"
                      : retention.lastSweepDeleted}
                  </dd>
                </div>
                <div className={styles.fact}>
                  <dt>Next sweep expected</dt>
                  <dd>{stampUtc(retention.nextSweepExpectedAt)}</dd>
                </div>
              </dl>
              <p className={styles.note}>
                The next sweep is the last one plus the 24 hour cycle. The deletion job does not
                publish its schedule to this app, so treat it as expected rather than booked.
                {retention.derivedFromTier
                  ? " Classes here are derived from tier under the retention policy, because this partition is running on fixtures rather than a database."
                  : ""}
              </p>
            </Card>

            <Card title="Audit chain" density="padded">
              <AuditChainPanel
                headSeq={audit.headSeq}
                headHash={shortHash(audit.headHash)}
                entriesInWindow={audit.entriesInWindow}
                windowDays={metrics.shortWindowDays}
                initial={describeVerification(audit.verification)}
                verify={verify}
              />
              <p className={styles.note}>
                Verification walks the chain and names the entry that broke, which is what makes a
                report survive a challenge later. It reads only, and writes nothing to the chain.
              </p>
            </Card>
          </div>

          <Card title="Versions in production" density="padded">
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>Model</dt>
                <dd className="mono">{metrics.currentVersions.modelVersion}</dd>
              </div>
              <div className={styles.fact}>
                <dt>Lexicon</dt>
                <dd className="mono">{metrics.currentVersions.lexiconVersion}</dd>
              </div>
              <div className={styles.fact}>
                <dt>Fusion</dt>
                <dd className="mono">{metrics.currentVersions.fusionVersion}</dd>
              </div>
            </dl>

            {metrics.versionHistory.length > 1 ? (
              <ul className={styles.versionList}>
                {metrics.versionHistory.map((sighting) => (
                  <li
                    key={`${sighting.versions.modelVersion}-${sighting.versions.lexiconVersion}-${sighting.versions.fusionVersion}`}
                    className={styles.versionRow}
                  >
                    <span className={styles.versionTriple}>
                      {sighting.versions.modelVersion} · {sighting.versions.lexiconVersion} ·{" "}
                      {sighting.versions.fusionVersion}
                    </span>
                    <span className={styles.versionMeta}>
                      {countWords(sighting.scoresSeen, "score", "scores")}, {stampUtc(sighting.firstSeenAt)}{" "}
                      to {stampUtc(sighting.lastSeenAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>
                One version triple has written every score this page can see. When that changes, each
                triple is listed here with the window it scored in, so a jump in counts can be read
                against it.
              </p>
            )}
          </Card>

          <p className={styles.footer}>{NOT_HERE}</p>
        </div>
      )}
    </div>
  );
}
