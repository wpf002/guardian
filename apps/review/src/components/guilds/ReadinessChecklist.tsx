import { Card } from "@/components";
import { READINESS } from "./copy";
import { isGuildReady, readiness } from "./readiness";
import type { GuildView } from "./types";
import styles from "./Guilds.module.css";

export interface ReadinessChecklistProps {
  config: GuildView;
}

/**
 * The same test the bot runs, printed. State is a glyph and a word, never a
 * colour on its own (RESEARCH 6.12).
 */
export function ReadinessChecklist({ config }: ReadinessChecklistProps) {
  const items = readiness(config);
  const ready = isGuildReady(config);

  return (
    <Card title={READINESS.title} as="section">
      <div className={styles.scoringLine}>
        <p className={styles.scoringWord}>{ready ? READINESS.onWord : READINESS.offWord}</p>
        <p className={styles.scoringDetail}>{ready ? READINESS.onDetail : READINESS.offDetail}</p>
      </div>
      <ul className={styles.checklist}>
        {items.map((item) => (
          <li key={item.key} className={styles.checkItem} data-done={item.done ? "true" : "false"}>
            <span className={styles.checkMark} aria-hidden="true">
              {item.done ? "●" : "○"}
            </span>
            <span className={styles.checkHead}>
              {item.label}
              <span className={styles.checkState}>
                {item.done ? READINESS.doneWord : READINESS.todoWord}
                {", "}
                {item.required ? READINESS.requiredWord : READINESS.optionalWord}
              </span>
            </span>
            <span className={styles.checkDetail}>{item.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
