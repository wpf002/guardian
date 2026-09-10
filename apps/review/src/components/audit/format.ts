/**
 * Formatting for the chain view.
 *
 * Times print in UTC and never in the reader's locale. Two reasons: the same
 * stamp has to read the same way in a bundle, an export and a courtroom, and a
 * locale format rendered on the server and rehydrated in a browser on another
 * timezone is a hydration mismatch on the one screen that has to be exact.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Example: 4 Sep 2026 14:07 UTC. */
export function formatUtc(ts: Date | string): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return "time not recorded";
  const month = MONTHS[date.getUTCMonth()] ?? "";
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(
    date.getUTCMinutes(),
  )} UTC`;
}

/** The first twelve characters, which is what a person reads off a screen. */
export function shortHash(hash: string): string {
  if (!hash) return "no hash recorded";
  return hash.length <= 16 ? hash : `${hash.slice(0, 12)}...`;
}

/** #40, so a sequence number is never mistaken for a count. */
export function seqLabel(seq: number): string {
  return `#${seq}`;
}

/** Just the clock, for a row under a day heading. Example: 20:26 UTC. */
export function clockUtc(ts: Date | string): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return "time not recorded";
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** The day a row belongs to, as a key that sorts and compares. */
export function dayKeyUtc(ts: Date | string): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * A day heading. "Today" and "Yesterday" relative to the reader's clock would
 * be a hydration mismatch and a different answer either side of midnight UTC,
 * so every heading is the date. The year is dropped when it is this one.
 */
export function dayLabelUtc(ts: Date | string, now = new Date()): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  const month = MONTHS[date.getUTCMonth()] ?? "";
  const year = date.getUTCFullYear();
  return year === now.getUTCFullYear()
    ? `${date.getUTCDate()} ${month}`
    : `${date.getUTCDate()} ${month} ${year}`;
}
