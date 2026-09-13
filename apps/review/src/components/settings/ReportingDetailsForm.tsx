"use client";

import { useActionState } from "react";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import type { ReportingDetails } from "@/lib/data/settings";
import type { ReportingState } from "@/app/settings/types";
import { SubmitButton } from "./SubmitButton";
import styles from "./settings.module.css";

const INITIAL: ReportingState = { error: null, message: null };

export interface ReportingDetailsFormProps {
  details: ReportingDetails;
  /** Built on the server, so the names cannot differ between server and browser. */
  countries: { value: string; label: string }[];
  timezones: string[];
  save: (previous: ReportingState, formData: FormData) => Promise<ReportingState>;
}

/**
 * Who you are when you send a report.
 *
 * Every report lists these. Without them the report card marks them missing,
 * and it used to send you to "settings" to add them when settings had no place
 * to do it.
 */
export function ReportingDetailsForm({ details, countries, timezones, save }: ReportingDetailsFormProps) {
  const [state, action] = useActionState(save, INITIAL);

  return (
    <form action={action} className={styles.form}>
      <Field
        id="organizationName"
        name="organizationName"
        label="Your organization's name"
        help="Reports go out under this name."
        defaultValue={details.organizationName ?? ""}
        optional
      />
      <div className={styles.pairFields}>
        <Field
          id="contactName"
          name="contactName"
          label="Who NCMEC should contact"
          defaultValue={details.contactName ?? ""}
          optional
        />
        <Field
          id="contactEmail"
          name="contactEmail"
          label="Their email"
          type="email"
          defaultValue={details.contactEmail ?? ""}
          optional
        />
      </div>
      <div className={styles.pairFields}>
        <Select
          id="country"
          name="country"
          label="Country"
          defaultValue={details.country ?? ""}
          options={[{ value: "", label: "Pick a country" }, ...countries]}
        />
        <Field
          id="region"
          name="region"
          label="State or province"
          help="For the US, the two-letter state, like TX."
          defaultValue={details.region ?? ""}
          optional
        />
      </div>
      <Select
        id="timezone"
        name="timezone"
        label="Time zone"
        defaultValue={details.timezone ?? ""}
        options={[
          { value: "", label: "Pick a time zone" },
          ...timezones.map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") })),
        ]}
      />

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
        <SubmitButton variant="primary">Save</SubmitButton>
      </div>
    </form>
  );
}
