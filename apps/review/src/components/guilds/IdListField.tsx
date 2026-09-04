"use client";

import { useId, useState } from "react";
import { Button, Field } from "@/components";
import { SNOWFLAKE, SNOWFLAKE_ERROR, SNOWFLAKE_HELP } from "./copy";
import styles from "./Guilds.module.css";

export interface IdListFieldProps {
  /** Label on the add control. */
  label: string;
  addLabel: string;
  /** What one entry is called, for the remove button's accessible name. */
  itemLabel: string;
  removeLabel: string;
  emptyMessage: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  duplicateMessage: string;
}

/**
 * A list of Discord ids with add and remove. Every id is validated in the same
 * shape the server action validates it, so a typo is caught before a write
 * rather than after one.
 */
export function IdListField({
  label,
  addLabel,
  itemLabel,
  removeLabel,
  emptyMessage,
  value,
  onChange,
  disabled = false,
  duplicateMessage,
}: IdListFieldProps) {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const trimmed = draft.trim();
    if (!SNOWFLAKE.test(trimmed)) {
      setError(SNOWFLAKE_ERROR);
      return;
    }
    if (value.includes(trimmed)) {
      setError(duplicateMessage);
      return;
    }
    setError(null);
    setDraft("");
    onChange([...value, trimmed]);
  }

  return (
    <div>
      <div className={styles.controls}>
        <Field
          id={inputId}
          label={label}
          help={SNOWFLAKE_HELP}
          error={error ?? undefined}
          inputMode="numeric"
          autoComplete="off"
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} disabled={disabled}>
          {addLabel}
        </Button>
      </div>

      {value.length === 0 ? (
        <p className={styles.empty}>{emptyMessage}</p>
      ) : (
        <ul className={styles.idList}>
          {value.map((id) => (
            <li key={id} className={styles.idRow}>
              <span className={styles.mono}>{id}</span>
              <Button
                variant="ghost"
                disabled={disabled}
                aria-label={`${removeLabel} ${itemLabel} ${id}`}
                onClick={() => onChange(value.filter((entry) => entry !== id))}
              >
                {removeLabel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
