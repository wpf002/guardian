import type { ReactNode } from "react";
import styles from "./SettingsPanel.module.css";

/**
 * The settings layout both settings pages share: a group heading, then one
 * panel with a row per setting, what it is on the left and the control on the
 * right.
 *
 * Settings was a stack of cards, each with a title, an accent underline, a
 * full-width rule and an intro sentence, so every setting spent four lines of
 * chrome before its control. The server setup page moved to rows first; this
 * is the same component, so the two pages cannot drift apart.
 */

export function SettingsGroup({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.group} aria-label={title}>
      <div className={styles.groupHead}>
        <h2 className={styles.groupTitle}>{title}</h2>
        {note ? <p className={styles.groupNote}>{note}</p> : null}
      </div>
      <div className={styles.panel}>{children}</div>
    </section>
  );
}

export function SettingsRow({
  id,
  label,
  help,
  heading = "h3",
  children,
}: {
  id?: string;
  label: string;
  help?: string;
  /** h2 where the row is the top level of its page, h3 inside a group. */
  heading?: "h2" | "h3";
  children: ReactNode;
}) {
  const Heading = heading;
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <Heading className={styles.rowLabel} id={id}>
          {label}
        </Heading>
        {help ? <p className={styles.rowHelp}>{help}</p> : null}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/** A panel of rows with no group heading, for a page that is one group. */
export function SettingsPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={styles.panel} aria-label={label}>
      {children}
    </section>
  );
}

/** Content that needs the whole panel width, like a form or a reference sheet. */
export function SettingsBlock({ children }: { children: ReactNode }) {
  return <div className={styles.block}>{children}</div>;
}
