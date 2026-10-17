import { describe, expect, it } from "vitest";
import { highlight, isBareName, tokenize } from "./sql";

/** `text` as `kind:text` pairs, without spaces. */
function tokens(text: string): string[] {
  return tokenize(text)
    .filter((t) => t.kind !== "space")
    .map((t) => `${t.kind}:${text.slice(t.start, t.end)}`);
}

describe("tokenize", () => {
  it("splits a clause into words, numbers, strings and symbols", () => {
    expect(tokens(`WHERE "a b" >= 1.5e3 AND s = 'it''s' -- note`)).toEqual([
      "word:WHERE",
      'quoted:"a b"',
      "other:>",
      "other:=",
      "number:1.5e3",
      "word:AND",
      "word:s",
      "other:=",
      "string:'it''s'",
      "comment:-- note",
    ]);
  });

  it("runs unterminated strings, names and comments to the end", () => {
    expect(tokens("x = 'abc")).toEqual(["word:x", "other:=", "string:'abc"]);
    expect(tokens('"ab')).toEqual(['quoted:"ab']);
    expect(tokens("/* a */ b /* c")).toEqual(["comment:/* a */", "word:b", "comment:/* c"]);
  });

  it("covers the whole text", () => {
    const text = "WHERE größe > 1 ORDER BY é";
    expect(
      tokenize(text)
        .map((t) => text.slice(t.start, t.end))
        .join(""),
    ).toBe(text);
  });
});

describe("isBareName", () => {
  it("rejects keywords and names that need quotes", () => {
    expect(isBareName("amount_2")).toBe(true);
    expect(isBareName("Größe")).toBe(true);
    expect(isBareName("Order")).toBe(false);
    expect(isBareName("a b")).toBe(false);
    expect(isBareName("2a")).toBe(false);
  });
});

describe("highlight", () => {
  it("marks keywords, function calls, literals and comments", () => {
    const runs = highlight("WHERE abs (x) > 1 AND name = 'a' -- c")
      .filter((r) => r.text.trim() !== "")
      .map((r) => `${r.kind}:${r.text}`);
    expect(runs).toEqual([
      "keyword:WHERE",
      "function:abs",
      "operator:(",
      "plain:x",
      "operator:)",
      "operator:>",
      "number:1",
      "keyword:AND",
      "plain:name",
      "operator:=",
      "string:'a'",
      "comment:-- c",
    ]);
  });
});
