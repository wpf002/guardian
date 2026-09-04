"use client";

import { useActionState } from "react";
import { Select } from "@/components/Select";
import { SubmitButton } from "./SubmitButton";
import type { SessionLimitsState, SessionLimitsView } from "@/app/settings/types";
import styles from "./settings.module.css";

/**
 * The wellness limits, in one form that can only move them protectively
 * (DESIGN-UI 11). Every option in every picker is at or below the org default,
 * so the ratchet is a property of the control rather than a rule you find out
 * about after you press save.
 */

const BUDGETS = [120, 90, 60, 45, 30, 15];
const BREAKS = [25, 20, 15, 10, 5];
const CASES = [8, 6, 4, 2, 1];

const INITIAL: SessionLimitsState = { error: null, message: null };

export interface SessionLimitsFormProps {
  limits: SessionLimitsView;
  action: (
    previous: SessionLimitsState,
    formData: FormData,
  ) => Promise<SessionLimitsState>;
}

function optionsAtOrBelow(values: number[], ceiling: number, unit: string) {
  return values
    .filter((value) => value <= ceiling)
    .map((value) => ({
      value: String(value),
      label: value === ceiling ? `${value} ${unit} (org default)` : `${value} ${unit}`,
    }));
}

export function SessionLimitsForm({ limits, action }: SessionLimitsFormProps) {
  const [state, formAction] = useActionState(action, INITIAL);
  const { orgDefaults, mine } = limits;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.formRow}>
        <Select
          id="sessionBudgetMinutes"
          name="sessionBudgetMinutes"
          label="Case time a day"
          defaultValue={String(mine.sessionBudgetMinutes)}
          options={optionsAtOrBelow(BUDGETS, orgDefaults.sessionBudgetMinutes, "min")}
          help="You can lower this, not raise it."
        />
        <Select
          id="microBreakMinutes"
          name="microBreakMinutes"
          label="Micro-break every"
          defaultValue={String(mine.microBreakMinutes)}
          options={optionsAtOrBelow(BREAKS, orgDefaults.microBreakMinutes, "min")}
          help="You can shorten this, not lengthen it."
        />
        <Select
          id="casesPerHour"
          name="casesPerHour"
          label="Cases opened an hour"
          defaultValue={String(mine.casesPerHour)}
          options={optionsAtOrBelow(CASES, orgDefaults.casesPerHour, "cases")}
          help="You can lower this, not raise it."
        />
      </div>

      <div className={styles.check}>
        {orgDefaults.collapseProtectedSpans ? (
          <>
            <input type="hidden" name="collapseProtectedSpans" value="on" />
            <span className={styles.checkLabel}>
              Protected spans stay collapsed. Your org has this on, and it can be turned on and
              never off. A protection you can switch off under load is not a protection.
            </span>
          </>
        ) : (
          <>
            <input
              type="checkbox"
              id="collapseProtectedSpans"
              name="collapseProtectedSpans"
              defaultChecked={mine.collapseProtectedSpans}
            />
            <label className={styles.checkLabel} htmlFor="collapseProtectedSpans">
              Collapse protected spans. Once you turn this on you cannot turn it off again.
            </label>
          </>
        )}
      </div>

      {state.error ? (
        <p className={`${styles.banner} ${styles.bannerBad}`} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className={`${styles.banner} ${styles.bannerOk}`} role="status">
          {state.message}
        </p>
      ) : null}

      <div className={styles.actions}>
        <SubmitButton variant="primary">Save limits</SubmitButton>
      </div>

      <p className={styles.rowNote}>
        There is no reviewer table on this deployment yet, so these limits hold for as long as the
        server is running and then return to the org defaults. Nothing here measures your speed, and
        no pace figure exists in any response.
      </p>
    </form>
  );
}
