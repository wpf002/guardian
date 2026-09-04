import { Card } from "@/components";
import type { OperatorPolicy } from "@/lib/data/types";
import styles from "./Case.module.css";

export interface PolicyPanelProps {
  policy: OperatorPolicy;
}

/**
 * A reviewer applies somebody else's policy. Reading it without leaving the
 * case removes one of the documented context trips.
 */
export function PolicyPanel({ policy }: PolicyPanelProps) {
  const edited =
    policy.editedAt && policy.editedBy
      ? `Edited ${policy.editedAt.toLocaleDateString()} by ${policy.editedBy}`
      : undefined;

  return (
    <Card title={`Policy for ${policy.tier}, set by your operator`} aside={edited} density="padded">
      {policy.criteria ? (
        <p className={styles.why}>{policy.criteria}</p>
      ) : (
        <p className={styles.note}>
          Your operator has not written criteria for this tier. The tier still means what the
          badge says it means.
        </p>
      )}
    </Card>
  );
}
