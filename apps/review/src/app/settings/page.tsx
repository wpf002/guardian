import type { Metadata } from "next";
import Link from "next/link";
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
        about={<p>Every change here is recorded, with who made it and when.</p>}
      />

      {/*
        Three groups, in the order somebody arrives needing them.

        This was seven cards in one flat stack, and they were four different
        subjects: who you are, how this screen behaves, what Guardian reads in
        your servers, and what it keeps and can prove. Nothing said where one
        subject ended and the next began, so a moderator changing the theme
        scrolled past the webhook signing scheme and the retention schedule to
        reach it, and an operator setting up a webhook scrolled past the theme.
      */}
      <div className={styles.groups}>
        <Group title="You" note="This seat, and how the console behaves for you.">
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
            {/*
              The shortcut sheet is forty lines. Printed inline it was most of
              why this page scrolled: somebody changing the theme read every
              binding in the app on the way past.
            */}
            <details className={styles.shortcuts}>
              <summary className={styles.shortcutsSummary}>Keyboard Shortcuts</summary>
              <KeyboardHelp />
            </details>
          </Card>
        </Group>

        {isOperator ? (
          <Group
            title="What Guardian Reads"
            note="Applies to every server on this account. Changing either of these changes what the kernel sees."
          >
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

            <Card title="Send Alerts to Your Own System">
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
          </Group>
        ) : null}

        {/*
          What Guardian keeps and what it can prove. Both are read only, both
          are things somebody checks rather than sets, and neither belongs in
          the path of a person changing a setting.
        */}
        <Group title="Records" note="Read only. What Guardian keeps, for how long, and how it proves none of it changed.">
          <Card title="Evidence Log">
            <p className={`${styles.rowNote} ${styles.introNote}`}>
              Every score, every reviewer decision and every download, each locked to the record
              before it. Change one and the rest stop matching, which is what makes it hold up when
              somebody asks whether the evidence was tampered with.
            </p>
            <Link className={styles.settingsLink} href="/audit">
              Open the Evidence Log
            </Link>
          </Card>

          <Card title="How Long Data Is Kept">
            <p className={`${styles.rowNote} ${styles.introNote}`}>
              Deletion is a scheduled job on the class a row was written with. Text on a
              conversation that scored nothing is gone within 24 hours; a conversation two
              reviewers reported is held for a year.
            </p>
            {/*
              The full table is four rows of class names, durations and a
              sentence each. It is a reference somebody checks once, and it sat
              open on a page people come to for one control.
            */}
            <details className={styles.shortcuts}>
              <summary className={styles.shortcutsSummary}>All Four Retention Classes</summary>
              <RetentionTable rows={retentionRows(RETENTION_MS)} />
            </details>
          </Card>

          {session.role === "owner" ? (
            <Card title="Wording Guard">
              <div className={styles.rows}>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Strings withheld</span>
                  <span className={styles.rowValue}>{withheld}</span>
                  <p className={styles.rowNote}>
                    {withheld === 0
                      ? "No string built from data has been replaced by the guard since this server started."
                      : "A string built from data was replaced with the withheld sentence rather than rendered. That is a defect somebody can act on, and the case it came from is in the server log."}
                  </p>
                </div>
              </div>
            </Card>
          ) : null}
        </Group>
      </div>
    </div>
  );
}

/**
 * A labelled run of cards.
 *
 * The heading is the point. Seven cards in one column with no breaks reads as
 * one long list of unrelated things, and the reader has to open each title to
 * work out whether it is theirs to change. Three headings say it once.
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
