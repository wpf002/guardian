import { Card } from "@/components";
import type { Feature } from "@/lib/data/types";
import styles from "./Case.module.css";

export interface WhyPanelProps {
  sentence: string;
  features: Feature[];
}

/**
 * Bars are relative to the largest term on this case, not to a global scale,
 * and each half of the track is half its width, so a term that raised the tier
 * and a term of the same size that lowered it draw the same length in opposite
 * directions.
 */
function barWidth(weight: number, largest: number): string {
  if (largest <= 0) return "0%";
  const pct = Math.max(0, Math.min(1, Math.abs(weight) / largest)) * 50;
  return `${pct.toFixed(0)}%`;
}

/**
 * One behavioural sentence and the terms behind the tier. The sentence is built
 * from data and has already passed the wording guard at the data boundary, so
 * nothing here re-checks it and nothing here throws mid-case.
 */
export function WhyPanel({ sentence, features }: WhyPanelProps) {
  const top = features.slice(0, 3);
  const largest = top.reduce((max, f) => Math.max(max, Math.abs(f.weight)), 0);

  return (
    <Card title="Why this is here" density="padded">
      <p className={styles.why}>{sentence}</p>
      {top.length === 0 ? (
        <p className={styles.note}>No fusion term was recorded against this pair.</p>
      ) : (
        <ul className={styles.features}>
          {top.map((feature) => {
            const negative = feature.weight < 0;
            return (
              <li key={feature.label} className={styles.feature}>
                <span className={styles.featureLabel}>
                  {feature.label}
                  {feature.critical ? (
                    <span className={styles.criticalWord}> · critical</span>
                  ) : null}
                  <span className={styles.directionWord}>
                    {negative ? " · pulled the tier down" : " · pushed the tier up"}
                  </span>
                </span>
                <span className={styles.featureWeight}>{feature.weight.toFixed(2)}</span>
                <span className={styles.bar} aria-hidden="true">
                  <span
                    className={[
                      styles.barFill,
                      negative ? styles.barNegative : "",
                      feature.critical ? styles.barCritical : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ width: barWidth(feature.weight, largest) }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.note}>
        These are the fusion terms behind the tier. Each bar runs from the centre line: right
        for a term that pushed the tier up, left for one that pulled it down. None of them is a
        probability, and none of them is a statement about a person.
      </p>
    </Card>
  );
}
