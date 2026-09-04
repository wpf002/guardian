/**
 * The token contract, checked against the generated stylesheet rather than
 * against the generator that wrote it.
 *
 * scripts/theme/build-theme.mjs validates its own pairs, but it is not part of
 * `pnpm test`, so a hand edit to theme.css or a token swapped in a component
 * would ship without anything failing. These tests are the second half: the
 * numbers in the file, and the rules about which token a component is allowed
 * to spend on a boundary.
 *
 * Everything here is read from source. There is no browser in this suite, and a
 * contrast ratio does not need one.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styleRoot = resolve(process.cwd(), "src/styles");
const componentRoot = resolve(process.cwd(), "src/components");

const themeCss = readFileSync(join(styleRoot, "theme.css"), "utf8");

/** The token values in one block of the stylesheet. */
function tokensIn(selector: string): Record<string, string> {
  const start = themeCss.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block in theme.css`);
  const open = themeCss.indexOf("{", start);
  const end = themeCss.indexOf("\n}", open);
  const body = themeCss.slice(open, end);
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[match[1]!] = match[2]!.trim();
  }
  return out;
}

const light = tokensIn(":root {");
const dark = tokensIn(':root[data-theme="dark"]');

function luminance(hex: string): number {
  const value = hex.trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`not a hex colour: ${hex}`);
  const n = parseInt(value.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

/** Every ground a card, a panel or a page can paint text or a boundary on. */
const GROUNDS = ["bg", "surface", "surface-sunken"] as const;

describe("text tokens clear body contrast on every surface they sit on", () => {
  for (const [themeName, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    for (const token of ["text", "text-muted", "text-subtle"] as const) {
      for (const ground of GROUNDS) {
        it(`${themeName}: --${token} on --${ground}`, () => {
          expect(contrast(tokens[token]!, tokens[ground]!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe("boundary tokens clear the 3:1 non-text minimum", () => {
  for (const [themeName, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    for (const ground of GROUNDS) {
      it(`${themeName}: --border on --${ground}`, () => {
        expect(contrast(tokens.border!, tokens[ground]!)).toBeGreaterThanOrEqual(3);
      });
    }
    it(`${themeName}: --border-strong stays above --border, so hover still reads`, () => {
      expect(contrast(tokens["border-strong"]!, tokens.surface!)).toBeGreaterThan(
        contrast(tokens.border!, tokens.surface!),
      );
    });
  }

  it("the T0 tier bar is as perceivable as the other three", () => {
    // --tier-t0-border used to alias --divider, so a T0 card carried a tier bar
    // with no visible edge while T1, T2 and T3 were strongly marked. The
    // component layer is declared once, on :root, and both themes resolve it.
    expect(light["tier-t0-border"]).toBe("var(--border)");
  });
});

describe("the accent is a link colour and an active-state colour, so it is body text", () => {
  for (const [themeName, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    for (const ground of [...GROUNDS, "accent-soft"] as const) {
      it(`${themeName}: --accent on --${ground}`, () => {
        expect(contrast(tokens.accent!, tokens[ground]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("the scrim is translucent in both themes", () => {
  it("dims the page behind a dialog rather than replacing it", () => {
    for (const tokens of [light, dark]) {
      expect(tokens.scrim).toMatch(/\/\s*0?\.\d+\s*\)$/);
    }
    // A backdrop the same colour as the page is not a layer change at all.
    expect(dark.scrim).not.toBe(dark.bg);
  });
});

describe("components spend the right token on a control boundary", () => {
  const controls: Array<[string, string]> = [
    ["Form.module.css", ".control"],
    ["Button.module.css", ".secondary"],
    ["queue/FilterChips.module.css", ".chip"],
    ["queue/CaseCard.module.css", ".card"],
    ["case/Decision.module.css", ".verb"],
    ["Dialog.module.css", ".panel"],
  ];

  for (const [file, rule] of controls) {
    it(`${file} ${rule} draws its resting edge in --border, not --divider`, () => {
      const source = readFileSync(join(componentRoot, file), "utf8");
      const start = source.indexOf(`\n${rule} {`);
      expect(start).toBeGreaterThan(-1);
      const block = source.slice(start, source.indexOf("\n}", start));
      expect(block).toMatch(/border(?:-color)?:[^;]*var\(--border\)/);
      expect(block).not.toMatch(/border(?:-color)?:[^;]*var\(--divider\)/);
    });
  }

  it("the dialog backdrop is a scrim rather than a surface", () => {
    const source = readFileSync(join(componentRoot, "Dialog.module.css"), "utf8");
    const block = source.slice(source.indexOf(".backdrop {"), source.indexOf("\n}"));
    expect(block).toMatch(/background:\s*var\(--scrim\)/);
  });

  it("no card dims its own text with opacity, which composites the whole subtree", () => {
    const source = readFileSync(join(componentRoot, "queue/CaseCard.module.css"), "utf8");
    expect(source).not.toMatch(/opacity:\s*0\./);
  });

  it("the skip link is never put back into the grid when it takes focus", () => {
    // position: static made it a grid item: the rail moved to column two and
    // the content wrapped to row two on the first Tab of every page.
    const source = readFileSync(join(componentRoot, "AppShell.module.css"), "utf8");
    const block = source.slice(source.indexOf(".skip:focus {"));
    expect(block.slice(0, block.indexOf("}"))).not.toMatch(/position:\s*static/);
    expect(source).toMatch(/\.skip \{[^}]*position: fixed/);
  });
});
