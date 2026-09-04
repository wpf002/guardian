import Link from "next/link";
import { AUDIT_KINDS } from "@guardian/audit";
import { Button, EmptyState, Select, Stat } from "@/components";
import { AuditEntries, ChainTools, MAX_RANGE, seqLabel } from "@/components/audit";
import { requireSession, roleAllows } from "@/lib/auth";
import { compose } from "@/lib/compose";
import { getAuditHead, listAuditEntries } from "@/lib/data/audit";
import { getCustomerSettings } from "@/lib/data/settings";
import { exportRangeAction, verifyRangeAction } from "./actions";
import styles from "./page.module.css";

/** The chain is live and append only. A cached page of it would be a lie. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Audit chain",
};

const PAGE_SIZE = 25;

/** Paging deeper than this would pull more rows than the read is worth. */
const MAX_PAGE = 200;

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
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

  const caption = compose(
    "audit.caption",
    kind
      ? `Chain entries of kind ${kind}, newest first, page ${page + 1}.`
      : `Chain entries, newest first, page ${page + 1}.`,
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Audit chain</h1>
        <p className={styles.lede}>
          Every score, every reviewer action and every export is appended here and hashed against
          the entry before it. The chain carries hashes, tiers, model and lexicon versions,
          identifiers and decisions. It carries no message text.
        </p>
        <p className={styles.scope}>
          Scoped to {customerName}. Entries recorded under another customer are not readable from
          this seat, and sequence numbers are assigned across all of them, so this list can have
          gaps.
        </p>
      </header>

      <section className={styles.head} aria-label="Chain head">
        <Stat
          label="Head sequence"
          value={head ? seqLabel(head.seq) : null}
          unavailableNote="the head could not be read"
        />
        <Stat label="Entries on this page" value={entries.length} />
        <div className={styles.headHash}>
          <span className={styles.headHashValue}>{head ? head.hash : "not available"}</span>
          <span className={styles.headHashLabel}>Head hash</span>
        </div>
      </section>

      <ChainTools
        headSeq={head?.seq ?? null}
        headHash={head?.hash ?? null}
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
          label="Kind"
          defaultValue={kind ?? ""}
          options={[
            { value: "", label: "Every kind" },
            ...AUDIT_KINDS.map((value) => ({ value, label: value })),
          ]}
          help="One kind at a time. The customer is fixed to your seat."
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
          meta={head ? `Chain head ${seqLabel(head.seq)}.` : undefined}
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

      <nav className={styles.pager} aria-label="Chain pages">
        <span className={styles.pageCount}>
          Page {page + 1}
          {entries.length > 0
            ? `, entries ${seqLabel(oldestOnPage)} to ${seqLabel(newestOnPage)}`
            : ""}
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
