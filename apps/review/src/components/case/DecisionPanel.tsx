"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Textarea, Toast } from "@/components";
import { announce } from "@/lib/announce";
import { UNDO_WINDOW_MS, type Reason } from "@/lib/reasons";
import type { ReviewDecision, Tier } from "@/lib/data/types";
import type {
  DecisionOutcome,
  SubmitDecisionInput,
  UndoInput,
} from "@/app/cases/[id]/actions";
import { ConsequenceCopy } from "./ConsequenceCopy";
import { ProposeDialog, type ProposePayload } from "./ProposeDialog";
import { ReasonList } from "./ReasonList";
import styles from "./Decision.module.css";

interface Verb {
  decision: ReviewDecision;
  word: string;
  hint: string;
  consequence: string;
  listTitle: string;
}

/*
 * The four choices, in the words somebody would use.
 *
 * They were "Dismiss", "Watch", "Confirm T2" and "Propose T3", each with a
 * line about tiers, retention rules and "the friction your operator
 * configured". The decision codes underneath are unchanged, and so are the
 * number keys; the badges that printed them are gone.
 */
const VERBS: Verb[] = [
  {
    decision: "dismiss",
    word: "Not a Concern",
    hint: "1",
    consequence: "Guardian goes back to watching as normal.",
    listTitle: "Why isn't this a concern?",
  },
  {
    decision: "watch",
    word: "Keep an Eye on It",
    hint: "2",
    consequence: "Guardian keeps this for 30 days and brings it back if anything new happens.",
    listTitle: "Why keep an eye on it?",
  },
  {
    decision: "confirm",
    word: "This Is a Concern",
    hint: "3",
    consequence: "Your moderators can act on it, like a timeout.",
    listTitle: "What did you see?",
  },
  {
    decision: "report",
    word: "Report It",
    hint: "4",
    consequence: "Someone else on your team has to agree before anything is reported.",
    listTitle: "What kind of report is this?",
  },
];

export interface DecisionPanelProps {
  pairId: string;
  /**
   * The tier the kernel itself assigned. Null on a pair scored before that
   * column existed, and the lead sentence says so rather than printing the
   * pair's current tier, which is a reviewer's after any earlier decision
   * (ROADMAP S-9).
   */
  modelTier: Tier | null;
  /**
   * False when this partition has one reviewer seat.
   *
   * A T3 needs two people. A 40-person server has one moderator, and that is
   * the segment this product is for, so the honest thing is to say at the
   * decision that no proposal here can be upheld, rather than letting the
   * operator find out after they have made one (ROADMAP D-3).
   */
  secondSeat: boolean;
  soleAutomatedBasis: boolean;
  /** False when the evidence timeline could not be loaded. */
  timelineAvailable: boolean;
  /** Excerpts legibly rendered to this reviewer so far. */
  readCount: number;
  totalExcerpts: number;
  /** Things the bundle does not carry, named one by one. */
  missing: string[];
  /** Epoch ms when this case was opened, for the minutes figure. */
  openedAt: number;
  onSubmit: (input: SubmitDecisionInput) => Promise<DecisionOutcome>;
  onUndo: (input: UndoInput) => Promise<DecisionOutcome>;
  /**
   * Told when a decision lands, so the console keeps this panel mounted for the
   * length of the undo window rather than swapping in the resolved view the
   * moment the route revalidates.
   */
  onDecisionRecorded?: () => void;
  /** Told when the reviewer reverses it, so the hold is released early. */
  onDecisionReversed?: () => void;
  /** Where the escapes go. */
  leaveHref: string;
}

/**
 * Minutes on the case, timed from open and paused when the tab has been hidden
 * for more than 30 seconds.
 *
 * This number feeds reviewer minutes per 1,000 users and nothing else. It is
 * shown to the reviewer only at the moment they can correct it, there is no
 * running timer on the case, and no per-reviewer pace value exists anywhere in
 * this app.
 */
function useMinutesOnCase(openedAt: number): number {
  const accumulated = useRef(0);
  const lastTick = useRef(openedAt);
  const hiddenAt = useRef<number | null>(null);
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    function credit(now: number) {
      accumulated.current += Math.max(0, now - lastTick.current);
      lastTick.current = now;
    }

    function onVisibility() {
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        credit(now);
        hiddenAt.current = now;
        return;
      }
      const away = hiddenAt.current === null ? 0 : now - hiddenAt.current;
      hiddenAt.current = null;
      // A glance away is still time on the case. A real interruption is not.
      lastTick.current = away <= 30_000 ? lastTick.current : now;
      credit(now);
      setMinutes(Math.round(accumulated.current / 60_000));
    }

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      credit(Date.now());
      setMinutes(Math.round(accumulated.current / 60_000));
    }, 15_000);

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [openedAt]);

  return minutes;
}

