import Link from "next/link";
import { AUDIT_KINDS, type AuditKind } from "@guardian/audit";
import { Button, EmptyState, PageHeader, Select } from "@/components";
import { AuditEntries, ChainTools, KIND_OPTIONS, KIND_WORDS, MAX_RANGE, dayLabelUtc } from "@/components/audit";
import { requireSession, roleAllows } from "@/lib/auth";
import { compose } from "@/lib/compose";
import { getAuditHead, listAuditEntries } from "@/lib/data/audit";
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

function pageHref(page: number, kind?: string): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
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

  // The data layer reads newest first from a starting sequence, so a later page
  // is reached by over-reading and slicing. See the handover note: a toSeq or a
  // cursor on listAuditEntries would make this one read per page.
  const fetched = await listAuditEntries(session, {
    limit: PAGE_SIZE * (page + 1) + 1,
    ...(kind ? { kind } : {}),
  });
  const entries = fetched.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasNext = fetched.length > (page + 1) * PAGE_SIZE;

  const newestOnPage = entries[0]?.seq ?? head?.seq ?? 1;
  const oldestOnPage = entries[entries.length - 1]?.seq ?? 1;
  const defaultFrom = Math.max(1, Math.max(oldestOnPage, newestOnPage - MAX_RANGE + 1));

  // Not printed. The list carries day headings a sighted reader groups by, and
  // this names the same thing for a screen reader, which cannot see them.
  const caption = compose(
    "audit.caption",
    kind
      ? `${KIND_WORDS[kind as AuditKind]}, newest first.`
      : "Everything recorded, newest first.",
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <PageHeader
          title="Evidence Log"
          meta={<span>{customerName}</span>}
          about={
            <>
              <p>
                Every score Guardian gave, every decision a reviewer made and every download is
                written here, locked to the record before it. Change one and the rest stop
                matching, which is what makes this hold up when somebody asks whether the
                evidence was tampered with.
              </p>
              <p>
                It holds decisions and identifiers, never what anyone said. Records belonging to
                other organizations are invisible to you, so the numbering has gaps.
              </p>
            </>
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

      <form className={styles.filters} action="/audit" method="get">
        <Select
          id="audit-kind"
          name="kind"
          label="Show Only"
          defaultValue={kind ?? ""}
          options={[
            { value: "", label: "Everything" },
            ...KIND_OPTIONS,
          ]}
        />
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {kind ? (
          <Link className={styles.clear} href="/audit">
            Clear the filter
          </Link>
        ) : null}
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title={
            kind
              ? "No entries of that kind on this page."
              : page > 0
                ? "This page is past the end of the chain."
                : "Nothing has been recorded yet."
          }
          detail={
            kind
              ? "The chain is readable and the filter matched none of it. Clearing the filter shows every kind."
              : page > 0
                ? "The chain is readable. There are fewer entries than this page needs."
                : "The chain is live. It appends its first entry when a score, a reviewer decision or an export happens."
          }
          meta={undefined}
          action={
            kind || page > 0 ? (
              <Link href={kind ? "/audit" : pageHref(0)}>
                {kind ? "Clear the filter" : "Back to the newest entries"}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <AuditEntries entries={entries} caption={caption} />
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
            <Link className={styles.pageLink} href={pageHref(page - 1, kind)}>
              Newer entries
            </Link>
          ) : (
            <span className={styles.pageEnd}>You are on the newest entries.</span>
          )}
          {hasNext ? (
            <Link className={styles.pageLink} href={pageHref(page + 1, kind)}>
              Older entries
            </Link>
          ) : (
            <span className={styles.pageEnd}>This is the oldest page.</span>
          )}
        </span>
      </nav>
    </div>
  );
}
