import type { Versions } from "@/lib/data/types";
import styles from "./Case.module.css";

export interface ProvenanceLineProps {
  versions: Versions;
  scoredAt: Date;
  auditSeq: number | null;
}

/**
 * The version triple, the score timestamp and the chain reference. Small,
 * because a reviewer rarely needs it. Present, because an auditor and a defence
 * motion both will.
 */
export function ProvenanceLine({ versions, scoredAt, auditSeq }: ProvenanceLineProps) {
  return (
    <p className={styles.provenance}>
      <span>model {versions.modelVersion}</span>
      <span>lexicon {versions.lexiconVersion}</span>
      <span>fusion {versions.fusionVersion}</span>
      <span>scored {scoredAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
      {auditSeq === null ? (
        <span>chain entry not recorded on this row</span>
      ) : (
        <a href={`/audit/${auditSeq}`}>audit #{auditSeq}</a>
      )}
    </p>
  );
}
