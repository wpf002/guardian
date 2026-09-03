import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoAccusation, findAccusations, isAccusatory } from "../src/index.js";

describe("accusation guard", () => {
  it("rejects the phrasings that would be Guardian's own speech", () => {
    expect(isAccusatory("This user is a predator.")).toBe(true);
    expect(isAccusatory("Confirmed groomer in your server.")).toBe(true);
    expect(isAccusatory("We caught a predator.")).toBe(true);
    expect(isAccusatory("Grooming detected in channel general.")).toBe(true);
  });

  it("accepts tier language that describes behaviour", () => {
    expect(isAccusatory("Tier T2. Supervision probing followed by a migration ask within 3 hours.")).toBe(false);
    expect(isAccusatory("Signals consistent with the documented pattern were recorded on this pair.")).toBe(false);
    expect(isAccusatory("Reviewer confirmed tier T3. Report drafted for the CyberTipline.")).toBe(false);
  });

  it("names the offending span and suggests a replacement", () => {
    const [finding] = findAccusations("the account is a groomer");
    expect(finding?.match).toContain("is a groomer");
    expect(finding?.instead).toBeTruthy();
  });

  it("throws with the call site so the failing code path is obvious", () => {
    expect(() => assertNoAccusation("this user is a predator", "modAlert")).toThrow(/modAlert/);
    expect(() => assertNoAccusation("tier T2 on one pair", "modAlert")).not.toThrow();
  });
});

/**
 * CLAUDE.md rule 5 says to check every UI string and log message. This walks
 * the workspace source and fails on any string literal that would be an
 * accusation, so the rule is enforced by CI rather than by memory.
 */
describe("source scan", () => {
  const root = join(import.meta.dirname, "..", "..", "..");
  const skipDirs = new Set(["node_modules", "dist", ".next", ".turbo", ".git", "coverage", "docs"]);
  const skipFiles = new Set(["language.ts", "language.test.ts"]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|py)$/.test(entry) && !skipFiles.has(entry)) out.push(full);
    }
    return out;
  }

  it("contains no accusatory string literal anywhere in the workspace", () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        // Only look at quoted text; prose in comments about the rule is fine.
        const literals = line.match(/(["'`])(?:(?!\1)[^\\]|\\.){4,200}?\1/g) ?? [];
        for (const literal of literals) {
          if (findAccusations(literal).length > 0) {
            offenders.push(`${file.replace(root, "")}: ${literal.slice(0, 80)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
