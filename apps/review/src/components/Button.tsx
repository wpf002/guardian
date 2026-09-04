"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  /** Shows the word working and disables the button for the length of the write. */
  loading?: boolean;
  /**
   * Why the button is disabled, printed under it. A bare greyed control tells a
   * reviewer nothing, so a disabled state without a reason is not allowed here.
   */
  disabledReason?: string;
  fullWidth?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    loading = false,
    disabledReason,
    fullWidth = false,
    disabled,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = Boolean(disabled) || loading || Boolean(disabledReason);
  const classes = [styles.button, styles[variant], fullWidth ? styles.full : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={fullWidth ? styles.wrapFull : styles.wrap}>
      <button
        {...rest}
        ref={ref}
        type={type}
        className={classes}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        data-variant={variant}
        data-loading={loading ? "true" : undefined}
      >
        {children}
        {loading ? <span className={styles.spinner}>working</span> : null}
      </button>
      {disabledReason ? <span className={styles.reason}>{disabledReason}</span> : null}
    </span>
  );
});
