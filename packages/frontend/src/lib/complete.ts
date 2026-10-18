/** Autocomplete for column names, SQL keywords and function names in the query bar. */

import type { Column } from "./api";
import { quoteIdent } from "./clause";
import { isBareName, tokenize } from "./sql";

export interface Suggestion {
  label: string;
  /** The column's type, `keyword` or `function`. */
  detail: string;
  /** Replaces the typed word; the caret goes after it. */
  insert: string;
}

export interface Completion {
  /** Start of the typed word; accepting replaces the text from here to the caret. */
  from: number;
  suggestions: Suggestion[];
}

const MAX_SUGGESTIONS = 50;

/** The keywords offered: those of a column list, WHERE and ORDER BY, most used first. */
const KEYWORD_SUGGESTIONS = [
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "ILIKE",
  "BETWEEN",
  "ORDER BY",
  "ASC",
  "DESC",
  "NULLS FIRST",
  "NULLS LAST",
  "LIMIT",
  "OFFSET",
  "DISTINCT",
  "AS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "CAST",
  "TRY_CAST",
  "TRUE",
  "FALSE",
  "EXISTS",
  "INTERVAL",
  "GLOB",
  "SIMILAR TO",
  "ESCAPE",
  "GROUP BY",
  "HAVING",
  "QUALIFY",
  "OVER",
  "PARTITION BY",
];

/**
 * The names to offer at `caret`: columns, then keywords, then functions,
 * that start with the word before it (or the text after an opening `"`),
 * ignoring case, but not the word itself. Keywords are always uppercase.
 * Nothing inside a string or comment or after a `.`, and nothing without a
 * typed word unless `force`d (Ctrl+Space).
 */
export function complete(
  text: string,
  caret: number,
  columns: readonly Column[],
  functions: readonly string[],
  force = false,
): Completion | null {
  const token = tokenize(text).find((t) => t.start < caret && caret <= t.end);
  let from = caret;
  let typed = "";
  if (token) {
    const value = text.slice(token.start, token.end);
    if (token.kind === "word") {
      from = token.start;
      typed = text.slice(from, caret);
    } else if (token.kind === "quoted" && !(caret === token.end && closed(value, '"'))) {
      from = token.start;
      typed = text.slice(from + 1, caret).replace(/""/g, '"');
    } else if (
      token.kind === "comment" ||
      (token.kind === "string" && !(caret === token.end && closed(value, "'")))
    ) {
      return null;
    }
  }
  if ((typed === "" && !force) || text[from - 1] === ".") return null;

  const prefix = typed.toLowerCase();
  const matches = (name: string) => name.toLowerCase().startsWith(prefix);
  const quoted = text[from] === '"';
  const suggestions: Suggestion[] = [
    ...columns
      .filter((c) => matches(c.name))
      .map((c) => {
        const insert = !quoted && isBareName(c.name) ? c.name : quoteIdent(c.name);
        return { label: c.name, detail: c.duckdbType, insert };
      }),
    ...(quoted ? [] : KEYWORD_SUGGESTIONS)
      .filter(matches)
      .map((k) => ({ label: k, detail: "keyword", insert: k })),
    ...(quoted ? [] : functions)
      .filter(matches)
      .map((f) => ({ label: f, detail: "function", insert: `${f}(` })),
  ]
    // A keyword typed in lowercase is still offered, to write it in uppercase.
    .filter((s) => s.insert !== typed)
    .slice(0, MAX_SUGGESTIONS);
  return suggestions.length > 0 ? { from, suggestions } : null;
}

/** Whether a string or quoted name `value` ends with its closing quote. */
function closed(value: string, quote: string): boolean {
  return new RegExp(`^${quote}(?:[^${quote}]|${quote}${quote})*${quote}$`).test(value);
}
