/**
 * Formatting for the dashboard.
 *
 * Everything here is deterministic and in UTC. A locale-dependent or
 * timezone-dependent string rendered on the server and again in the browser is
 * a hydration mismatch, and an evidence surface that prints a timestamp without
 * naming its zone is the reason DESIGN.md 8 asks for timezone-explicit
 * timestamps in the first place.
 */

export function stampUtc(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return "not recorded";
  const iso = value.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** "3 h 12 m", "48 m", "0 m". Never a bare number without its unit. */
export function minutesWords(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "not recorded";
  const rounded = Math.round(minutes);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  if (abs < 60) return `${sign}${abs} m`;
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return rest === 0 ? `${sign}${hours} h` : `${sign}${hours} h ${rest} m`;
}

export function countWords(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** A share as a percentage, or the words for a share nobody can compute yet. */
export function percentWords(value: number | null): string {
  return value === null ? "no denominator yet" : `${value}%`;
}

/** First eight and last four of a hash. A full 64 characters helps nobody read a page. */
export function shortHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}
