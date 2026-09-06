import { describe, expect, it } from "vitest";
import {
  excerptFromNormalized,
  loadLexicon,
  normalize,
  reverseTokens,
  reversedReading,
} from "../src/index.js";

const lex = loadLexicon("v1");

describe("normalize", () => {
  it("expands the emoji codes from the case files", () => {
    expect(normalize("add me on 👻", lex).normalized).toContain("snapchat");
    expect(normalize("we can talk on 💿", lex).normalized).toContain("discord");
  });

  it("undoes leet substitutions", () => {
    expect(normalize("d1sc0rd", lex).normalized).toBe("discord");
    expect(normalize("leVe this app", lex).normalized).toBe("leave this app");
  });

  it("strips zero width characters used to break phrase matching", () => {
    const withZwsp = "se​nd n​udes";
    expect(normalize(withZwsp, lex).compact).toContain("sendnudes");
  });

  it("folds cyrillic lookalikes", () => {
    // "snap" written with a Cyrillic а.
    const out = normalize("snаp me", lex);
    expect(out.normalized).toContain("snap");
    expect(out.replacements.some((r) => r.kind === "confusable")).toBe(true);
  });

  it("collapses stretched characters", () => {
    expect(normalize("nuuuuudes", lex).normalized).toBe("nuudes");
  });

  it("compacts spaced out and punctuated obfuscation", () => {
    expect(normalize("s n a p c h a t", lex).compact).toBe("snapchat");
    expect(normalize("s.n.a.p", lex).compact).toBe("snap");
  });

  it("strips diacritics", () => {
    expect(normalize("sénd píçs", lex).normalized).toBe("send pics");
  });

  it("keeps an index map back into the original text", () => {
    const text = "hey add me on 👻 ok";
    const n = normalize(text, lex);
    const at = n.normalized.indexOf("snapchat");
    const excerpt = excerptFromNormalized(n, at, "snapchat".length, 6);
    expect(excerpt).toContain("👻");
    expect(text).toContain(excerpt);
  });

  it("never returns a rewritten string as the original", () => {
    const text = "d1sc0rd";
    expect(normalize(text, lex).original).toBe(text);
  });

  it("handles empty and whitespace only input", () => {
    expect(normalize("", lex).normalized).toBe("");
    expect(normalize("   \n\t ", lex).normalized).toBe("");
  });
});

describe("emoji keys carrying a variation selector", () => {
  it("resolves a key written with U+FE0F, which used to be a dead entry", () => {
    // The plane and the dove are both written with a selector in v1 and v2.
    expect(normalize("dm me on ✈️", lex).normalized).toContain("telegram");
    expect(normalize("find me on 🕊️", lex).normalized).toContain("telegram");
  });

  it("resolves the same key written without the selector", () => {
    expect(normalize("dm me on ✈", lex).normalized).toContain("telegram");
  });

  it("keeps the selector out of the normalized text", () => {
    expect(normalize("✈️", lex).normalized).not.toContain("️");
  });

  it("still quotes the original, selector and all", () => {
    const text = "add me on ✈️ ok";
    const n = normalize(text, lex);
    const at = n.normalized.indexOf("telegram");
    expect(excerptFromNormalized(n, at, "telegram".length, 6)).toContain("✈");
  });
});

/**
 * ROADMAP F-4. Reversed-text evasion writes one word backwards inside a
 * sentence that still reads left to right, because it has to stay readable by
 * the person it is aimed at. The reading reverses only that word.
 */
describe("reversedReading", () => {
  const lexicon = loadLexicon();
  const platforms = lexicon.platforms;

  function reading(text: string): string | null {
    const reversed = reversedReading(normalize(text, lexicon), platforms);
    return reversed === null ? null : reversed.normalized;
  }

  it("reverses the platform name and leaves the sentence alone", () => {
    expect(reading("add me on drocsid")).toBe("add me on discord");
    expect(reading("margelet, add me there")).toBe("telegram, add me there");
    expect(reading("im on tahcpans, find me")).toBe("im on snapchat, find me");
    expect(reading("margatsni is where i actually am")).toBe("instagram is where i actually am");
  });

  it("returns nothing when reversing surfaces nothing", () => {
    expect(reading("add me on discord")).toBeNull();
    expect(reading("what game are you playing tonight")).toBeNull();
    // A palindrome is already the right way round. The forward reading has it.
    expect(reading("read it backwards. kik")).toBeNull();
  });

  it("does not take a platform name away that was already there", () => {
    // "kik" reverses to itself, and reversing it would surface nothing new.
    expect(reading("kik me")).toBeNull();
  });

  /**
   * The offsets have to survive, or an excerpt built from a reversed match
   * would quote the wrong characters of the message a reviewer reads.
   */
  it("keeps the map pointing at the original characters", () => {
    const n = normalize("add me on drocsid", lexicon);
    const reversed = reversedReading(n, platforms)!;
    expect(reversed.normalized).toBe("add me on discord");
    expect(reversed.normalizedMap).toHaveLength(reversed.normalized.length);
    // The 'd' at the start of "discord" is the last character of "drocsid".
    const at = reversed.normalizedMap[reversed.normalized.indexOf("discord")]!;
    expect(n.original[at]).toBe("d");
    expect(at).toBe(n.original.length - 1);
    // The original is preserved, so an excerpt still quotes what was written.
    expect(reversed.original).toBe("add me on drocsid");
  });

  it("reverses every character of a token when asked directly", () => {
    expect(reverseTokens("add me on drocsid").text).toBe("dda em no discord");
    expect(reverseTokens("").text).toBe("");
  });
});
