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
          placeholder="https://example.com/guardian-alerts"
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

      {/*
        How a request is signed and what is in it.
        
        Two rows, each with a paragraph, sitting open between the endpoint field
        and the test button. Both are reference: somebody implementing the
        receiving end reads them once and never again, and everybody else
        scrolled past four lines of HMAC to reach a button. The one fact worth
        keeping in the open is whether a secret is set at all, because that is a
        state of this deployment rather than documentation.
      */}
      <p className={styles.blockNote}>
        {view.secretConfigured
          ? "Requests are signed. Messages and images are never sent."
          : "There's no shared secret yet, so requests can't be signed. Messages and images are never sent."}
      </p>

      <details className={styles.shortcuts}>
        <summary className={styles.shortcutsSummary}>For Your Developer</summary>
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Checking a request</span>
            <span className={styles.rowValue}>
              Each request has x-guardian-timestamp and x-guardian-signature headers.
            </span>
            <p className={styles.rowNote}>
              verifySignature in @guardian/sdk-ts checks them against your shared secret. The secret
              is never shown here.
            </p>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>What is sent</span>
            <span className={styles.rowValue}>Which conversation, how serious it is, and why.</span>
            <p className={styles.rowNote}>
              Never the messages, never an image, and never a report. Reports only go out after two
              people on your team agree.
            </p>
          </div>
        </div>
      </details>

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
