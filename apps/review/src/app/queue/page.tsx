import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FilterChips, QueueHeader, QueueList, RefineLink, lastArrivalWords } from "@/components/queue";
import type { FilterChip } from "@/components/queue";
import { requireSession } from "@/lib/auth";
import { RANKING_SENTENCE, listQueue } from "@/lib/data/cases";
import type { QueueCase, QueueFilters, QueueSummary, Tier } from "@/lib/data/types";
import { openCase } from "./actions";
import styles from "./page.module.css";

export const metadata = { title: "Queue" };

/** The queue is live. A cached queue is a queue that lies about what is waiting. */
export const dynamic = "force-dynamic";

type Chip = NonNullable<QueueFilters["chip"]>;

const CHIPS: Chip[] = ["all", "critical", "unclaimed", "breach", "needs_second"];

const CHIP_LABELS: Record<Chip, string> = {
  all: "All",
  critical: "Critical",
  unclaimed: "Unclaimed",
  breach: "Breach risk",
  needs_second: "Needs second reviewer",
};

/** Only these notices render. A message never comes out of the query string. */
const NOTICES: Record<string, string> = {
  unavailable: "That case is no longer in this partition. Nothing was claimed.",
};

const TIERS: Tier[] = ["T1", "T2"];

interface QueuePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function hrefFor(current: URLSearchParams, key: string, value: string | null): string {
  const next = new URLSearchParams(current);
  next.delete("notice");
  if (value === null) next.delete(key);
  else next.set(key, value);
  const query = next.toString();
  return query.length > 0 ? `/queue?${query}` : "/queue";
}

function chipCount(chip: Chip, summary: QueueSummary): number {
  switch (chip) {
    case "critical":
      return summary.criticalCount;
    case "unclaimed":
      return summary.unclaimedCount;
    case "breach":
      return summary.breachRiskCount;
    case "needs_second":
      return summary.needsSecondCount;
    default:
      return summary.total;
  }
}

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const current = new URLSearchParams();
  for (const key of ["chip", "tier", "surface"]) {
    const value = readParam(params[key]);
    if (value !== null) current.set(key, value);
  }

  const chipParam = readParam(params.chip);
  const chip: Chip = CHIPS.includes(chipParam as Chip) ? (chipParam as Chip) : "all";
  const tierParam = readParam(params.tier);
  const tier: Tier | null = TIERS.includes(tierParam as Tier) ? (tierParam as Tier) : null;
  const surface = readParam(params.surface);
  const notice = NOTICES[readParam(params.notice) ?? ""] ?? null;

  const page = await listQueue(session, {
    chip,
    ...(tier ? { tier: [tier] } : {}),
  });

  // Surface is a view filter. The pair row carries no channel outside mock mode,
  // so the control only appears when the partition actually reports more than
  // one, rather than sitting there doing nothing.
  const surfaces = [...new Set(page.cases.map((row) => row.channel).filter(isChannel))].sort();
  const cases: QueueCase[] =
    surface === null ? page.cases : page.cases.filter((row) => row.channel === surface);

  const filtered = chip !== "all" || tier !== null || surface !== null;
  const chips: FilterChip[] = CHIPS.map((key) => ({
    key,
    label: CHIP_LABELS[key],
    count: chipCount(key, page.summary),
    href: hrefFor(current, "chip", key === "all" ? null : key),
    active: chip === key,
  }));

  const refine = (
    <>
      <RefineLink href={hrefFor(current, "tier", null)} label="Every tier" active={tier === null} />
      {TIERS.map((value) => (
        <RefineLink
          key={value}
          href={hrefFor(current, "tier", value)}
          label={`Tier ${value}`}
          active={tier === value}
        />
      ))}
      {surfaces.length > 1 ? (
        <>
          <RefineLink
            href={hrefFor(current, "surface", null)}
            label="Every surface"
            active={surface === null}
          />
          {surfaces.map((value) => (
            <RefineLink
              key={value}
              href={hrefFor(current, "surface", value)}
              label={value}
              active={surface === value}
            />
          ))}
        </>
      ) : null}
    </>
  );

  return (
    <div className={styles.page}>
      <QueueHeader
        summary={page.summary}
        rankingSentence={RANKING_SENTENCE}
        sessionStartedAt={new Date(session.issuedAt)}
        notice={notice}
      />

      <FilterChips chips={chips} refine={refine} refineOpen={tier !== null || surface !== null} />

      <div className={styles.list}>
        {cases.length > 0 ? (
          <QueueList cases={cases} open={openCase} />
        ) : filtered ? (
          <EmptyState
            title="No cases match these filters."
            detail={`${page.summary.total} ${page.summary.total === 1 ? "case is" : "cases are"} in the queue.`}
            action={
              <Link className={styles.action} href="/queue">
                Show every case
              </Link>
            }
          />
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

function isChannel(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}
