import type { ReactNode } from "react";
import styles from "./Card.module.css";

export interface CardProps {
  title?: ReactNode;
  /** Small muted text on the title row: an edit date, a count, a version. */
  aside?: ReactNode;
  footer?: ReactNode;
  density?: "tight" | "default" | "padded";
  /** Renders as a section with the title as its accessible name. */
  as?: "section" | "div" | "article";
  children: ReactNode;
  className?: string;
}

export function Card({
  title,
  aside,
  footer,
  density = "default",
  as: Tag = "section",
  children,
  className,
}: CardProps) {
  const densityClass =
    density === "tight" ? styles.tight : density === "padded" ? styles.padded : "";
  return (
    <Tag className={[styles.card, densityClass, className ?? ""].filter(Boolean).join(" ")}>
      {title ? (
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {aside ? <span className={styles.aside}>{aside}</span> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </Tag>
  );
}
