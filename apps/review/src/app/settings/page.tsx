import type { Metadata } from "next";
import Link from "next/link";
import { RETENTION_MS } from "@guardian/schema";
import { SettingsBlock, SettingsGroup, SettingsRow } from "@/components/SettingsPanel";
import { ErrorState } from "@/components/ErrorState";
import { KeyboardHelp } from "@/components/KeyboardHelp";
import { PageHeader } from "@/components/PageHeader";
import {
  LexiconEditor,
  ReportingDetailsForm,
  RetentionTable,
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
      <PageHeader title="Settings" />

      {/*
        Groups of rows, the same layout as a server's setup page. This was a
        stack of cards, each with a title, an accent underline, a rule and an
        intro sentence before its control.
      */}
      <div className={styles.groups}>
        <SettingsGroup title="Your Account">
          <SettingsRow label="Name">{session.displayName}</SettingsRow>
          <SettingsRow label="Role">{ROLE_WORD[session.role] ?? session.role}</SettingsRow>
          <SettingsRow label="Organization">{customer?.name ?? PAGE_UNNAMED}</SettingsRow>
          <SettingsRow
            label="People on Your Team"
            help={
              secondSeat
                ? "Two people have to agree before anything is reported"
                : "Reporting needs two people, so send reports to NCMEC yourself until you add someone"
            }
          >
            {seats.length}
          </SettingsRow>
        </SettingsGroup>

        {isOwner ? (
          <SettingsGroup title="Reporting" note="Used on every report you send">
            <SettingsBlock>
              {reporting ? (
                <ReportingDetailsForm
                  details={reporting}
                  countries={countryOptions()}
                  timezones={Intl.supportedValuesOf("timeZone")}
                  save={saveReportingDetailsAction}
                />
              ) : (
                <ErrorState
                  title="Your reporting details couldn't be loaded"
                  unaffected="Guardian is still watching. Only this part of the page failed"
                />
              )}
            </SettingsBlock>
          </SettingsGroup>
        ) : null}

        {isOperator ? (
          <SettingsGroup title="What Guardian Reads" note="Applies to every server on your account">
            <SettingsRow label="Custom Phrases" help="Words Guardian might miss">
              {lexiconFailed || !lexicon ? (
                <ErrorState
                  title="Your phrases couldn't be loaded"
                  unaffected="Guardian is still watching with its built-in list"
                />
              ) : (
                <LexiconEditor
                  view={lexicon}
                  addAction={addLexiconPhrasesAction}
                  removeAction={removeLexiconPhraseAction}
                />
              )}
            </SettingsRow>

            <SettingsRow label="Alerts to Your System" help="Optional. Never includes messages">
              {webhookFailed || !webhook ? (
                <ErrorState
                  title="This couldn't be loaded"
                  unaffected="Alerts are still being sent"
                />
              ) : (
                <WebhookPanel
                  view={webhook}
                  saveAction={updateWebhookUrlAction}
                  testAction={sendTestDeliveryAction}
                />
              )}
            </SettingsRow>
          </SettingsGroup>
        ) : null}

        <SettingsGroup title="Records">
          <SettingsRow label="Evidence Log" help="A permanent record nobody can change">
            <Link className={styles.settingsLink} href="/audit">
              Open the Evidence Log
            </Link>
          </SettingsRow>
          <SettingsRow label="How Long Data Is Kept">
            <RetentionTable rows={retentionRows(RETENTION_MS)} />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Keyboard Shortcuts">
          <SettingsBlock>
            <KeyboardHelp />
          </SettingsBlock>
        </SettingsGroup>
      </div>
    </div>
  );
}

const PAGE_UNNAMED = "Your organization";
