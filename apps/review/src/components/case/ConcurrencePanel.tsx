"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Textarea, Toast } from "@/components";
import { announce } from "@/lib/announce";
import { concurrenceReasons, type Reason } from "@/lib/reasons";
import type { OpenProposal } from "@/lib/data/types";
import type { ConcurInput, DecisionOutcome, WithdrawInput } from "@/app/cases/[id]/actions";
import { ReasonList } from "./ReasonList";
import styles from "./Decision.module.css";

export interface ConcurrencePanelProps {
  pairId: string;
  proposal: OpenProposal;
  /** False when the evidence timeline could not be loaded. */
  timelineAvailable: boolean;
  /** Excerpts legibly rendered to THIS reviewer, in this session. */
  readCount: number;
  onConcur: (input: ConcurInput) => Promise<DecisionOutcome>;
  onWithdraw: (input: WithdrawInput) => Promise<DecisionOutcome>;
  leaveHref: string;
}

/**
 * The second half of a T3, and the only place one can be produced.
 *
 * A proposal writes no tier. It records that one reviewer read the evidence and
 * reached a CyberTipline incident type, and then it waits. This panel is what a
 * different reviewer answers it with: uphold writes T3 and starts the one-year
 * preservation hold, overturn returns the pair to T2 and writes no report.
 * Neither is a finding about a person.
 *
 * Three things the server enforces, so that nothing here is the only guard.
 * The second reviewer is never the proposer. The second reviewer has to have
 * had the timeline rendered to them, checked against their own evidence.read
 * entries on the chain rather than against the pair's read flag, which the
 * proposer already set. And the proposal has to still be open: two people
 * answering at once, and the second write matches no row and rolls back.
 */
