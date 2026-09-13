"use client";

import { useActionState } from "react";
import formStyles from "@/components/Form.module.css";
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

  /*
   * One line to add a phrase, and the phrases already added as tags.
   *
   * It was a status line, a disclosure, a labelled list picker, a five-row
   * textarea with a help line, the attestation, a button, and "Nothing added
   * yet" at the bottom. Somebody adding a slang word needs to pick what kind it
   * is, type it and press add. The attestation stays, because the change log
   * records it, directly under the row it applies to.
   */
  return (
    <div className={styles.lexicon}>
      <p className={styles.cardIntro}>Slang or code words your members use that Guardian might miss</p>

      <form action={addFormAction} className={styles.addForm}>
        <div className={styles.addRow}>
          <select
            name="field"
            aria-label="Kind of phrase"
            className={`${formStyles.control} ${formStyles.select} ${styles.addKind}`}
            defaultValue={view.fields[0]?.field}
          >
            {view.fields.map((field) => (
              <option key={field.field} value={field.field}>
                {field.label}
              </option>
            ))}
          </select>
          <input
            name="phrases"
            aria-label="Phrase to add"
            placeholder="Type a phrase"
            autoComplete="off"
            className={`${formStyles.control} ${styles.addPhrase}`}
          />
          <SubmitButton variant="primary">Add Phrase</SubmitButton>
        </div>
        <label className={styles.attest}>
          <input type="checkbox" name="attestation" />
          <span>This is our own decision. No police or government agency asked us to make it</span>
        </label>

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
      </form>

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

      {withPhrases.length === 0 ? (
        <p className={styles.quiet}>None added yet. Guardian is using its built-in list</p>
      ) : (
        <div className={styles.addedGroups}>
          <h3 className={styles.subheading}>Phrases this customer added</h3>
          {withPhrases.map((field) => (
            <div key={field.field} className={styles.addedGroup}>
              <span className={styles.addedKind}>{field.label}</span>
              <ul className={styles.phraseTags}>
                {field.added.map((phrase) => (
                  <li key={`${field.field}:${phrase}`} className={styles.phraseTag}>
                    <span>{phrase}</span>
                    <form action={removeFormAction}>
                      <input type="hidden" name="field" value={field.field} />
                      <input type="hidden" name="phrase" value={phrase} />
                      <SubmitButton variant="ghost" className={styles.phraseRemove} aria-label={`Remove ${phrase}`}>
                        ×
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
