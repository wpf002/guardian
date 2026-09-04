import Link from "next/link";
import { Card, TierBadge } from "@/components";
import { bandWord } from "@/lib/mock/fixtures";
import type { ActorContext, PriorCase } from "@/lib/data/types";
import styles from "./Case.module.css";

export interface ActorPanelProps {
  actor: ActorContext;
  priorCases: PriorCase[];
}

function days(hours: number | null): string {
  if (hours === null) return "not recorded";
  if (hours < 48) return `${Math.round(hours)} hours old`;
  return `${Math.round(hours / 24)} days old`;
}

const DECISION_WORD: Record<string, string> = {
  dismiss: "dismissed",
  watch: "held at watch",
  confirm: "confirmed",
  report: "sent to a second reviewer",
};

/**
 * Counts and elapsed time. Every line is something the account did or something
 * the graph measured, and no line is an adjective.
 */
export function ActorPanel({ actor, priorCases }: ActorPanelProps) {
  return (
    <Card title="This actor" density="padded" aside={actor.hashedUid.slice(0, 12)}>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Age band</dt>
          <dd className={styles.factValue}>
            {bandWord(actor.band.band)}, {actor.band.provenance.replace(/_/g, " ")}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Pairs in the window</dt>
          <dd className={styles.factValue}>{actor.pairsInWindow}</dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Fan-out, 7 days</dt>
          <dd className={styles.factValue}>
            {actor.fanOut7d} accounts, {actor.minorFanOut7d} in a younger band
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Fan-in, 7 days</dt>
          <dd className={styles.factValue}>
            {actor.fanIn7d === null ? "not recorded on this pair row" : actor.fanIn7d}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Account age</dt>
          <dd className={styles.factValue}>{days(actor.accountAgeHours)}</dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Accounts clustered with this one</dt>
          <dd className={styles.factValue}>{actor.altClusterSize}</dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Elevated role</dt>
          <dd className={styles.factValue}>{actor.elevatedRole ?? "none"}</dd>
        </div>
      </dl>

      {actor.elevatedRole ? (
        <p className={styles.annotation}>
          This account holds an elevated role on the server. That is context for the reviewer,
          not a reason to lower the tier.
        </p>
      ) : null}

      <h3 className={styles.signalName}>Prior cases on this actor</h3>
      {priorCases.length === 0 ? (
        <p className={styles.note}>
          First case for this actor. Nothing earlier has been decided here.
        </p>
      ) : (
        <ul className={styles.priors}>
          {priorCases.map((prior) => (
            <li key={prior.pairId}>
              <Link href={`/cases/${prior.pairId}`}>Pair {prior.shortId}</Link>{" "}
              <TierBadge tier={prior.resultTier} />{" "}
              {DECISION_WORD[prior.decision] ?? prior.decision} on{" "}
              {prior.decidedAt.toLocaleDateString()}: {prior.reasonLabel}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note}>
        Counts, tiers and outcomes only. Reading another pair is a second case with its own
        retention class, so there are no messages from it here.
      </p>
    </Card>
  );
}
