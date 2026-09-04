import styles from "./StagePath.module.css";
import type { Stage, StagePoint } from "@/lib/data/types";

/** The six steps, in ladder order. "none" is not a rung. */
export const STAGE_LADDER: Stage[] = [
  "contact",
  "trust",
  "probe",
  "migrate",
  "sexualize",
  "coerce",
];

export interface StagePathProps {
  /** Stages this pair reached, in the order they were reached. */
  path: StagePoint[];
  /** Which escalation window carried the velocity term, named beneath. */
  velocityWindow?: string | null;
  /** Printed when the tier rests on the actor score alone. */
  soleAutomatedBasis?: boolean;
}

export function StagePath({ path, velocityWindow, soleAutomatedBasis }: StagePathProps) {
  const reached = new Map(path.map((point, index) => [point.stage, { point, order: index + 1 }]));

  if (path.length === 0) {
    return (
      <div>
        <p className={styles.empty}>No stage was reached in this window.</p>
        {soleAutomatedBasis ? (
          <p className={styles.window}>
            The per-actor score alone stands behind this tier. A report cannot be proposed from it.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <ol className={styles.path}>
        {STAGE_LADDER.map((stage) => {
          const hit = reached.get(stage);
          return (
            <li
              key={stage}
              className={`${styles.cell} ${hit ? styles.reached : ""}`}
              data-stage={stage}
              data-reached={hit ? "true" : "false"}
            >
              <span className={styles.name}>{stage}</span>
              <span className={styles.order}>{hit ? `reached ${hit.order}` : "not reached"}</span>
              {hit?.point.elapsedHoursFromPrevious !== null &&
              hit?.point.elapsedHoursFromPrevious !== undefined ? (
                <span className={styles.elapsed}>
                  {hit.point.elapsedHoursFromPrevious}h after the last
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {velocityWindow ? (
        <p className={styles.window}>Velocity window: {velocityWindow}.</p>
      ) : null}
      {soleAutomatedBasis ? (
        <p className={styles.window}>
          The per-actor score alone stands behind this tier. A report cannot be proposed from it.
        </p>
      ) : null}
    </div>
  );
}
