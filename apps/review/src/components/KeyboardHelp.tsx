"use client";

import { Fragment } from "react";
import { KEY_GROUPS, type KeyBinding, type KeyGroup } from "@/lib/keys";
import { Dialog } from "./Dialog";
import styles from "./KeyboardHelp.module.css";

export interface KeyboardHelpProps {
  /** Defaults to the registry, so the sheet cannot drift from the behaviour. */
  groups?: KeyGroup[];
  /** When present the sheet renders in a dialog rather than inline. */
  open?: boolean;
  onClose?: () => void;
}

/**
 * The shortcuts, as keycaps.
 *
 * It was a definition list with each key sequence printed as monospace text,
 * "Tab, then Enter" and "Up / Down", in a column 220 pixels from its action.
 * Now each group is a short list: what it does on the left, the keys on the
 * right as caps, with "or" and "then" between them in quiet type.
 */
export function KeyboardHelp({ groups = KEY_GROUPS, open, onClose }: KeyboardHelpProps) {
  const body = (
    <div className={styles.groups}>
      {groups.map((group) => (
        <section key={group.name} className={styles.group} aria-label={group.name}>
          <h3 className={styles.name}>{group.name}</h3>
          <ul className={styles.list}>
            {group.bindings.map((binding) => (
              <li key={`${group.name}-${binding.keys.join("+")}`} className={styles.item}>
                <span className={styles.action}>{binding.action}</span>
                <Keys binding={binding} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );

  if (open === undefined || !onClose) return body;

  return (
    <Dialog open={open} title="Keyboard Shortcuts" onClose={onClose}>
      {body}
    </Dialog>
  );
}

function Keys({ binding }: { binding: KeyBinding }) {
  return (
    <span className={styles.keys}>
      {binding.keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          {index > 0 ? <span className={styles.joiner}>{binding.joiner ?? "or"}</span> : null}
          <kbd className={styles.cap}>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
