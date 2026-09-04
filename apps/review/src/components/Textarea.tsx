"use client";

import type { TextareaHTMLAttributes } from "react";
import { Field, fieldDescribedBy } from "./Field";
import styles from "./Form.module.css";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  help?: string;
  error?: string;
  optional?: boolean;
}

/**
 * Notes are three prompts, never a blank box (DESIGN-UI 8.2), so the label on
 * one of these is a question rather than a noun.
 */
export function Textarea({ id, label, help, error, optional, ...rest }: TextareaProps) {
  return (
    <Field id={id} label={label} help={help} error={error} optional={optional}>
      <textarea
        {...rest}
        id={id}
        className={`${styles.control} ${styles.textarea} ${error ? styles.invalid : ""}`}
        aria-describedby={fieldDescribedBy(id, { help, error })}
        aria-invalid={error ? true : undefined}
      />
    </Field>
  );
}
