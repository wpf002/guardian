import type { Metadata } from "next";
import { RETENTION_MS } from "@guardian/schema";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { KeyboardHelp } from "@/components/KeyboardHelp";
import { PageHeader } from "@/components/PageHeader";
import {
  LexiconEditor,
  RetentionTable,
  ThemePicker,
  WebhookPanel,
} from "@/components/settings";
import { requireSession, roleAllows } from "@/lib/auth";
import { withheldStringCount } from "@/lib/compose";
import { getCustomerSettings, hasSecondSeat, listSeats } from "@/lib/data/settings";
import {
  addLexiconPhrasesAction,
  removeLexiconPhraseAction,
  sendTestDeliveryAction,
  updateWebhookUrlAction,
} from "./actions";
import {
  getLexiconView,
  getWebhookView,
  retentionRows,
} from "./data";
import type { LexiconView, WebhookView } from "./types";
import styles from "@/components/settings/settings.module.css";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your account and your organization's configuration.",
};

const ROLE_WORD: Record<string, string> = {
  reviewer: "Reviewer",
  operator: "Operator",
  owner: "Owner",
};

export default async function SettingsPage() {
  const session = await requireSession();
  const isOperator = roleAllows(session.role, "operator");

  const customer = await getCustomerSettings(session).catch(() => null);
  const seats = listSeats(session);
  const secondSeat = hasSecondSeat(session);

  // Each operator section is read on its own, so one failing read leaves the
  // rest of the page usable rather than blanking a screen somebody opened to
  // change one thing.
  let lexicon: LexiconView | null = null;
  let lexiconFailed = false;
  let webhook: WebhookView | null = null;
  let webhookFailed = false;
  if (isOperator) {
    try {
      lexicon = await getLexiconView(session);
    } catch {
      lexiconFailed = true;
    }
    try {
      webhook = await getWebhookView(session);
    } catch {
      webhookFailed = true;
    }
  }

  const withheld = withheldStringCount();

  return (
    <div className={`container ${styles.page}`}>
      <PageHeader
        title="Settings"
        meta="Your account, then everything your organization has set up"
        about={<p>Every change here is recorded, with who made it and when.</p>}
      />

      <div className={styles.sections}>
        {/*
          One card for the person, one for how they work, then the operator's
          configuration. It was seven cards deep with a paragraph of
          explanation under nearly every row, which is a page you scroll rather
          than a page you use: somebody who came to change the theme read four
          notes about tier semantics on the way.
        */}
        <Card title="Your Account">
          <div className={styles.rows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Name</span>
              <span className={styles.rowValue}>{session.displayName}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Role</span>
              <span className={styles.rowValue}>{ROLE_WORD[session.role] ?? session.role}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Organization</span>
              <span className={styles.rowValue}>{customer?.name ?? session.customerId}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Reviewers</span>
              <span className={styles.rowValue}>{seats.length}</span>
              <p className={styles.rowNote}>
                {secondSeat
                  ? "Enough to confirm a report. Two people have to agree before Guardian files anything."
                  : "Not enough to file. Two people have to agree before a report exists, so cases here end with a draft you send to NCMEC yourself."}
              </p>
            </div>
          </div>
        </Card>

        <Card title="How You Work">
          <ThemePicker />
          <KeyboardHelp />
        </Card>

        {isOperator ? (
          <Card title="Custom Phrases" aside={lexicon ? lexicon.mergedVersion : undefined}>
            {lexiconFailed || !lexicon ? (
              <ErrorState
                title="The lexicon could not be read."
                unaffected="Scoring is unaffected. The kernel loads the lexicon from its own copy, so this is a read failure on this page."
              />
            ) : (
              <LexiconEditor
                view={lexicon}
                addAction={addLexiconPhrasesAction}
                removeAction={removeLexiconPhraseAction}
              />
            )}
          </Card>
        ) : null}

        {isOperator ? (
          <Card title="Webhook">
            {webhookFailed || !webhook ? (
              <ErrorState
                title="The webhook configuration could not be read."
                unaffected="Delivery is unaffected. The scorer reads the endpoint from the customer row, not from this page."
              />
            ) : (
              <WebhookPanel
                view={webhook}
                saveAction={updateWebhookUrlAction}
                testAction={sendTestDeliveryAction}
              />
            )}
          </Card>
        ) : null}

        <Card title="How Long Data Is Kept">
          <p className={`${styles.rowNote} ${styles.introNote}`}>
            Read only. Deletion is a scheduled job on the class a row was written with, and every
            stored row carries a customer and a class.
          </p>
          <RetentionTable rows={retentionRows(RETENTION_MS)} />
        </Card>

        {session.role === "owner" ? (
          <Card title="Wording Guard">
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Strings withheld</span>
                <span className={styles.rowValue}>{withheld}</span>
                <p className={styles.rowNote}>
                  {withheld === 0
                    ? "Since this server started, no string built from data has been replaced by the guard."
                    : "A string built from data was replaced with the withheld sentence rather than rendered. That is a defect somebody can act on, and the case it came from is in the server log."}
                </p>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
