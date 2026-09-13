/**
 * Every page in the console, held to one standard.
 *
 * Will asked for this more than once, page by page, and each fix landed on
 * the page he pointed at and nowhere else. This test is the "across the
 * board" part. It renders every page on the fixtures and fails if a person
 * would see a Discord id or one of the scorer's own words.
 *
 * The words are the kernel's vocabulary: tier and T0 to T3, band, pair,
 * signal, bundle, provenance, lexicon, partition, chain, hash, payload,
 * kernel, fan out. None of them means anything to a parent or a server
 * admin. A page that needs the idea says it in plain words instead.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: (href: string) => {
    throw new Error(`redirect ${href}`);
  },
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const { resetMockData } = await import("@/lib/mock/fixtures");
const { isTitleCase } = await import("@/lib/title-case");

const DISCORD_ID = /\b\d{17,20}\b/g;
const INTERNAL =
  /\b(T[0-3]|tiers?|bands?|pairs?|signals?|kernel|fan[ -]out|provenance|lexicon|bundles?|partitions?|chain|hash(es)?|payload|HMAC|snowflake)\b/gi;

async function pages(): Promise<Array<{ path: string; element: () => Promise<React.ReactElement> }>> {
  const { default: QueuePage } = await import("@/app/queue/page");
  const { default: CasePage } = await import("@/app/cases/[id]/page");
  const { default: GuildsPage } = await import("@/app/guilds/page");
  const { default: GuildPage } = await import("@/app/guilds/[guildId]/page");
  const { default: SettingsPage } = await import("@/app/settings/page");
  const { default: AuditPage } = await import("@/app/audit/page");
  const { default: AuditEntryPage } = await import("@/app/audit/[seq]/page");
  const { SignInForm } = await import("@/app/login/SignInForm");
  const { default: CaseNotFound } = await import("@/app/cases/[id]/not-found");
  const { default: EntryNotFound } = await import("@/app/audit/[seq]/not-found");
  const none = Promise.resolve({});
  return [
    { path: "/queue", element: () => QueuePage({ searchParams: none }) },
    { path: "/cases/pair_91c7", element: () => CasePage({ params: Promise.resolve({ id: "pair_91c7" }) }) },
    { path: "/cases/pair_4f2a", element: () => CasePage({ params: Promise.resolve({ id: "pair_4f2a" }) }) },
    // Decided and reported, with the report card an owner sees.
    { path: "/cases/pair_c5e1", element: () => CasePage({ params: Promise.resolve({ id: "pair_c5e1" }) }) },
    // Messages deleted on schedule, and flagged only for the account's other conversations.
    { path: "/cases/pair_3c88", element: () => CasePage({ params: Promise.resolve({ id: "pair_3c88" }) }) },
    // Somebody else has it open.
    { path: "/cases/pair_0b3e", element: () => CasePage({ params: Promise.resolve({ id: "pair_0b3e" }) }) },
    { path: "/guilds", element: () => GuildsPage() },
    { path: "/guilds/742118990011223344", element: () => GuildPage({ params: Promise.resolve({ guildId: "742118990011223344" }) }) },
    { path: "/settings", element: () => SettingsPage() },
    { path: "/audit", element: () => AuditPage({ searchParams: none }) },
    { path: "/audit/40", element: () => AuditEntryPage({ params: Promise.resolve({ seq: "40" }) }) },
    { path: "/login (form)", element: async () => <SignInForm /> },
    { path: "/cases/missing", element: async () => <CaseNotFound /> },
    { path: "/audit/missing", element: async () => <EntryNotFound /> },
  ];
}

beforeEach(() => {
  resetMockData();
});

afterEach(() => {
  cleanup();
});

describe("plain language, on every page", () => {
  it("shows no Discord id and none of the scorer's words", async () => {
    const found: string[] = [];
    for (const page of await pages()) {
      const { container, unmount } = render(await page.element());
      // A record's raw fields, folded under Technical Details for counsel, are
      // the one place a page may print hashes and field names. Nothing else is
      // exempt, and the exemption has to be marked on the element to count.
      const visible = container.cloneNode(true) as HTMLElement;
      visible.querySelectorAll("[data-technical]").forEach((node) => node.remove());
      const text = visible.textContent ?? "";
      const ids = [...new Set(text.match(DISCORD_ID) ?? [])];
      const words = [...new Set((text.match(INTERNAL) ?? []).map((w) => w.toLowerCase()))];
      if (ids.length > 0) found.push(`${page.path}: Discord ids ${ids.join(", ")}`);
      if (words.length > 0) found.push(`${page.path}: ${words.join(", ")}`);
      unmount();
    }
    expect(found, `\n${found.join("\n")}\n`).toEqual([]);
  });

  /*
   * Every button, link and disclosure a person clicks, in title case. Will asked
   * for it on buttons and links. Long clickable content, like a whole case card
   * that is a button, is a sentence rather than a label and is not checked.
   */
  it("labels every button, link and disclosure in title case", async () => {
    const found: string[] = [];
    for (const page of await pages()) {
      const { container, unmount } = render(await page.element());
      for (const el of container.querySelectorAll("button, a, summary")) {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text || text.split(" ").length > 7 || !/[a-z]/i.test(text)) continue;
        // A whole row that is a link, like an Evidence Log entry, holds its own
        // sentences in separate blocks. It is content, not a label.
        if (el.querySelectorAll(":scope > span").length >= 2) continue;
        if (!isTitleCase(text)) found.push(`${page.path}: ${el.tagName.toLowerCase()} "${text}"`);
      }
      unmount();
    }
    expect([...new Set(found)], `\n${[...new Set(found)].join("\n")}\n`).toEqual([]);
  });
});
