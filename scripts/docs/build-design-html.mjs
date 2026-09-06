#!/usr/bin/env node
/**
 * Render docs/DESIGN.md into docs/design.html.
 *
 * The two files said different things for two days, which is the ordinary fate
 * of a hand-maintained render: DESIGN.md is the spec and every edit went there,
 * while the HTML kept its September 2 wording of the fusion pseudocode. A
 * reader who opened the prettier one got the wrong answer.
 *
 * So the HTML is generated now, and `--check` fails when it is out of date, so
 * the drift is a failing command rather than something somebody notices later.
 * The stylesheet is the one the hand-written page already carried, kept
 * verbatim in design.css.txt, so the page still looks like itself.
 *
 * The markdown subset is exactly what DESIGN.md uses: headings, paragraphs,
 * unordered and ordered lists, tables, indented code blocks, links, inline
 * code, and bold. Anything else would be a construct nobody has written, and a
 * renderer that handles constructs nobody writes is a renderer nobody tests.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const SOURCE = join(root, "docs", "DESIGN.md");
const TARGET = join(root, "docs", "design.html");
const STYLE = join(here, "design.css.txt");

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Inline markdown. Code spans are lifted out first and put back last, so
 * nothing inside a code span is read as markup and nothing outside one is
 * mistaken for a placeholder. The placeholder is a token no document contains.
 */
function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `@@GUARDIAN_CODE_${codes.length - 1}@@`;
  });
  out = escapeHtml(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const external = href.startsWith("http") || href.startsWith("#") || href.startsWith("./");
    return `<a href="${external ? href : "#"}">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/@@GUARDIAN_CODE_(\d+)@@/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return out;
}

/** A stable anchor for a heading, so a link into the page keeps working. */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderTable(rows) {
  // A markdown table's second row is the alignment rule and carries no content.
  const body = rows.filter((row) => !/^\|[\s:|-]+\|$/.test(row.trim()));
  const cells = (row) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());

  const out = ['<div class="tablewrap"><table>'];
  body.forEach((row, index) => {
    const tag = index === 0 ? "th" : "td";
    const rendered = cells(row)
      .map((cell) => `<${tag}>${inline(cell)}</${tag}>`)
      .join("");
    out.push(`<tr>${rendered}</tr>`);
  });
  out.push("</table></div>");
  return out.join("\n");
}

const BLOCK_START = /^(#{1,4}\s|\||[-*]\s|\d+\.\s)/;

export function renderMarkdown(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  const toc = [];
  let i = 0;
  let sawTitle = false;
  let ledeUsed = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        sawTitle = true;
        html.push('<div class="eyebrow">Design doc · generated from DESIGN.md</div>');
        html.push(`<h1>${inline(text)}</h1>`);
      } else {
        const id = slug(text);
        if (level === 2) toc.push({ id, text });
        html.push(`<h${level}${level === 2 ? ` id="${id}"` : ""}>${inline(text)}</h${level}>`);
      }
      i += 1;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i]);
        i += 1;
      }
      html.push(renderTable(rows));
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().replace(/^[-*]\s+/, "")));
        i += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().replace(/^\d+\.\s+/, "")));
        i += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${item}</li>`).join("")}</ol>`);
      continue;
    }

    if (/^ {4}/.test(line)) {
      const code = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || lines[i].trim() === "")) {
        // A blank line ends the block unless the block continues after it.
        if (lines[i].trim() === "" && !/^ {4}/.test(lines[i + 1] ?? "")) break;
        code.push(lines[i].replace(/^ {4}/, ""));
        i += 1;
      }
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !BLOCK_START.test(lines[i].trim()) &&
      !/^ {4}/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    const text = paragraph.join(" ");
    // The first paragraph after the title is the lede, as the hand-written page
    // had it.
    if (sawTitle && !ledeUsed) {
      ledeUsed = true;
      html.push(`<p class="lede">${inline(text)}</p>`);
    } else {
      html.push(`<p>${inline(text)}</p>`);
    }
  }

  return { body: html.join("\n"), toc };
}

export function buildHtml(markdown, style) {
  const { body, toc } = renderMarkdown(markdown);
  const nav = toc.map((entry) => `  <a href="#${entry.id}">${escapeHtml(entry.text)}</a>`).join("\n");
  return [
    "<title>Guardian Design Doc</title>",
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">',
    style.trimEnd(),
    "<!-- Generated by scripts/docs/build-design-html.mjs from docs/DESIGN.md.",
    "     Do not edit this file. Edit the markdown and run `pnpm docs`. -->",
    '<div class="wrap">',
    '<nav class="toc">',
    '  <div class="eyebrow">Contents</div>',
    nav,
    "</nav>",
    "",
    "<main>",
    body,
    "</main>",
    "</div>",
    "",
  ].join("\n");
}

function main() {
  const markdown = readFileSync(SOURCE, "utf8");
  const style = readFileSync(STYLE, "utf8");
  const html = buildHtml(markdown, style);

  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(TARGET, "utf8");
    } catch {
      current = "";
    }
    if (current !== html) {
      console.error(
        "docs/design.html is out of date with docs/DESIGN.md. Run `pnpm docs` and commit the result.",
      );
      process.exit(1);
    }
    console.log("docs/design.html matches docs/DESIGN.md");
    return;
  }

  writeFileSync(TARGET, html);
  console.log(`rendered docs/design.html from docs/DESIGN.md (${html.length} bytes)`);
}

main();