export function DecisionPanel({
  pairId,
  secondSeat,
  soleAutomatedBasis,
  timelineAvailable,
  readCount,
  totalExcerpts,
  missing,
  openedAt,
  onSubmit,
  onUndo,
  onDecisionRecorded,
  onDecisionReversed,
  leaveHref,
}: DecisionPanelProps) {
  const timed = useMinutesOnCase(openedAt);
  const recordedRef = useRef<HTMLElement>(null);
  const [openVerb, setOpenVerb] = useState<ReviewDecision | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  // Taken automatically. The fields that let a reviewer correct the minutes or
  // mark the case interrupted went with the reporting page that read them.
  const correctedMinutes = "";
  const interrupted = false;
  const [noteTimeline, setNoteTimeline] = useState("");
  const [noteContext, setNoteContext] = useState("");
  const [noteRecommendation, setNoteRecommendation] = useState("");

  const decided = outcome?.ok === true && !undone;
  const minutes = correctedMinutes.trim() === "" ? timed : Number(correctedMinutes);

  /**
   * DESIGN-UI 12: after a decision, focus lands on the confirmation region and
   * the next Tab reaches Undo. It never lands on nothing. Committing unmounts
   * the whole verb subtree, so without this the reviewer's focus falls to the
   * document and their next Tab restarts above the rail.
   */
  useEffect(() => {
    if (!decided) return;
    recordedRef.current?.focus();
    announce(
      outcome?.state === "proposed"
        ? "Saved. You can take it back until someone else answers."
        : `Saved. You can undo this for the next ${Math.round(UNDO_WINDOW_MS / 1000)} seconds.`,
    );
  }, [decided, outcome?.state, outcome?.summary]);

  const blocked = useCallback(
    (decision: ReviewDecision): string | undefined => {
      if (decided) return "You've already decided on this one.";
      if (decision === "report" && !secondSeat) {
        return "Reporting needs a second person on your team.";
      }
      if (decision === "report" && soleAutomatedBasis) {
        return "Nothing in this conversation itself can be reported. It's here because of the account's other conversations.";
      }
      if (decision === "confirm" || decision === "report") {
        if (!timelineAvailable) {
          return "The conversation didn't load. Reload the page first.";
        }
        if (readCount === 0) {
          return "Read the conversation above first.";
        }
      }
      return undefined;
    },
    [decided, readCount, secondSeat, soleAutomatedBasis, timelineAvailable],
  );

  const openList = useCallback(
    (decision: ReviewDecision) => {
      if (blocked(decision)) return;
      setFailure(null);
      if (decision === "report") {
        setOpenVerb(null);
        setProposeOpen(true);
        return;
      }
      setProposeOpen(false);
      setOpenVerb((current) => (current === decision ? null : decision));
    },
    [blocked],
  );

  // No binding fires while focus is in a text field, a filter or an attestation.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const verb = VERBS.find((v) => v.hint === event.key);
      if (verb) {
        event.preventDefault();
        openList(verb.decision);
        return;
      }
      if (event.key === "Escape") {
        setOpenVerb(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openList]);

  const notes = {
    timeline: noteTimeline.trim() || undefined,
    outsideContext: noteContext.trim() || undefined,
    recommendation: noteRecommendation.trim() || undefined,
  };

  async function send(input: SubmitDecisionInput) {
    setBusy(input.decision);
    setFailure(null);
    try {
      const result = await onSubmit(input);
      if (!result.ok) {
        setFailure(result.error ?? "That didn't save. Nothing changed.");
        return;
      }
      setOutcome(result);
      setOpenVerb(null);
      setProposeOpen(false);
      onDecisionRecorded?.();
    } catch {
      setFailure("That didn't save. Nothing changed, and what you typed is still here.");
    } finally {
      setBusy(null);
    }
  }

  function commit(reason: Reason) {
    void send({
      pairId,
      decision: reason.decision,
      reasonCode: reason.code,
      notes,
      minutesSpent: Number.isFinite(minutes) ? minutes : undefined,
      interrupted,
      viewedExcerptCount: readCount,
    });
  }

  function commitProposal(payload: ProposePayload) {
    void send({
      pairId,
      decision: "report",
      reasonCode: payload.reasonCode,
      reasonDetail: payload.imminentDangerReason
        ? { imminentDangerReason: payload.imminentDangerReason }
        : undefined,
      notes,
      minutesSpent: Number.isFinite(minutes) ? minutes : undefined,
      interrupted,
      viewedExcerptCount: readCount,
      annotations: payload.annotations,
      lawEnforcementRequested: payload.lawEnforcementRequested,
    });
  }

  async function undo() {
    if (!outcome?.reviewId) return;
    const result = await onUndo({ pairId, reviewId: outcome.reviewId });
    if (!result.ok) {
      setFailure(result.error ?? "Undo didn't save. Your decision still stands.");
      return;
    }
    setUndone(true);
    onDecisionReversed?.();
    announce("Undone.");
  }

  if (decided) {
    return (
      <section className={styles.panel} aria-label="Decision recorded" ref={recordedRef} tabIndex={-1}>
        <div className={styles.result}>
          <h2 className={styles.title}>Saved</h2>
          <p className={styles.resultSummary}>{outcome?.summary}</p>
          {/* The undo bar comes before the chain link, because DESIGN-UI 12
              makes Undo the first tab stop after the confirmation region. */}
          {outcome?.state === "proposed" ? (
            <p className={styles.consequence}>
              Someone else on your team has to agree before it&apos;s reported.
            </p>
          ) : (
            <Toast
              message={`You can undo this for ${Math.round(UNDO_WINDOW_MS / 1000)} seconds.`}
              countdownSeconds={Math.round(UNDO_WINDOW_MS / 1000)}
              action={{ label: "Undo", onAction: () => void undo() }}
            />
          )}
          {failure ? <p className={styles.failure}>{failure}</p> : null}
          <div className={styles.escapes}>
            <Link className={styles.linkEscape} href={leaveHref}>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="Decision">
      <h2 className={styles.title}>Your Decision</h2>
      {/*
        Only when it changes what you can do. The lead used to name the tier
        Guardian assigned and explain that two reviewers produce T3, on every
        case, before a single button.
      */}
      {!secondSeat ? (
        <p className={styles.lead}>
          You&apos;re the only person on your team, so Guardian can&apos;t send a report. If this
          needs reporting, mark it a concern and report it yourself at report.cybertip.org.
        </p>
      ) : null}

      <div className={styles.verbs}>
        {VERBS.map((verb) => {
          const reason = blocked(verb.decision);
          return (
            <div key={verb.decision}>
              <button
                type="button"
                className={styles.verb}
                data-open={openVerb === verb.decision ? "true" : undefined}
                disabled={Boolean(reason) || busy !== null}
                aria-expanded={openVerb === verb.decision}
                onClick={() => openList(verb.decision)}
              >
                <span className={styles.verbWord}>{verb.word}</span>
                <span className={styles.consequence}>{verb.consequence}</span>
              </button>
              {reason ? <p className={styles.blocked}>{reason}</p> : null}
            </div>
          );
        })}
      </div>

      {openVerb ? (
        <ReasonList
          decision={openVerb}
          title={VERBS.find((v) => v.decision === openVerb)?.listTitle ?? "Pick a reason"}
          busy={busy !== null}
          onCommit={commit}
          onCancel={() => setOpenVerb(null)}
        />
      ) : null}

      {openVerb === "confirm" ? <ConsequenceCopy context="confirm" /> : null}

      {/*
        One box in the open, and the other two folded. All three sat open on
        every case, and the minutes-on-this-case field and the interrupted
        checkbox under them were workload measurement for a reporting page that
        no longer exists. The time is still taken automatically.
      */}
      <div className={styles.notes}>
        <Textarea
          id="note-timeline"
          label="What in the conversation made you decide?"
          help="Needed to mark it a concern or report it."
          rows={3}
          value={noteTimeline}
          onChange={(event) => setNoteTimeline(event.target.value)}
        />
        <details>
          <summary className={styles.moreSummary}>Add More Detail</summary>
          <Textarea
            id="note-context"
            label="Anything you know from outside this conversation?"
            optional
            rows={2}
            value={noteContext}
            onChange={(event) => setNoteContext(event.target.value)}
          />
          <Textarea
            id="note-recommendation"
            label="What should your moderators do?"
            help="This goes into the report."
            optional
            rows={2}
            value={noteRecommendation}
            onChange={(event) => setNoteRecommendation(event.target.value)}
          />
        </details>
      </div>

      {failure ? (
        <p className={styles.failure}>
          {failure} <Button variant="secondary" onClick={() => setFailure(null)}>Try Again</Button>
        </p>
      ) : null}

      <ProposeDialog
        open={proposeOpen}
        busy={busy === "report"}
        readCount={readCount}
        totalExcerpts={totalExcerpts}
        missingNote={noteTimeline.trim().length === 0}
        missing={missing}
        onClose={() => setProposeOpen(false)}
        onSubmit={commitProposal}
      />
    </section>
  );
}
