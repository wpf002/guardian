import type { Metadata } from "next";
import Link from "next/link";
import { RETENTION_MS } from "@guardian/schema";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { KeyboardHelp } from "@/components/KeyboardHelp";
import { PageHeader } from "@/components/PageHeader";
import {
  LexiconEditor,
  ReportingDetailsForm,
  RetentionTable,
  ThemePicker,
  WebhookPanel,
} from "@/components/settings";
import { requireSession, roleAllows } from "@/lib/auth";
import { countryOptions } from "@/lib/countries";
import {
  getCustomerSettings,
  getReportingDetails,
  hasSecondSeat,
  listSeats,
  type ReportingDetails,
} from "@/lib/data/settings";
import {
  addLexiconPhrasesAction,
  removeLexiconPhraseAction,
  saveReportingDetailsAction,
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
  description: "Your account, and how Guardian is set up for your organization.",
};

const ROLE_WORD: Record<string, string> = {
  reviewer: "Reviewer",
  operator: "Operator",
  owner: "Owner",
};

export default async function SettingsPage() {
  const session = await requireSession();
  const isOperator = roleAllows(session.role, "operator");
  const isOwner = session.role === "owner";

  const customer = await getCustomerSettings(session).catch(() => null);
  const seats = listSeats(session);
  const secondSeat = hasSecondSeat(session);

  // Each section is read on its own, so one failing read leaves the rest of the
  // page usable rather than blanking a screen somebody opened to change one thing.
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
  let reporting: ReportingDetails | null = null;
  if (isOwner) {
    reporting = await getReportingDetails(session).catch(() => null);
  }

  return (
    <div className={`container ${styles.page}`}>
      {/*
        No line under the title. It said "Every change here is recorded, with
        who made it and when", and that was not true: the theme is kept in the
        browser, and a webhook change writes no record anywhere.
      */}
      <PageHeader title="Settings" />

      <div className={styles.groups}>
        <Group title="You" note="Your account, and how Guardian looks for you.">
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
                <span className={styles.rowValue}>{customer?.name ?? PAGE_UNNAMED}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>People on your team</span>
                <span className={styles.rowValue}>{seats.length}</span>
                <p className={styles.rowNote}>
                  {secondSeat
                    ? "Two people have to agree before anything is reported."
                    : "Reporting needs two people. Until you add someone, send reports to NCMEC yourself."}
                </p>
              </div>
            </div>
          </Card>

          <Card title="How You Work">
            <ThemePicker />
            <details className={styles.shortcuts}>
              <summary className={styles.shortcutsSummary}>Keyboard Shortcuts</summary>
              <KeyboardHelp />
            </details>
          </Card>
        </Group>

        {isOwner ? (
          <Group title="Reporting" note="Who you are when you send a report.">
            <Card title="Reporting Details">
              {reporting ? (
                <ReportingDetailsForm
                  details={reporting}
                  countries={countryOptions()}
                  timezones={Intl.supportedValuesOf("timeZone")}
                  save={saveReportingDetailsAction}
                />
              ) : (
                <ErrorState
                  title="Your reporting details couldn't be loaded."
                  unaffected="Guardian is still watching. Only this part of the page failed."
                />
              )}
            </Card>
          </Group>
        ) : null}

        {isOperator ? (
          <Group title="What Guardian Reads" note="These apply to every server on your account.">
            <Card title="Custom Phrases">
              {lexiconFailed || !lexicon ? (
                <ErrorState
                  title="Your phrases couldn't be loaded."
                  unaffected="Guardian is still watching with its built-in list. Only this part of the page failed."
                />
              ) : (
                <LexiconEditor
                  view={lexicon}
                  addAction={addLexiconPhrasesAction}
                  removeAction={removeLexiconPhraseAction}
                />
              )}
            </Card>

            <Card title="Send Alerts to Your Own System">
              {webhookFailed || !webhook ? (
                <ErrorState
                  title="This couldn't be loaded."
                  unaffected="Alerts are still being sent. Only this part of the page failed."
                />
              ) : (
                <WebhookPanel
                  view={webhook}
                  saveAction={updateWebhookUrlAction}
                  testAction={sendTestDeliveryAction}
                />
              )}
            </Card>
          </Group>
        ) : null}

        <Group title="Records" note="What Guardian keeps, and for how long.">
          <Card title="Evidence Log">
            <p className={`${styles.rowNote} ${styles.introNote}`}>
              A permanent record of everything Guardian and your team did. Nobody can change it
              afterwards.
            </p>
            <Link className={styles.settingsLink} href="/audit">
              Open the Evidence Log
            </Link>
          </Card>

          {/*
            Four short lines, open. The Wording Guard card that sat under this,
            a count of strings withheld since the server started, was a
            diagnostic for whoever runs the deployment. It still logs.
          */}
          <Card title="How Long Data Is Kept">
            <RetentionTable rows={retentionRows(RETENTION_MS)} />
          </Card>
        </Group>
      </div>
    </div>
  );
}

const PAGE_UNNAMED = "Your organization";

/**
 * A labelled run of cards.
 *
 * The heading is the point. Seven cards in one column with no breaks reads as
 * one long list of unrelated things, and the reader has to open each title to
 * work out whether it is theirs to change. A heading per group says it once.
 */
function Group({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.group} aria-label={title}>
      <div className={styles.groupHead}>
        <h2 className={styles.groupTitle}>{title}</h2>
        <p className={styles.groupNote}>{note}</p>
      </div>
      <div className={styles.sections}>{children}</div>
    </section>
  );
}
