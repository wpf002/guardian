import { Card } from "@/components";
import { BOUNDARIES } from "./copy";
import styles from "./Guilds.module.css";

/**
 * The refusals matter as much as the actions (DESIGN.md 8). The right-hand
 * column is FORBIDDEN_ACTIONS from apps/discord-bot/src/actions.ts, written in
 * the second person. If that list changes, this one changes with it.
 */
export function BotBoundaries() {
  return (
    <Card title={BOUNDARIES.title} as="section">
      <div className={styles.boundaries}>
        <div>
          <h3 className={styles.boundaryHeading}>{BOUNDARIES.doesHeading}</h3>
          <ul className={styles.boundaryList}>
            {BOUNDARIES.does.map((line) => (
              <li key={line}>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={styles.boundaryHeading}>{BOUNDARIES.notHeading}</h3>
          <ul className={styles.boundaryList}>
            {BOUNDARIES.not.map((line) => (
              <li key={line}>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className={styles.note}>{BOUNDARIES.closing}</p>
    </Card>
  );
}
