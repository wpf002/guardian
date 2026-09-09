import { Card, EmptyState, PageHeader, Stat } from "@/components";
import {
  AuditChainPanel,
  BarChart,
  ChainExportPanel,
  TargetMeter,
  ValueTable,
  type BarDatum,
  type ChainExportResult,
  type ValueRow,
} from "@/components/dashboard";
import { requireRole } from "@/lib/auth";
import { assertCopy } from "@/lib/compose";
import { deadLetterReason } from "@/lib/data/deliveries";
import { exportChainNow, verifyChainNow } from "./actions";
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

export const metadata = { title: "Reporting" };

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
  "How much Guardian flagged, how much a person confirmed, and how long cases waited. Nothing on this page measures one reviewer, and nothing on it can be sorted by who is quicker.",
);

const QUEUE_NOTE = assertCopy(
  "dashboard.queueNote",
  "Timed from when Guardian flagged the conversation to when somebody decided. Nobody's individual speed is recorded or shown.",
);

const CRITICAL_NOTE = assertCopy(
  "dashboard.criticalNote",
  "Some things put a conversation in front of a person no matter what the score says: a threat that matches a known script, a payment demand right after an image, meeting plans across an age gap. These are how often each one happened.",
);

const PPV_NOTE = assertCopy(
  "dashboard.ppvNote",
  "The first number is what we are aiming for. The second is what actually happened here, and it stays blank until enough cases have been decided to mean anything.",
);

const TIER_NOTE = assertCopy(
  "dashboard.tierNote",
  "How many conversations reached each level. If this jumps right after a version change, suspect the change before you suspect the traffic.",
);

const NOT_HERE = assertCopy(
  "dashboard.notHere",
  "Not on this page, deliberately: no map, no list of accounts, no live feed of alerts, and no ranking of reviewers by pace. Each of those turns a weekly read into a wall somebody watches.",
);

export default async function DashboardPage() {
  const session = await requireRole("operator");
  const metrics = await getDashboardMetrics(session);
  return <DashboardView metrics={metrics} verify={verifyChainNow} exportChain={exportChainNow} />;
}

export interface DashboardViewProps {
  metrics: DashboardMetrics;
  verify: () => Promise<{
    state: "ok" | "broken" | "unavailable";
    headline: string;
    detail: string;
    checkedAt: string;
  }>;
  exportChain: (purpose?: string) => Promise<ChainExportResult>;
}

