import { EmptyState } from "@/components/EmptyState";
import { PeopleList, QueueHeader, lastArrivalWords } from "@/components/queue";
import { requireSession } from "@/lib/auth";
import { listQueue } from "@/lib/data/cases";
import { groupByContactingAccount, groupByTargetedAccount, ungrouped } from "@/lib/data/people";
import { openCase } from "./actions";
import styles from "./page.module.css";

export const metadata = { title: "Dashboard" };

/** The queue is live. A cached queue is a queue that lies about what is waiting. */
export const dynamic = "force-dynamic";

/** Only these notices render. A message never comes out of the query string. */
const NOTICES: Record<string, string> = {
  unavailable: "That case is no longer in this partition. Nothing was claimed.",
};

interface QueuePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Who is being contacted, in this server, right now.
 *
 * This was a ranked list of conversations. A conversation is Guardian's unit,
 * not a person's: a child three accounts were working on appeared as three
 * unrelated rows, and the single most important fact about that child, that it
 * was three and not one, was on no screen in the product. An account making the
 * same approach to five children was five rows with nothing joining them.
 *
 * The same cases, read three ways. Who is being contacted, who is doing the
 * contacting, and every conversation flat. Grouping only, over the kernel's own
 * output: nothing here detects anything, and no group is a finding about
 * anybody.
 */
export default async function QueuePage({ searchParams }: QueuePageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const notice = NOTICES[readParam(params.notice) ?? ""] ?? null;

  const page = await listQueue(session);
  const targeted = groupByTargetedAccount(page.cases);
  const contacting = groupByContactingAccount(page.cases);
  const unmatched = ungrouped(page.cases);

  return (
    <div className={styles.page}>
      <QueueHeader summary={page.summary} targetedCount={targeted.length} notice={notice} />

      <div className={styles.list}>
        {page.cases.length > 0 ? (
          <PeopleList
            targeted={targeted}
            contacting={contacting}
            cases={page.cases}
            unmatched={unmatched}
            open={openCase}
          />
        ) : (
          <EmptyState
            title="Nobody is being contacted."
            detail="Guardian is reading this server and will put an account here the moment somebody older starts working on a younger one."
            meta={lastArrivalWords(page.summary.lastArrivalAt)}
          />
        )}
      </div>
    </div>
  );
}
