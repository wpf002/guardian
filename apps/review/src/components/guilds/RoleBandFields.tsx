"use client";

import { useId, useState } from "react";
import { AGE_BANDS } from "@guardian/schema/agebands";
import { Button, Field, Select, type SelectOption } from "@/components";
import type { AgeBand } from "@/lib/data/types";
import { BANDS, BAND_LABEL, BAND_MEANING, SNOWFLAKE, SNOWFLAKE_ERROR, SNOWFLAKE_HELP } from "./copy";
import styles from "./Guilds.module.css";

const BAND_OPTIONS: SelectOption[] = AGE_BANDS.map((band) => ({
  value: band,
  label: BAND_LABEL[band],
}));

function isBand(value: string): value is AgeBand {
  return (AGE_BANDS as readonly string[]).includes(value);
}

export interface RoleBandFieldsProps {
  value: Record<string, AgeBand>;
  onChange: (next: Record<string, AgeBand>) => void;
  disabled?: boolean;
}

/**
 * Server roles on the left, the six Roblox-scheme bands plus unknown on the
 * right (RESEARCH 6.10 step 2). Each row prints what the band actually does,
 * because "9 to 12" on its own does not tell an owner that unknown lowers the
 * weighting rather than assuming an adult.
 */
export function RoleBandFields({ value, onChange, disabled = false }: RoleBandFieldsProps) {
  const roleInputId = useId();
  const bandSelectId = useId();
  const [draftRole, setDraftRole] = useState("");
  const [draftBand, setDraftBand] = useState<AgeBand>("A13_15");
  const [error, setError] = useState<string | null>(null);

  const entries = Object.entries(value) as [string, AgeBand][];

  function add() {
    const trimmed = draftRole.trim();
    if (!SNOWFLAKE.test(trimmed)) {
      setError(SNOWFLAKE_ERROR);
      return;
    }
    if (trimmed in value) {
      setError(BANDS.duplicateError);
      return;
    }
    setError(null);
    setDraftRole("");
    onChange({ ...value, [trimmed]: draftBand });
  }

  function remove(roleId: string) {
    const next = { ...value };
    delete next[roleId];
    onChange(next);
  }

  return (
    <div>
      <h3 className={styles.subHeading}>{BANDS.mappedHeading}</h3>
      {entries.length === 0 ? (
        <p className={styles.empty}>{BANDS.noneMapped}</p>
      ) : (
        <ul className={styles.idList}>
          {entries.map(([roleId, band]) => (
            <li key={roleId} className={styles.bandRow}>
              <Select
                id={`role-band-${roleId}`}
                label={`${BANDS.roleLabelPrefix} ${roleId}`}
                options={BAND_OPTIONS}
                value={band}
                disabled={disabled}
                onChange={(event) => {
                  const next = event.target.value;
                  if (isBand(next)) onChange({ ...value, [roleId]: next });
                }}
              />
              <Button
                variant="ghost"
                disabled={disabled}
                aria-label={`${BANDS.removeLabel} ${BANDS.roleLabelPrefix} ${roleId}`}
                onClick={() => remove(roleId)}
              >
                {BANDS.removeLabel}
              </Button>
              <span className={styles.bandMeaning}>{BAND_MEANING[band]}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.subHeadingSpaced}>{BANDS.addHeading}</h3>
      <div className={styles.controls}>
        <Field
          id={roleInputId}
          label={BANDS.addRoleLabel}
          help={SNOWFLAKE_HELP}
          error={error ?? undefined}
          inputMode="numeric"
          autoComplete="off"
          value={draftRole}
          disabled={disabled}
          onChange={(event) => {
            setDraftRole(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Select
          id={bandSelectId}
          label={BANDS.addBandLabel}
          options={BAND_OPTIONS}
          value={draftBand}
          disabled={disabled}
          help={BAND_MEANING[draftBand]}
          onChange={(event) => {
            const next = event.target.value;
            if (isBand(next)) setDraftBand(next);
          }}
        />
        <Button variant="secondary" onClick={add} disabled={disabled}>
          {BANDS.addLabel}
        </Button>
      </div>
    </div>
  );
}
