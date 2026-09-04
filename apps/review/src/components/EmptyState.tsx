import type { ReactNode } from "react";
import styles from "./States.module.css";

export interface EmptyStateProps {
  /** Names the state. */
  title: string;
  /** The last known good fact, so a reviewer can tell empty from broken. */
  detail: string;
  /** One action, at most. */
  action?: ReactNode;
  meta?: string;
}

export function EmptyState({ title, detail, action, meta }: EmptyStateProps) {
  return (
    <div className={styles.state} data-state="empty">
      <p className={styles.title}>{title}</p>
      <p className={styles.detail}>{detail}</p>
      {meta ? <p className={styles.meta}>{meta}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
