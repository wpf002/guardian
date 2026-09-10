import Link from "next/link";
import type { AuditEntryView } from "@/lib/data/types";
import { clockUtc, dayKeyUtc, dayLabelUtc } from "./format";
import { entryDetail, kindWords } from "./kinds";
import styles from "./AuditEntries.module.css";

/**
 * The log, as a dated list.
 *
 * It was a table. Three columns wide, twenty-five rows deep, and the third
 * column was the word "Details" printed twenty-five times. The first column
 * repeated the same date on every row because a page holds about three hours.
 * The second was one of eleven sentences with nothing to tell two of them
 * apart. A table is the right shape when a reader compares rows against each
 * other; here they read down it looking for one thing, which is a list.
 *
 * So: a heading per day, the clock on each row, what happened in words, and
 * underneath it which conversation and what came of it. The row is the link.
 * Nothing here prints a sequence number or a hash. Both are on the entry page,
 * where somebody who needs them is already going.
 */

export interface AuditEntriesProps {
  entries: AuditEntryView[];
  /** Named for the screen reader, which cannot see the day headings. */
  caption: string;
}

interface Day {
  key: string;
  label: string;
  entries: AuditEntryView[];
}

/** Entries arrive newest first, so days come out newest first too. */
function byDay(entries: AuditEntryView[]): Day[] {
  const days: Day[] = [];
  for (const entry of entries) {
    const key = dayKeyUtc(entry.ts);
    const last = days[days.length - 1];
    if (last && last.key === key) {
      last.entries.push(entry);
      continue;
    }
    days.push({ key, label: dayLabelUtc(entry.ts), entries: [entry] });
  }
  return days;
}

export function AuditEntries({ entries, caption }: AuditEntriesProps) {
  const days = byDay(entries);

  return (
    <section className={styles.log} aria-label={caption}>
      {days.map((day) => (
        <div key={day.key} className={styles.day}>
          <h2 className={styles.dayLabel}>{day.label}</h2>
          <ol className={styles.rows}>
            {day.entries.map((entry) => {
              const detail = entryDetail(entry.payload);
              return (
                <li key={entry.seq}>
                  <Link className={styles.row} href={`/audit/${entry.seq}`}>
                    <span className={styles.time}>{clockUtc(entry.ts)}</span>
                    <span className={styles.what}>
                      <span className={styles.kind}>{kindWords(entry.kind)}</span>
                      {detail ? <span className={styles.detail}>{detail}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}
