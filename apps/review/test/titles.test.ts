/**
 * WCAG 2.4.2: a page title describes the topic or purpose of the page. It is
 * also the first thing a screen reader speaks on a load, and the only way to
 * tell two cases open in two tabs apart.
 *
 * Every route used to inherit "Guardian review console" from the root layout,
 * so /queue, /cases, every case, the dashboard and sign-in were all the same
 * string. This walks the route tree and refuses a page that names itself
 * nothing.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd(), "src/app");

function routePages(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...routePages(full, rel));
    else if (entry === "page.tsx") out.push(rel);
  }
  return out;
}

/** The one route with no title of its own: it redirects and renders nothing. */
const REDIRECT_ONLY = new Set(["page.tsx"]);

describe("every route names itself", () => {
  const pages = routePages(appRoot);

  it("finds the route tree", () => {
    expect(pages.length).toBeGreaterThan(8);
  });

  for (const page of pages) {
    if (REDIRECT_ONLY.has(page)) continue;
    it(`${page} exports a title`, () => {
      const source = readFileSync(join(appRoot, page), "utf8");
      expect(source).toMatch(/export (const metadata|async function generateMetadata)/);
      expect(source).toMatch(/title/);
    });
  }

  it("the root layout carries a template, so a page title reads as a page plus the product", () => {
    const layout = readFileSync(join(appRoot, "layout.tsx"), "utf8");
    expect(layout).toMatch(/template:\s*"%s · Guardian review console"/);
  });

  it("a case page titles itself by its pair, so two tabs are tellable apart", async () => {
    const { generateMetadata } = await import("@/app/cases/[id]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ id: "pair_4f2a" }) });
    expect(meta.title).toBe("Pair 4f2a");
  });
});
