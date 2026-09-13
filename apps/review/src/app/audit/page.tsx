import Link from "next/link";
import { AUDIT_KINDS, type AuditKind } from "@guardian/audit";
import { Button, EmptyState, PageHeader, Select } from "@/components";
import { AuditEntries, ChainTools, KIND_OPTIONS, KIND_WORDS, MAX_RANGE, dayLabelUtc } from "@/components/audit";
import { requireSession, roleAllows } from "@/lib/auth";
import { compose } from "@/lib/compose";
import { getAuditHead, listAuditEntries } from "@/lib/data/audit";
import { listConversations } from "@/lib/data/conversations";
import { getCustomerSettings } from "@/lib/data/settings";
import { exportRangeAction, verifyRangeAction } from "./actions";
import styles from "./page.module.css";

/** The chain is live and append only. A cached page of it would be a lie. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Evidence Log",
};

const PAGE_SIZE = 25;

/** Paging deeper than this would pull more rows than the read is worth. */
const MAX_PAGE = 200;

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** What stretch of time this page covers, for the reader who has to place it. */
function spanWords(entries: { ts: Date }[]): string {
  const newest = entries[0]!.ts;
  const oldest = entries[entries.length - 1]!.ts;
  const from = dayLabelUtc(oldest);
  const to = dayLabelUtc(newest);
  return from === to ? `${entries.length} entries on ${to}` : `${entries.length} entries, ${from} to ${to}`;
}

