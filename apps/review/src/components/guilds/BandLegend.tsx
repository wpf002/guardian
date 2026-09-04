import { AGE_BANDS } from "@guardian/schema/agebands";
import { BANDS, BAND_LABEL, BAND_MEANING } from "./copy";
import styles from "./Guilds.module.css";

/**
 * All seven bands and what each one does, printed rather than hidden behind the
 * select. An owner mapping a role is deciding how a child's traffic gets
 * weighted, and the six-plus-unknown scheme is not self-explanatory: unknown in
 * particular reads like a gap and is not one.
 */
export function BandLegend() {
  return (
    <div>
      <h3 className={styles.subHeadingSpaced}>{BANDS.legendHeading}</h3>
      <dl className={styles.legend}>
        {AGE_BANDS.map((band) => (
          <div key={band} className={styles.legendRow}>
            <dt className={styles.legendTerm}>{BAND_LABEL[band]}</dt>
            <dd className={styles.legendDetail}>{BAND_MEANING[band]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