/** Split out so the render can be exercised without a request. */
export function DashboardView({ metrics, verify, exportChain }: DashboardViewProps) {
  const { queue, cost, retention, audit, delivery, reports } = metrics;

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

  const deadRows: ValueRow[] = delivery.dead.map((row) => ({
    key: row.id,
    endpoint: row.host,
    tier: row.tier,
    why: deadLetterReason(row),
    when: stampUtc(row.updatedAt),
  }));

  const retentionBars: BarDatum[] = retention.rows.map((row) => ({
    key: row.retentionClass,
    label: row.label,
    value: row.pairs,
    display: countWords(row.pairs, "pair", "pairs"),
  }));

  return (
    <div className={`container ${styles.page}`}>
      <PageHeader
        title="Reporting"
        meta={
          <>
            <span>{metrics.customerName}</span>
            <span>{countWords(metrics.activeSeats, "seat", "seats")}</span>
            <span>read {stampUtc(metrics.generatedAt)}</span>
          </>
        }
        about={<p>{LEDE}</p>}
        aboutLabel="What Is on This Page"
      />

      {metrics.isEmpty ? (
        <EmptyState
          title="Nothing has been scored yet."
          detail="The queue is empty, no decision has been recorded, and the audit chain has no entries. That is what a partition looks like before the first event arrives, not a failure."
          meta={`Checked ${stampUtc(metrics.generatedAt)}.`}
        />
      ) : (
        <div className={styles.rows}>
          <Card title="Waiting for Review" density="padded" aside={`${metrics.shortWindowDays} day window`}>
            <div className={styles.stats}>
              <Stat label="Needs a Person" value={queue.openT2} />
              <Stat label="Being Watched" value={queue.openT1} />
              <Stat
                label="Running Out of Time"
                value={queue.breachRiskCount}
                target="a forecast, not a count"
              />
              <Stat
                label="Nobody Has Started"
                value={queue.unclaimedCount}
                target="not persisted yet"
              />
            </div>

            <div className={`${styles.stats} ${styles.factsSpaced}`}>
              <TargetMeter
                label="Longest Wait"
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
                label="Typical Time to Decide"
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
            <Card title="Reviewer Workload" density="padded">
              <TargetMeter
                label="Review Minutes per 1,000 Members per Day"
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

            <Card title="Are We Right?" density="padded">
              <Stat
                label={`Flagged Cases a Person Confirmed, Last ${metrics.shortWindowDays} Days`}
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
            <Card title="How Much Gets Flagged" density="padded" aside="7 and 30 days">
              <BarChart
                caption={`Pairs by tier, over ${metrics.shortWindowDays} and ${metrics.longWindowDays} days`}
                data={tierBars}
                valueHeader="Pairs"
                metaHeader="Share of the Window"
                emptyMessage="No pair reached a tier in either window."
              />
              <p className={styles.note}>{TIER_NOTE}</p>
            </Card>

            <Card
              title="What Reviewers Decided"
              density="padded"
              aside={`${metrics.longWindowDays} day window`}
            >
              <BarChart
                caption={`Recorded decisions by kind, over ${metrics.longWindowDays} days`}
                data={decisionBars}
                valueHeader="Decisions"
                metaHeader="Share of Decisions"
                emptyMessage="No decision has been recorded in this window."
              />
              <p className={styles.note}>
                A decision to send to a second reviewer is a proposal and not a tier. Only the
                second reviewer upholding it produces T3.
              </p>
            </Card>
          </div>

          <Card
            title="What Forced a Review"
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
            <Card title="What Gets Deleted, and When" density="padded">
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

            <Card title="Tamper Check" density="padded">
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

          <div className={styles.pair}>
            <Card
              title="Alerts Sent to Your Systems"
              density="padded"
              aside={`${delivery.windowDays} day window`}
            >
              <div className={styles.stats}>
                <Stat label="Delivered" value={delivery.deliveredCount} />
                <Stat label="Still Sending" value={delivery.pendingCount} />
                <Stat
                  label="Gave Up"
                  value={delivery.deadCount}
                  target="will not retry without a requeue"
                />
                <Stat
                  label="Sent Twice"
                  value={delivery.droppedResults}
                  unavailableNote="nothing has recorded one"
                  target="a worker's result was dropped"
                />
              </div>

              <ValueTable
                caption={`Deliveries given up on, most recent first, over ${delivery.windowDays} days`}
                columns={[
                  { key: "endpoint", header: "Endpoint" },
                  { key: "tier", header: "Tier" },
                  { key: "why", header: "Why It Stopped" },
                  { key: "when", header: "Last Attempt" },
                ]}
                rows={deadRows}
                emptyMessage="No delivery has been given up on in this window."
                className={styles.factsSpaced}
              />

              <p className={styles.note}>
                {`Sent twice counts attempts whose result could not be written back because another worker had already reclaimed the row. The request left the deployment, so the customer received that tier a second time. A number climbing here means the batch and claim clocks are mismatched, not that anything was lost.`}
              </p>
            </Card>

            <Card title="Reports to NCMEC" density="padded">
              <div className={styles.stats}>
                <Stat label="Drafts Downloaded" value={reports.draftsExported} />
                <Stat label="Reports Started" value={reports.drafted + reports.submitted} />
                <Stat label="Submitted" value={reports.submitted} />
                <Stat
                  label="Held for One Year"
                  value={reports.underPreservation}
                  target="one year from submission"
                />
              </div>
              <p className={styles.note}>
                NCMEC publishes no outcome back to the reporter, so no number here can say what an
                investigator did with a report. These count what left, not what came of it. A draft
                taken out of the console is a filing Guardian cannot follow: the operator files at
                the public form themselves.
              </p>
            </Card>
          </div>

          <div className={styles.pair}>
            <Card title="Download for a Regulator" density="padded">
              <ChainExportPanel exportChain={exportChain} />
              <p className={styles.note}>
                The artifact carries the entries, the algorithm and the recomputation recipe, so a
                reader verifies it with an ordinary HMAC and none of Guardian&apos;s code. It is
                scoped to this partition: entries belonging to other customers travel as
                placeholders that keep the chain linkable without disclosing anything. The chain key
                is not in the file and is delivered separately.
              </p>
            </Card>
          </div>

          <Card title="What Version Is Running" density="padded">
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
