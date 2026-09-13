import { useId, type ReactNode } from "react";
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
  // The prop comment always said the title is the section's accessible name,
  // and nothing wired it: a section with no label is not a landmark, so a
  // screen reader listing regions skipped every card in the app.
  const titleId = useId();
  return (
    <Tag
      className={[styles.card, densityClass, className ?? ""].filter(Boolean).join(" ")}
      aria-labelledby={title && Tag === "section" ? titleId : undefined}
    >
      {title ? (
        <div className={styles.header}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          {aside ? <span className={styles.aside}>{aside}</span> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </Tag>
  );
}