export function ConcurrencePanel({
  pairId,
  proposal,
  timelineAvailable,
  readCount,
  onConcur,
  onWithdraw,
  leaveHref,
}: ConcurrencePanelProps) {
  const recordedRef = useRef<HTMLElement>(null);
  const [side, setSide] = useState<"uphold" | "overturn" | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const answered = outcome?.ok === true;

  useEffect(() => {
    if (!answered) return;
    recordedRef.current?.focus();
    announce(outcome?.summary ?? "Recorded.");
  }, [answered, outcome?.summary]);

  const blocked = useCallback((): string | undefined => {
    if (!timelineAvailable) {
      return "The conversation didn't load. Reload the page before you answer.";
    }
    if (readCount === 0) {
      return "Read the conversation above first.";
    }
    return undefined;
  }, [readCount, timelineAvailable]);

  const openSide = useCallback(
    (next: "uphold" | "overturn") => {
      if (blocked()) return;
      setFailure(null);
      setSide((current) => (current === next ? null : next));
    },
    [blocked],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "1") {
        event.preventDefault();
        openSide("uphold");
        return;
      }
      if (event.key === "2") {
        event.preventDefault();
        openSide("overturn");
        return;
      }
      if (event.key === "Escape") setSide(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openSide]);

  async function commit(reason: Reason) {
    setBusy(true);
    setFailure(null);
    try {
      const result = await onConcur({
        pairId,
        proposalReviewId: proposal.reviewId,
        proposerReviewerId: proposal.proposerReviewerId,
        upheld: reason.concurrence === "uphold",
        reasonCode: reason.code,
        notes: { timeline: note.trim() || undefined },
        viewedExcerptCount: readCount,
      });
      if (!result.ok) {
        setFailure(result.error ?? "Your answer didn't save. Nothing changed.");
        return;
      }
      setOutcome(result);
      setSide(null);
    } catch {
      setFailure(
        "Your answer didn't save. Nothing changed, and what you typed is still here.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await onWithdraw({ pairId, proposalReviewId: proposal.reviewId });
      if (!result.ok) {
        setFailure(result.error ?? "That didn't save. The request to report is still open.");
        return;
      }
      setOutcome(result);
    } finally {
      setBusy(false);
    }
  }

  if (answered) {
    return (
      <section
        className={styles.panel}
        aria-label="Proposal answered"
        ref={recordedRef}
        tabIndex={-1}
      >
        <div className={styles.result}>
          <h2 className={styles.title}>Saved</h2>
          <p className={styles.resultSummary}>{outcome?.summary}</p>
          {outcome?.resultTier === "T3" ? (
            <Toast
              message="This is marked for reporting, and the messages will be kept for a year."
              tone="info"
            />
          ) : null}
          <div className={styles.escapes}>
            <Link className={styles.linkEscape} href={leaveHref}>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </section>
    );
  }

  /*
   * The proposer's own view. They have already decided; the case is waiting on
   * somebody else, and the one thing left to them is taking it back. Showing
   * them the uphold and overturn controls would be offering a decision the
   * server refuses, which is worse than not offering it.
   */
  if (proposal.mine) {
    return (
      <section className={styles.panel} aria-label="Your proposal">
        <h2 className={styles.title}>Waiting for someone else to agree</h2>
        <p className={styles.lead}>
          {`You asked to report this as ${proposal.reasonLabel.toLowerCase()}. Nothing is reported until someone else on your team reads it and agrees.`}
        </p>
        {failure ? <p className={styles.failure}>{failure}</p> : null}
        <div className={styles.escapes}>
          <Button variant="secondary" loading={busy} onClick={() => void withdraw()}>
            Take It Back
          </Button>
          <Link className={styles.linkEscape} href={leaveHref}>
            Back to Dashboard
          </Link>
        </div>
      </section>
    );
  }

  const reason = blocked();

  return (
    <section className={styles.panel} aria-label="Answer the proposal">
      {/*
        What is being asked, who asked, and what each answer does, in the words
        somebody would use. It said a proposal "wrote no tier", that upholding
        "writes T3 and starts a one-year preservation hold", and cited 18 USC
        2258A on the button. The 1 and 2 badges are gone too; the keys still
        work.
      */}
      <h2 className={styles.title}>Do you agree this should be reported?</h2>
      <p className={styles.lead}>
        {`${proposal.proposerName} read this and wants to report it as ${proposal.reasonLabel.toLowerCase()}. It isn't reported unless you agree.`}
      </p>

      <div className={styles.verbs}>
        <div>
          <button
            type="button"
            className={styles.verb}
            data-open={side === "uphold" ? "true" : undefined}
            disabled={Boolean(reason) || busy}
            aria-expanded={side === "uphold"}
            onClick={() => openSide("uphold")}
          >
            <span className={styles.verbWord}>Agree, Report It</span>
            <span className={styles.consequence}>
              It gets marked for reporting, and the messages are kept for a year.
            </span>
          </button>
        </div>
        <div>
          <button
            type="button"
            className={styles.verb}
            data-open={side === "overturn" ? "true" : undefined}
            disabled={Boolean(reason) || busy}
            aria-expanded={side === "overturn"}
            onClick={() => openSide("overturn")}
          >
            <span className={styles.verbWord}>Don&apos;t Report</span>
            <span className={styles.consequence}>
              {`It stays open, and ${proposal.proposerName} sees your reason.`}
            </span>
          </button>
        </div>
        {reason ? <p className={styles.blocked}>{reason}</p> : null}
      </div>

      {side ? (
        <ReasonList
          decision="report"
          listKey={`concurrence-${side}`}
          reasons={concurrenceReasons(side)}
          title={
            side === "uphold" ? "What did you see?" : "Why not?"
          }
          busy={busy}
          onCommit={(picked) => void commit(picked)}
          onCancel={() => setSide(null)}
        />
      ) : null}

      <div className={styles.notes}>
        <Textarea
          id="concurrence-note"
          label="What in the conversation made you decide?"
          help="Required."
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {failure ? <p className={styles.failure}>{failure}</p> : null}
    </section>
  );
}
