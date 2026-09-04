import styles from "./PayloadList.module.css";

/**
 * A chain payload as key and value.
 *
 * The chain holds hashes, tiers, versions and identifiers, and it never holds
 * message text, so this renders whatever it is given without a reveal control
 * and without a collapse. The one exception is defensive: if a key that would
 * carry an excerpt ever appears, the key still prints and the value does not,
 * because a payload that should not exist is a defect somebody has to see.
 */

const TEXT_KEYS = new Set([
  "text",
  "message",
  "messages",
  "content",
  "excerpt",
  "excerpts",
  "body",
  "transcript",
]);

export const TEXT_KEY_NOTE = "not rendered here. The chain does not carry message text.";

export interface PayloadListProps {
  payload: Record<string, unknown>;
  /** Compact drops the padding for a table cell. */
  density?: "compact" | "default";
}

function renderValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "not set";
  if (typeof value === "string") return value.length === 0 ? "empty string" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? "empty list" : value.map((item) => renderValue(item)).join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "value could not be read";
  }
}

export function PayloadList({ payload, density = "default" }: PayloadListProps) {
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return <p className={styles.none}>No payload on this entry.</p>;
  }
  return (
    <dl className={`${styles.list} ${density === "compact" ? styles.compact : ""}`}>
      {keys.map((key) => {
        const withheld = TEXT_KEYS.has(key.toLowerCase());
        return (
          <div className={styles.pair} key={key}>
            <dt className={styles.key}>{key}</dt>
            <dd className={withheld ? styles.withheld : styles.value}>
              {withheld ? TEXT_KEY_NOTE : renderValue(payload[key])}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
