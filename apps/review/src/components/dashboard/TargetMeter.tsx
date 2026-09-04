import { Stat } from "@/components";
import styles from "./TargetMeter.module.css";

/**
 * One figure against the target it is measured by, as inline SVG.
 *
 * The target is drawn as a tick and named in words, and whether the figure sits
 * inside it is said in a sentence rather than in a colour. RESEARCH 6.13 asks
 * for a calm surface with no alarm styling, and a bar that turns red is alarm
 * styling for a number a trust and safety lead reads once a week.
 *
 * Server component. Nothing here is interactive.
 */

export interface TargetMeterProps {
  label: string;
  /** Null renders the unavailable sentence rather than a zero. */
  value: number | null;
  /** The value as the reader should see it, with its unit. */
  display: string;
  unavailableNote?: string;
  target: number;
  /** The target in words, for example "target 4 hours". */
  targetDisplay: string;
  /** Which side of the target is the passing side. */
  direction: "at-or-below" | "at-or-above";
  /** Axis ceiling. Defaults to a quarter above whichever of value and target is larger. */
  max?: number;
  /** One extra sentence under the meter, for a sample size or a caveat. */
  note?: string;
}

const WIDTH = 320;
const HEIGHT = 14;
const TRACK_Y = 3;
const TRACK_HEIGHT = 8;

export function TargetMeter({
  label,
  value,
  display,
  unavailableNote,
  target,
  targetDisplay,
  direction,
  max,
  note,
}: TargetMeterProps) {
  const ceiling = Math.max(max ?? 0, target, value ?? 0, 1) * 1.25;
  const filled = value === null ? 0 : Math.max(Math.min((value / ceiling) * WIDTH, WIDTH), 2);
  const tick = Math.min((target / ceiling) * WIDTH, WIDTH - 1);
  const meets =
    value === null ? null : direction === "at-or-below" ? value <= target : value >= target;

  const status =
    meets === null
      ? null
      : meets
        ? `Inside the target of ${targetDisplay}.`
        : `Over the target of ${targetDisplay}.`;

  return (
    <div className={styles.meter}>
      <Stat
        label={label}
        value={value === null ? null : display}
        unavailableNote={unavailableNote}
        target={`target ${targetDisplay}`}
      />
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          className={styles.track}
          x={0}
          y={TRACK_Y}
          width={WIDTH}
          height={TRACK_HEIGHT}
          rx={TRACK_HEIGHT / 2}
        />
        {value === null ? null : (
          <rect
            className={styles.fill}
            x={0}
            y={TRACK_Y}
            width={filled}
            height={TRACK_HEIGHT}
            rx={TRACK_HEIGHT / 2}
          />
        )}
        <rect className={styles.tick} x={tick} y={0} width={1.5} height={HEIGHT} />
      </svg>
      {status ? <p className={styles.status}>{status}</p> : null}
      {note ? <p className={styles.note}>{note}</p> : null}
    </div>
  );
}
