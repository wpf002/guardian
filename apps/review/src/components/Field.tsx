"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./Form.module.css";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "children"> {
  id: string;
  label: string;
  /** One plain sentence. Not a tooltip. */
  help?: string;
  /** Names what is wrong with what was typed, in the same voice as the label. */
  error?: string;
  /** Marks the field optional in words. Required is the default and unmarked. */
  optional?: boolean;
  /** A control to render instead of the built-in input, for Select and Textarea. */
  children?: ReactNode;
}

/** Ids the help and error text are published under, for aria-describedby. */
export function fieldDescribedBy(id: string, opts: { help?: string; error?: string }): string | undefined {
  const parts = [opts.help ? `${id}-help` : "", opts.error ? `${id}-error` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function Field({ id, label, help, error, optional, children, ...rest }: FieldProps) {
  const describedBy = fieldDescribedBy(id, { help, error });
  return (
    <div className={styles.field} data-invalid={error ? "true" : undefined}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}>optional</span> : null}
      </label>
      {children ?? (
        <input
          {...rest}
          id={id}
          className={`${styles.control} ${error ? styles.invalid : ""}`}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
      )}
      {help ? (
        <span className={styles.help} id={`${id}-help`}>
          {help}
        </span>
      ) : null}
      {error ? (
        <span className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