function pageHref(page: number, kind?: string, conversation?: string): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (conversation) params.set("conversation", conversation);
  if (page > 0) params.set("page", String(page));
  const query = params.toString();
  return query ? `/audit?${query}` : "/audit";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const rawKind = one(params.kind);
  const kind = (AUDIT_KINDS as readonly string[]).includes(rawKind ?? "") ? rawKind : undefined;
  const requestedPage = Number.parseInt(one(params.page) ?? "0", 10);
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 0), MAX_PAGE)
    : 0;

  // The head is the only read here that needs the chain secret, so it fails on
  // its own rather than taking the list of entries down with it.
  let head: { seq: number; hash: string } | null = null;
  try {
    head = await getAuditHead();
  } catch {
    head = null;
  }

  const customer = await getCustomerSettings(session);
  const customerName = customer?.name ?? session.customerId;

  /*
   * One conversation's history, when one is picked. Only a conversation on this
   * customer's own list resolves, so a pair id from anywhere else shows the
   * whole log rather than an empty one that says something about it.
   */
  const conversations = await listConversations(session);
  const within = conversations.find((c) => c.ref.pairId === one(params.conversation)) ?? null;

  // The data layer reads newest first from a starting sequence, so a later page
  // is reached by over-reading and slicing. See the handover note: a toSeq or a
  // cursor on listAuditEntries would make this one read per page.
  const fetched = await listAuditEntries(session, {
    limit: PAGE_SIZE * (page + 1) + 1,
    ...(kind ? { kind } : {}),
    ...(within ? { conversation: within.ref } : {}),
  });
  const newestFirst = fetched.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // One conversation reads as a story, first thing first. The whole log stays
  // newest first, because there somebody is looking for what just happened.
  const entries = within ? [...newestFirst].reverse() : newestFirst;
  const hasNext = fetched.length > (page + 1) * PAGE_SIZE;

  const newestOnPage = newestFirst[0]?.seq ?? head?.seq ?? 1;
  const oldestOnPage = newestFirst[newestFirst.length - 1]?.seq ?? 1;
  const defaultFrom = Math.max(1, Math.max(oldestOnPage, newestOnPage - MAX_RANGE + 1));

  // Not printed. The list carries day headings a sighted reader groups by, and
  // this names the same thing for a screen reader, which cannot see them.
  const caption = compose(
    "audit.caption",
    within
      ? `The history of ${within.label}, oldest first.`
      : kind
        ? `${KIND_WORDS[kind as AuditKind]}, newest first.`
        : "Everything recorded, newest first.",
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <PageHeader
          title={within ? `History of ${within.label}` : "Evidence Log"}
          meta={
            within ? (
              <>
                <Link href={`/cases/${encodeURIComponent(within.ref.pairId)}`}>Open the Conversation</Link>
                <Link href="/audit">Show Everything</Link>
              </>
            ) : (
              <span>{customerName}</span>
            )
          }
          about={
            within ? (
              <p>Everything Guardian and your team did about this conversation, in order</p>
            ) : (
              <p>
                Every score, reviewer decision and download, each locked to the one before it so
                nobody can change the record without it showing
              </p>
            )
          }
        />
      </header>

      {/*
        The count is gone. It read "#40" in display type over the words "Records
        Written", which is a sequence number wearing a statistic's clothes: #40
        is the name of the newest entry, not how many there are, and the two
        differ the moment another organization writes to the same chain. The
        page below already says how far it reaches.
      */}
      <ChainTools
        headSeq={head?.seq ?? null}
        headUnavailableReason="The chain head could not be read, so there is nothing to verify a range against yet."
        defaultFrom={defaultFrom}
        defaultTo={newestOnPage}
        canExport={roleAllows(session.role, "operator")}
        exportBlockedReason="An operator seat exports the chain for counsel. Yours can read it."
        canVerify={roleAllows(session.role, "operator")}
        verifyBlockedReason="An operator seat verifies a range of the chain. Yours can read it."
        onVerify={verifyRangeAction}
        onExport={exportRangeAction}
      />

      {/*
        Pick a conversation to see its whole history, or narrow the log to one
        kind of event. Both at once is a conversation's decisions, say, or its
        downloads.
      */}
      <form className={styles.filters} action="/audit" method="get">
        <Select
          id="audit-conversation"
          name="conversation"
          label="Conversation"
          defaultValue={within?.ref.pairId ?? ""}
          options={[
            { value: "", label: "Every Conversation" },
            ...conversations.map((c) => ({ value: c.ref.pairId, label: c.label })),
          ]}
        />
        <Select
          id="audit-kind"
          name="kind"
          label="Show Only"
          defaultValue={kind ?? ""}
          options={[{ value: "", label: "Everything" }, ...KIND_OPTIONS]}
        />
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {kind || within ? (
          <Link className={styles.clear} href="/audit">
            Clear the Filters
          </Link>
        ) : null}
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title={
            kind || within
              ? "Nothing matches those filters"
              : page > 0
                ? "There's nothing on this page"
                : "Nothing has been recorded yet"
          }
          detail={
            kind || within
              ? "Try another conversation or kind of event"
              : page > 0
                ? "There are fewer records than this page needs"
                : "Records appear here when Guardian scores a conversation or your team acts on one"
          }
          action={
            kind || within || page > 0 ? (
              <Link href={kind || within ? "/audit" : pageHref(0)}>
                {kind || within ? "Clear the Filters" : "Back to the Newest Entries"}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <AuditEntries entries={entries} caption={caption} conversations={conversations} within={within} />
      )}

      {/*
        "Page 1, entries #16 to #40" told a reader two sequence numbers they
        have no way to place. Dates they can place: this says what stretch of
        time they are looking at.
      */}
      <nav className={styles.pager} aria-label="Chain pages">
        <span className={styles.pageCount}>
          {entries.length > 0 ? spanWords(entries) : `Page ${page + 1}`}
        </span>
        <span className={styles.pagerLinks}>
          {page > 0 ? (
            <Link className={styles.pageLink} href={pageHref(page - 1, kind, within?.ref.pairId)}>
              Newer Entries
            </Link>
          ) : (
            <span className={styles.pageEnd}>{within ? "The start of this history" : "You're on the newest entries"}</span>
          )}
          {hasNext ? (
            <Link className={styles.pageLink} href={pageHref(page + 1, kind, within?.ref.pairId)}>
              Older Entries
            </Link>
          ) : (
            <span className={styles.pageEnd}>{within ? "The end of this history" : "This is the oldest page"}</span>
          )}
        </span>
      </nav>
    </div>
  );
}
