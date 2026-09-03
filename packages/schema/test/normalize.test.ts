import { describe, expect, it } from "vitest";
import { excerptFromNormalized, loadLexicon, normalize } from "../src/index.js";

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
