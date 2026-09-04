"use client";

import type { SelectHTMLAttributes } from "react";
import { Field, fieldDescribedBy } from "./Field";
import styles from "./Form.module.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  id: string;
  label: string;
  options: SelectOption[];
  help?: string;
  error?: string;
  optional?: boolean;
}

export function Select({ id, label, options, help, error, optional, ...rest }: SelectProps) {
  return (
    <Field id={id} label={label} help={help} error={error} optional={optional}>
      <select
        {...rest}
        id={id}
        className={`${styles.control} ${styles.select} ${error ? styles.invalid : ""}`}
        aria-describedby={fieldDescribedBy(id, { help, error })}
        aria-invalid={error ? true : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
