/** Reading the query text: tokens for highlighting and autocomplete. */

export type TokenKind = "space" | "comment" | "string" | "quoted" | "number" | "word" | "other";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
}

// Unterminated strings, quoted names and block comments run to the end.
const TOKEN =
  /(\s+)|(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([\p{L}_][\p{L}\p{N}_$]*)|([\s\S])/uy;
const KINDS: TokenKind[] = ["space", "comment", "string", "quoted", "number", "word", "other"];

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    const group = m.findIndex((g, i) => i > 0 && g !== undefined);
    tokens.push({ kind: KINDS[group - 1], start: m.index, end: TOKEN.lastIndex });
  }
  return tokens;
}

/** DuckDB's reserved keywords and the others common in a WHERE or ORDER BY clause. */
export const KEYWORDS = new Set(
  `all analyse analyze and any array as asc asymmetric between both by case cast check collate column
  constraint create default deferrable desc describe distinct do else end escape except exists false
  fetch first for foreign from glob group having ilike in initially intersect interval into is isnull
  join lambda last lateral leading like limit not notnull null nulls offset on only or order over
  partition pivot pivot_longer pivot_wider placing primary qualify references returning select show
  similar some summarize symmetric table then to trailing true try_cast union unique unpivot using
  variadic when where window with`.split(/\s+/),
);

export type Highlight = "keyword" | "function" | "number" | "string" | "comment" | "operator" | "plain";

const CALL = /\s*\(/y;

/** `text` split into runs to color: keywords, names called as functions, literals and comments. */
export function highlight(text: string): { kind: Highlight; text: string }[] {
  return tokenize(text).map((t) => {
    const value = text.slice(t.start, t.end);
    let kind: Highlight = "plain";
    if (t.kind === "word") {
      CALL.lastIndex = t.end;
      if (KEYWORDS.has(value.toLowerCase())) kind = "keyword";
      else if (CALL.test(text)) kind = "function";
    } else if (t.kind === "number" || t.kind === "string" || t.kind === "comment") {
      kind = t.kind;
    } else if (t.kind === "other") {
      kind = "operator";
    }
    return { kind, text: value };
  });
}

/** A name that needs no quotes: a plain identifier that is not a keyword. */
export function isBareName(name: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(name) && !KEYWORDS.has(name.toLowerCase());
}
