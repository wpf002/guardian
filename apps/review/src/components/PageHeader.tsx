import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export interface PageHeaderProps {
  title: string;
  /**
   * One line. Facts about what you are looking at: the partition, the window,
   * the count. Not an explanation of the page.
   */
  meta?: ReactNode;
  /**
   * The explanation. Every page in this app had a paragraph of it sitting
   * between the heading and the data, which pushed the work below the fold and
   * read as the interface justifying itself. It lives behind a disclosure now,
   * because a reviewer reads it once and an operator reads it when a number
   * surprises them.
   */
  about?: ReactNode;
  aboutLabel?: string;
  /** Sits opposite the title. A timer, a control, a status. */
  aside?: ReactNode;
}

export function PageHeader({
  title,
  meta,
  about,
  aboutLabel = "About this page",
  aside,
}: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <h1 className={styles.title}>{title}</h1>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
        {about ? (
          <details className={styles.about}>
            <summary className={styles.summary}>{aboutLabel}</summary>
            <div className={styles.aboutBody}>{about}</div>
          </details>
        ) : null}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </header>
  );
}
