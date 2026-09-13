import Link from "next/link";
import type { Conversation } from "@/lib/data/conversations";
import { conversationFor } from "@/lib/data/conversations";
import type { AuditEntryView } from "@/lib/data/types";
import { clockUtc, dayKeyUtc, dayLabelUtc } from "./format";
import { entryDetail, kindWords } from "./kinds";
import styles from "./AuditEntries.module.css";

/**
 * The log, as a timeline, with each entry tied to the conversation it is about.
 *
 * Every row carried "Conversation 4f2a", which is a database key, and the whole
 * row was one link to the record. There was no way to follow one conversation:
 * to see that Guardian scored it at 18:23, a reviewer read it at 19:40, a report
 * was proposed at 19:52 and the evidence left at 20:05. Now the two account names link to that conversation's own
 * history, where every entry about it reads in order. The time opens the record.
 */

export interface AuditEntriesProps {
  entries: AuditEntryView[];
  /** Named for the screen reader, which cannot see the day headings. */
  caption: string;
  /** Flagged conversations, to name the one each entry is about. */
  conversations: Conversation[];
  /** Set when the log is already showing one conversation, so rows do not repeat it. */
  within?: Conversation | null;
}

interface Day {
  key: string;
  label: string;
  entries: AuditEntryView[];
}

/** Consecutive entries on the same day, in whatever order they arrive. */
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

export function AuditEntries({ entries, caption, conversations, within = null }: AuditEntriesProps) {
  const days = byDay(entries);

  return (
    <section className={styles.log} aria-label={caption}>
      {days.map((day) => (
        <div key={day.key} className={styles.day}>
          <h2 className={styles.dayLabel}>{day.label}</h2>
          <ol className={styles.rows}>
            {day.entries.map((entry) => {
              const about = within ? null : conversationFor(entry.payload, conversations);
              const detail = entryDetail(entry.payload, { withConversation: false });
              return (
                <li key={entry.seq} className={styles.row}>
                  {/* The time opens the record, the way a message timestamp does. */}
                  <Link className={styles.time} href={`/audit/${entry.seq}`} title="Open this record">
                    {clockUtc(entry.ts)}
                  </Link>
                  <span className={styles.what}>
                    <span className={styles.kind}>{kindWords(entry.kind)}</span>
                    {about || detail ? (
                      <span className={styles.detail}>
                        {about ? (
                          <Link
                            className={styles.conversation}
                            href={`/audit?conversation=${encodeURIComponent(about.ref.pairId)}`}
                            title="See this conversation's history"
                          >
                            {about.label}
                          </Link>
                        ) : null}
                        {about && detail ? <span aria-hidden="true"> · </span> : null}
                        {detail ? <span>{detail}</span> : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}
