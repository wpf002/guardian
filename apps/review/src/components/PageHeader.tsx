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
   * What the page is, in a sentence or two, sitting open under the title.
   *
   * This was a disclosure headed "What This Is" that a reader had to click. A
   * control whose only job is to hide two sentences costs more attention than
   * the sentences do, and somebody who has not opened it is reading the page
   * without the one paragraph that says what they are looking at. Kept short
   * enough that it does not push the work below the fold.
   */
  about?: ReactNode;
  /** Sits opposite the title. A timer, a control, a status. */
  aside?: ReactNode;
}

export function PageHeader({ title, meta, about, aside }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <h1 className={styles.title}>{title}</h1>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
        {about ? <div className={styles.aboutBody}>{about}</div> : null}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </header>
  );
}
