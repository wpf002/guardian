"use client";

import { KEY_GROUPS, type KeyGroup } from "@/lib/keys";
import { Dialog } from "./Dialog";
import styles from "./KeyboardHelp.module.css";

export interface KeyboardHelpProps {
  /** Defaults to the registry, so the sheet cannot drift from the behaviour. */
  groups?: KeyGroup[];
  /** When present the sheet renders in a dialog rather than inline. */
  open?: boolean;
  onClose?: () => void;
}

export function KeyboardHelp({ groups = KEY_GROUPS, open, onClose }: KeyboardHelpProps) {
  const body = (
    <div className={styles.groups}>
      {groups.map((group) => (
        <section key={group.name} className={styles.group}>
          <h3 className={styles.name}>{group.name}</h3>
          <dl className={styles.list}>
            {group.bindings.map((binding) => (
              <div key={`${group.name}-${binding.keys}`} style={{ display: "contents" }}>
                <dt className={styles.keys}>{binding.keys}</dt>
                <dd className={styles.action}>
                  {binding.action}
                  {binding.alias ? (
                    <span className={styles.alias}>{binding.alias} always works</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );

  if (open === undefined || !onClose) return body;

  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={onClose}>
      {body}
    </Dialog>
  );
}
