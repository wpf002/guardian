"use client";

import { useActionState } from "react";
import formStyles from "@/components/Form.module.css";
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

  /*
   * One row: the address, Save, and a test once there is something to test.
   *
   * It was a labelled field marked optional, a help line about https and query
   * strings, a Save button on its own line, a note about signing, a
   * disclosure, and a test button with "Set an endpoint first." printed under
   * it. The rules about the address are what the save refuses, and it says so
   * when it does. The test button is not shown until an address is saved,
   * rather than shown disabled with a sentence explaining why.
   */
  return (
    <div className={styles.webhook}>
      <div className={styles.hookRow}>
        <form action={urlFormAction} className={styles.hookForm}>
          <input
            name="url"
            type="url"
            aria-label="Web address"
            defaultValue={view.url ?? ""}
            placeholder="https://example.com/guardian-alerts"
            className={`${formStyles.control} ${styles.hookUrl}`}
            aria-invalid={urlState.error ? true : undefined}
          />
          <SubmitButton variant="primary">Save</SubmitButton>
        </form>
        {view.url ? (
          <form action={testFormAction}>
            <SubmitButton>Send Test</SubmitButton>
          </form>
        ) : null}
      </div>

      {urlState.error ? (
        <p className={`${styles.banner} ${styles.bannerBad}`} role="alert">
          {urlState.error}
        </p>
      ) : null}
      {urlState.message ? (
        <p className={`${styles.banner} ${styles.bannerOk}`} role="status">
          {urlState.message}
        </p>
      ) : null}
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
      {!view.secretConfigured ? (
        <p className={styles.quiet}>No signing secret is set yet, so requests can&apos;t be signed</p>
      ) : null}

      <details className={styles.developer}>
        <summary className={styles.shortcutsSummary}>For Your Developer</summary>
        <p className={styles.devNote}>
          Verify each request with <code>verifySignature</code> from <code>@guardian/sdk-ts</code>, using
          the <code>x-guardian-timestamp</code> and <code>x-guardian-signature</code> headers
        </p>
        {testState.sample ? <pre className={styles.sample}>{testState.sample}</pre> : null}
      </details>
    </div>
  );
}
