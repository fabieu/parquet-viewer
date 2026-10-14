/** Helpers for the user's `WHERE … ORDER BY …` text. */

export interface Sort {
  column: string;
  descending: boolean;
}

/** A trailing `ORDER BY <one column> [ASC|DESC]`, as header clicks write it. */
const TRAILING_SORT = /\s*\bORDER\s+BY\s+("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?\s*$/i;

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function unquote(ident: string): string {
  return ident.startsWith('"') ? ident.slice(1, -1).replace(/""/g, '"') : ident;
}

/** The single-column sort at the end of `clause`, if there is one. */
export function trailingSort(clause: string): Sort | null {
  const m = TRAILING_SORT.exec(clause);
  if (!m) return null;
  return { column: unquote(m[1]), descending: m[2]?.toUpperCase() === "DESC" };
}

/**
 * Header click on `column`: ascending → descending → unsorted. Replaces a
 * trailing single-column ORDER BY, or appends one.
 */
export function cycleSort(clause: string, column: string): string {
  const current = trailingSort(clause);
  // Drop any ORDER BY, including a multi-column one the user wrote.
  const base = clause.replace(/\s*\bORDER\s+BY\b[\s\S]*$/i, "").trimEnd();
  if (current?.column === column && current.descending) return base;
  const dir = current?.column === column ? "DESC" : "ASC";
  return `${base} ORDER BY ${quoteIdent(column)} ${dir}`.trim();
}
