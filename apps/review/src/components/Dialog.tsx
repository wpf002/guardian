"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  title: string;
  /** Escape and the backdrop both call this. */
  onClose: () => void;
  /** Buttons. The primary action goes last, in reading order. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Focus is trapped while this is open and returned to whatever opened it when
 * it closes, because losing focus mid-case is the failure that makes a keyboard
 * reviewer reach for the mouse.
 */
export function Dialog({ open, title, onClose, footer, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const focusables = useCallback((): HTMLElement[] => {
    const panel = panelRef.current;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = (document.activeElement as HTMLElement) ?? null;
    const first = focusables()[0] ?? panelRef.current;
    first?.focus();
    return () => {
      returnFocusTo.current?.focus();
    };
  }, [open, focusables]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, focusables]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guardian-dialog-title"
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="guardian-dialog-title">
            {title}
          </h2>
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  );
}
