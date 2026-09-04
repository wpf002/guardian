"use client";

import { useActionState } from "react";
import { Field } from "@/components/Field";
import type { TestDeliveryState, WebhookState, WebhookView } from "@/app/settings/types";
import { SubmitButton } from "./SubmitButton";
import styles from "./settings.module.css";

/**
 * Where tier events go, and a way to prove the loop closes before real traffic
 * arrives (RESEARCH 6.10 step 6).
 *
 * The sample payload is signed exactly the way the scorer signs a real one, so
 * a customer testing their verifier is testing the real thing, and every
 * identifier inside it says example so a delivery in a log cannot be mistaken
 * for a pair.
 */

const URL_INITIAL: WebhookState = { error: null, message: null };
const TEST_INITIAL: TestDeliveryState = {
  error: null,
  message: null,
  sample: null,
  attempted: false,
};

export interface WebhookPanelProps {
  view: WebhookView;
  saveAction: (previous: WebhookState, formData: FormData) => Promise<WebhookState>;
  testAction: (
    previous: TestDeliveryState,
    formData: FormData,
  ) => Promise<TestDeliveryState>;
}

export function WebhookPanel({ view, saveAction, testAction }: WebhookPanelProps) {
  const [urlState, urlFormAction] = useActionState(saveAction, URL_INITIAL);
  const [testState, testFormAction] = useActionState(testAction, TEST_INITIAL);

  return (
    <div className={styles.form}>
      <form action={urlFormAction} className={styles.form}>
        <Field
          id="url"
          name="url"
          type="url"
          label="Webhook endpoint"
          defaultValue={view.url ?? ""}
          placeholder="https://example.com/guardian/tiers"
          optional
          help="https only, and no query string. Leave it empty to stop delivery."
          error={urlState.error ?? undefined}
        />
        {urlState.message ? (
          <p className={`${styles.banner} ${styles.bannerOk}`} role="status">
            {urlState.message}
          </p>
        ) : null}
        <div className={styles.actions}>
          <SubmitButton variant="primary">Save endpoint</SubmitButton>
        </div>
      </form>

      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Signing</span>
          <span className={styles.rowValue}>
            {view.secretConfigured
              ? "A shared secret is set for this customer."
              : "No shared secret is set, so nothing can be signed."}
          </span>
          <p className={styles.rowNote}>
            Every request carries x-guardian-timestamp and x-guardian-signature, an HMAC-SHA256 over
            the timestamp and the body. The secret never leaves the server and is never shown here.
          </p>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>What is sent</span>
          <span className={styles.rowValue}>
            A tier, the pair identifiers, the rationale lines and the three versions.
          </span>
          <p className={styles.rowNote}>
            No message text, no media, and no key that makes a claim about a person. T3 never
            arrives this way, because only a reviewer produces T3.
          </p>
        </div>
      </div>

      <form action={testFormAction} className={styles.form}>
        <div className={styles.actions}>
          <SubmitButton
            disabledReason={view.url ? undefined : "Set an endpoint first."}
          >
            Send a test delivery
          </SubmitButton>
        </div>
        {testState.error ? (
          <p className={`${styles.banner} ${styles.bannerBad}`} role="alert">
            {testState.error}
          </p>
        ) : null}
        {testState.message ? (
          <p className={`${styles.banner} ${styles.bannerOk}`} role="status">
            {testState.message}
          </p>
        ) : null}
        {testState.sample ? (
          <>
            <p className={styles.rowNote}>
              The body that was signed. Everything in it is an example and nothing in it came from
              your traffic.
            </p>
            <pre className={styles.sample}>{testState.sample}</pre>
          </>
        ) : null}
      </form>
    </div>
  );
}
