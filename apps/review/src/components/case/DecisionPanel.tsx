"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Textarea, Toast } from "@/components";
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

const VERBS: Verb[] = [
  {
    decision: "dismiss",
    word: "Dismiss",
    hint: "1",
    consequence:
      "The pair returns to normal scoring, and retention drops to the T0 rules. It does not clear anyone of anything.",
    listTitle: "Why are you dismissing this pair?",
  },
  {
    decision: "watch",
    word: "Watch",
    hint: "2",
    consequence: "Holds the pair at T1, retains it 30 days, and raises its priority.",
    listTitle: "Why are you holding this pair at watch?",
  },
  {
    decision: "confirm",
    word: "Confirm T2",
    hint: "3",
    consequence:
      "Records a reviewer-confirmed T2. The friction your operator configured becomes available to them.",
    listTitle: "What pattern are you confirming?",
  },
  {
    decision: "report",
    word: "Propose T3",
    hint: "4",
    consequence:
      "Opens the proposal. It does not create tier T3, and it does not create a report.",
    listTitle: "Which incident type is this?",
  },
];

export interface DecisionPanelProps {
  pairId: string;
  /** The tier the model left the pair at. Undo restores this. */
  modelTier: Tier;
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
  modelTier,
  soleAutomatedBasis,
  timelineAvailable,
  readCount,
  totalExcerpts,
  missing,
  openedAt,
  onSubmit,
  onUndo,
  leaveHref,
}: DecisionPanelProps) {
  const timed = useMinutesOnCase(openedAt);
  const [openVerb, setOpenVerb] = useState<ReviewDecision | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const [correctedMinutes, setCorrectedMinutes] = useState<string>("");
  const [interrupted, setInterrupted] = useState(false);
  const [noteTimeline, setNoteTimeline] = useState("");
  const [noteContext, setNoteContext] = useState("");
  const [noteRecommendation, setNoteRecommendation] = useState("");

  const decided = outcome?.ok === true && !undone;
  const minutes = correctedMinutes.trim() === "" ? timed : Number(correctedMinutes);

  const blocked = useCallback(
    (decision: ReviewDecision): string | undefined => {
      if (decided) return "This case already carries a decision from you.";
      if (decision === "report" && soleAutomatedBasis) {
        return "This tier rests on the per-actor score alone, with no conversational fact on the pair. A report cannot be proposed from it.";
      }
      if (decision === "confirm" || decision === "report") {
        if (!timelineAvailable) {
          return "The evidence timeline did not load. Do not confirm or propose on the strip alone.";
        }
        if (readCount === 0) {
          return "No excerpt has been rendered to you yet. Open one in the timeline first.";
        }
      }
      return undefined;
    },
    [decided, readCount, soleAutomatedBasis, timelineAvailable],
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
        setFailure(result.error ?? "The decision was not recorded. Nothing changed.");
        return;
      }
      setOutcome(result);
      setOpenVerb(null);
      setProposeOpen(false);
    } catch {
      setFailure("The decision was not recorded. Nothing changed, and what you typed is still here.");
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
    const result = await onUndo({ pairId, reviewId: outcome.reviewId, restoreTier: modelTier });
    if (!result.ok) {
      setFailure(result.error ?? "The reversal was not recorded. The decision still stands.");
      return;
    }
    setUndone(true);
  }

  if (decided) {
    return (
      <section className={styles.panel} aria-label="Decision recorded">
        <div className={styles.result}>
          <h2 className={styles.title}>Decision recorded</h2>
          <p className={styles.resultSummary}>{outcome?.summary}</p>
          {outcome?.auditSeq ? (
            <p className={styles.consequence}>
              Chain entry <a href={`/audit/${outcome.auditSeq}`}>#{outcome.auditSeq}</a>.
            </p>
          ) : null}
          {outcome?.state === "proposed" ? (
            <p className={styles.consequence}>
              A proposal writes no tier. It waits for a second reviewer, and until they decide
              it can still be withdrawn by you.
            </p>
          ) : (
            <Toast
              message="You can reverse this decision. The original row is never edited."
              countdownSeconds={Math.round(UNDO_WINDOW_MS / 1000)}
              action={{ label: "Undo", onAction: () => void undo() }}
            />
          )}
          {failure ? <p className={styles.failure}>{failure}</p> : null}
          <div className={styles.escapes}>
            <Link className={styles.linkEscape} href={leaveHref}>
              Next case
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="Decision">
      <h2 className={styles.title}>Your decision</h2>
      <p className={styles.lead}>
        Guardian assigned tier {modelTier}. Only a reviewer and a second reviewer together can
        produce T3. Every decision carries a reason.
      </p>

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
                <span className={styles.verbWord}>
                  {verb.word}
                  <span className={styles.hint}>{verb.hint}</span>
                </span>
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

      <div className={styles.notes}>
        <Textarea
          id="note-timeline"
          label="What in the timeline supports this?"
          help="Required on confirm and on a proposal. Optional on dismiss and watch."
          rows={3}
          value={noteTimeline}
          onChange={(event) => setNoteTimeline(event.target.value)}
        />
        <Textarea
          id="note-context"
          label="What context did you gather outside the timeline?"
          optional
          rows={2}
          value={noteContext}
          onChange={(event) => setNoteContext(event.target.value)}
        />
        <Textarea
          id="note-recommendation"
          label="What are you recommending the operator do?"
          help="This one survives into the report as your context note."
          optional
          rows={2}
          value={noteRecommendation}
          onChange={(event) => setNoteRecommendation(event.target.value)}
        />
      </div>

      {openVerb || proposeOpen ? (
        <div className={styles.minutes}>
          <label className={styles.check} htmlFor="minutes-spent">
            <span>
              Minutes on this case
              <input
                id="minutes-spent"
                className={styles.minutesField}
                type="number"
                min={0}
                inputMode="numeric"
                value={correctedMinutes === "" ? String(timed) : correctedMinutes}
                onChange={(event) => setCorrectedMinutes(event.target.value)}
              />
            </span>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={interrupted}
              onChange={(event) => setInterrupted(event.target.checked)}
            />
            <span>This was interrupted</span>
          </label>
        </div>
      ) : null}

      {failure ? (
        <p className={styles.failure}>
          {failure} <Button variant="secondary" onClick={() => setFailure(null)}>Try again</Button>
        </p>
      ) : null}

      <div className={styles.escapes}>
        <Link className={styles.linkEscape} href={leaveHref}>
          Defer, I need a buffer
        </Link>
        <Button
          variant="ghost"
          disabledReason="Escalating to a second reviewer without deciding needs the concurrence route, which is not built yet."
        >
          Escalate
        </Button>
        <Button
          variant="ghost"
          disabledReason="Requesting context needs the operator message path, which is not built yet."
        >
          Request context
        </Button>
      </div>

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
