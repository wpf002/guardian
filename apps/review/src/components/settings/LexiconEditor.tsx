"use client";

import { useActionState } from "react";
import { Select } from "@/components/Select";
import { Textarea } from "@/components/Textarea";
import { SubmitButton } from "./SubmitButton";
import type { LexiconState, LexiconView } from "@/app/settings/types";
import styles from "./settings.module.css";

/**
 * The per-customer lexicon extension (DESIGN.md 6.5, RESEARCH 6.9 row 4).
 *
 * The merge only ever adds. There is no control here for the suppression and
 * exemption lists, because adding to one of those blinds the detector for this
 * customer, and that is the single thing the merge contract forbids.
 */

const INITIAL: LexiconState = {
  error: null,
  offendingFragment: null,
  instead: null,
  message: null,
};

export interface LexiconEditorProps {
  view: LexiconView;
  addAction: (previous: LexiconState, formData: FormData) => Promise<LexiconState>;
  removeAction: (previous: LexiconState, formData: FormData) => Promise<LexiconState>;
}

export function LexiconEditor({ view, addAction, removeAction }: LexiconEditorProps) {
  const [addState, addFormAction] = useActionState(addAction, INITIAL);
  const [removeState, removeFormAction] = useActionState(removeAction, INITIAL);

  const withPhrases = view.fields.filter((field) => field.added.length > 0);

  return (
    <div className={styles.form}>
      {/*
        The state, then the editor behind a disclosure.

        The form was 621px of a settings page: a list picker, a five-row
        textarea, a law-enforcement attestation and a button, open by default.
        Adding platform slang to the lexicon is something a server does once
        and then not again for months, and until somebody does it the only
        thing worth saying is which version is scoring and whether anything has
        been added to it.
      */}
      <p className={styles.blockNote}>
        {`Scoring on ${view.mergedVersion}. Every score records the version, so an old one can always be explained.`}
      </p>

      <details className={styles.shortcuts}>
        <summary className={styles.shortcutsSummary}>Add Phrases</summary>
        <form action={addFormAction} className={styles.form}>
        <Select
          id="field"
          name="field"
          label="Phrase list"
          options={view.fields.map((field) => ({
            value: field.field,
            label: `${field.label} (${field.baseCount} base, ${field.added.length} yours)`,
          }))}
          help="Only the lists a customer may add to are shown. Exemption and blocker lists are not extendable."
        />
        <Textarea
          id="phrases"
          name="phrases"
          label="Phrases to add, one per line"
          rows={5}
          help="Platform slang the base lexicon misses. Short phrases, not sentences. Normalization runs before matching, so add the plain spelling."
        />
        <div className={styles.check}>
          <input type="checkbox" id="attestation" name="attestation" />
          <label className={styles.checkLabel} htmlFor="attestation">
            This change was made on our own initiative and not at the direction of a law enforcement
            request.
          </label>
        </div>

        {addState.error ? (
          <p className={`${styles.banner} ${styles.bannerBad}`} role="alert">
            {addState.error}
            {addState.offendingFragment ? (
              <span className={styles.bannerQuote}>{addState.offendingFragment}</span>
            ) : null}
            {addState.instead ? (
              <span className={styles.bannerQuote}>Instead: {addState.instead}</span>
            ) : null}
          </p>
        ) : null}
        {addState.message ? (
          <p className={`${styles.banner} ${styles.bannerOk}`} role="status">
            {addState.message}
          </p>
        ) : null}

        <div className={styles.actions}>
          <SubmitButton variant="primary">Add phrases</SubmitButton>
          </div>
        </form>
      </details>

      {removeState.error ? (
        <p className={`${styles.banner} ${styles.bannerBad}`} role="alert">
          {removeState.error}
        </p>
      ) : null}
      {removeState.message ? (
        <p className={`${styles.banner} ${styles.bannerOk}`} role="status">
          {removeState.message}
        </p>
      ) : null}

      {/*
        Nothing added yet is one sentence, not a bordered panel with a title, a
        detail line and a meta line. An EmptyState earns its box when it is the
        whole page; here it sat under a form as a third of the card.
      */}
      {withPhrases.length > 0 ? (
        <h3 className={styles.subheading}>Phrases this customer added</h3>
      ) : null}

      {withPhrases.length === 0 ? (
        <p className={styles.blockNote}>
          {`Nothing added. Scoring is running on the base lexicon, ${view.baseVersion}, on every field.`}
        </p>
      ) : (
        <div className={styles.phraseGroups}>
          {withPhrases.map((field) => (
            <section key={field.field} className={styles.phraseGroup}>
              <h4 className={styles.phraseHead}>
                <span>{field.label}</span>
                <span className={styles.phraseCount}>
                  {field.added.length} yours, {field.baseCount} in the base
                </span>
              </h4>
              <ul className={styles.phraseList}>
                {field.added.map((phrase) => (
                  <li key={`${field.field}:${phrase}`} className={styles.phraseItem}>
                    <span className={styles.phraseText}>{phrase}</span>
                    <form action={removeFormAction}>
                      <input type="hidden" name="field" value={field.field} />
                      <input type="hidden" name="phrase" value={phrase} />
                      <SubmitButton variant="ghost">Remove</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
