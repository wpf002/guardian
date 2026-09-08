import { EmptyState } from "@/components/EmptyState";
import { QueueHeader, QueueList, lastArrivalWords } from "@/components/queue";
import { requireSession } from "@/lib/auth";
import { listQueue } from "@/lib/data/cases";
import { openCase } from "./actions";
import styles from "./page.module.css";

export const metadata = { title: "Queue" };

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
 * The queue is one ranked list and nothing else.
 *
 * There were five filter chips here, plus a disclosure holding tier and surface
 * refinements. Nobody asked for them, and on a partition this size the chips
 * mostly printed the same numbers twice: "Breach risk 0" sat above a list of six
 * cases. A reviewer works this queue from the top down, so a control whose only
 * effect is to hide cases from the person whose job is to read them has to earn
 * its place, and these did not.
 */
export default async function QueuePage({ searchParams }: QueuePageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const notice = NOTICES[readParam(params.notice) ?? ""] ?? null;

  const page = await listQueue(session);

  return (
    <div className={styles.page}>
      <QueueHeader summary={page.summary} notice={notice} />

      <div className={styles.list}>
        {page.cases.length > 0 ? (
          <QueueList cases={page.cases} open={openCase} />
        ) : (
          <EmptyState
            title="Nothing is waiting."
            detail="The queue is live and will fill this row when something arrives."
            meta={lastArrivalWords(page.summary.lastArrivalAt)}
          />
        )}
      </div>
    </div>
  );
}
