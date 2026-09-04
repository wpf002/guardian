import type { Metadata } from "next";
import { RETENTION_MS } from "@guardian/schema";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { KeyboardHelp } from "@/components/KeyboardHelp";
import {
  LexiconEditor,
  RetentionTable,
  SessionLimitsForm,
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
  updateSessionLimitsAction,
  updateWebhookUrlAction,
} from "./actions";
import {
  getLexiconView,
  getSessionLimits,
  getWebhookView,
  ORG_DEFAULT_LIMITS,
  retentionRows,
} from "./data";
import type { LexiconView, WebhookView } from "./types";
import styles from "@/components/settings/settings.module.css";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your seat, your session limits, and the customer configuration behind them.",
};

/** Rotation off the T2 queue, DESIGN-UI 11. The interval is the org's to set. */
const ROTATION_WEEKS = 12;

const ROLE_WORD: Record<string, string> = {
  reviewer: "Reviewer",
  operator: "Operator",
  owner: "Owner",
};

export default async function SettingsPage() {
  const session = await requireSession();
  const isOperator = roleAllows(session.role, "operator");

  const customer = await getCustomerSettings(session).catch(() => null);
  const limits = getSessionLimits(session);
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
      <h1>Settings</h1>
      <p className={styles.lede}>
        Your seat and the limits you work under, then the configuration behind them. Everything an
        operator changes here is written to the audit chain.
      </p>

      <div className={styles.sections}>
        <Card title="Your seat">
          <div className={styles.rows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Name</span>
              <span className={styles.rowValue}>{session.displayName}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Role</span>
              <span className={styles.rowValue}>{ROLE_WORD[session.role] ?? session.role}</span>
              <p className={styles.rowNote}>
                A reviewer can decide up to a T3 proposal. Only a second reviewer upholding that
                proposal produces T3, and no model can.
              </p>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Customer</span>
              <span className={styles.rowValue}>
                {customer?.name ?? session.customerId}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Seat id</span>
              <span className={`${styles.rowValue} ${styles.version}`}>{session.reviewerId}</span>
              <p className={styles.rowNote}>
                Sign-in is pre-SSO on this deployment. Your decisions reference this id until single
                sign-on and a reviewer table replace it.
              </p>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Seats on this partition</span>
              <span className={styles.rowValue}>{seats.length}</span>
              <p className={styles.rowNote}>
                {secondSeat
                  ? "Two or more seats are active, so a proposal can reach a second reviewer and a T3 can complete."
                  : "A T3 needs two people. With one seat a proposal cannot be upheld, and the path ends in a drafted bundle an operator files."}
              </p>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Rotation</span>
              <span className={styles.rowValue}>Every {ROTATION_WEEKS} weeks</span>
              <p className={styles.rowNote}>
                Rotation off the T2 queue. Your own date is not recorded on this deployment yet, so
                ask your operator when yours falls.
              </p>
            </div>
          </div>
        </Card>

        <Card
          title="Session limits"
          aside={`org default ${ORG_DEFAULT_LIMITS.sessionBudgetMinutes} min a day`}
        >
          <SessionLimitsForm limits={limits} action={updateSessionLimitsAction} />
        </Card>

        <Card title="Theme">
          <ThemePicker />
        </Card>

        <Card title="Keyboard shortcuts">
          <KeyboardHelp />
        </Card>

        {isOperator ? (
          <Card title="Lexicon extension" aside={lexicon ? lexicon.mergedVersion : undefined}>
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

        <Card title="Retention">
          <p className={`${styles.rowNote} ${styles.introNote}`}>
            Read only. Deletion is a scheduled job on the class a row was written with, and every
            stored row carries a customer and a class.
          </p>
          <RetentionTable rows={retentionRows(RETENTION_MS)} />
        </Card>

        {session.role === "owner" ? (
          <Card title="Wording guard">
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
