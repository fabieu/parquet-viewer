/** Helpers for the user's `WHERE … ORDER BY …` text. */

import type { CellValue, Column } from "./api";
import { NUMERIC } from "./cells";

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

/** A filter the cell context menu offers: its menu label and SQL condition. */
export interface CellFilter {
  label: string;
  condition: string;
}

/** Types with an order worth filtering by range. */
const ORDERED = new RegExp(`${NUMERIC.source}|^(DATE|TIME|TIMESTAMP)`);
/** Longest literal shown in a menu label. */
const MAX_LABEL_LITERAL = 32;

/**
 * Filters on `value`, a cell of `column`: equal, exclude, and for numbers
 * and dates ≥ / ≤; for NULL, IS NULL / IS NOT NULL. None for blobs and
 * nested values, which cells only preview.
 */
export function cellFilters(column: Column, value: CellValue): CellFilter[] {
  const col = quoteIdent(column.name);
  if (value === null) {
    return [
      { label: "Filter IS NULL", condition: `${col} IS NULL` },
      { label: "Filter IS NOT NULL", condition: `${col} IS NOT NULL` },
    ];
  }
  const literal = sqlLiteral(column, value);
  if (literal === null) return [];
  const shown = literal.length > MAX_LABEL_LITERAL ? `${literal.slice(0, MAX_LABEL_LITERAL - 1)}…` : literal;
  const filters = [
    { label: `Filter = ${shown}`, condition: `${col} = ${literal}` },
    // Unlike `<>`, keeps the NULL rows.
    { label: `Filter != ${shown}`, condition: `${col} IS DISTINCT FROM ${literal}` },
  ];
  if (ORDERED.test(column.duckdbType)) {
    filters.push(
      { label: `Filter ≥ ${shown}`, condition: `${col} >= ${literal}` },
      { label: `Filter ≤ ${shown}`, condition: `${col} <= ${literal}` },
    );
  }
  return filters;
}

/**
 * `value` as a SQL literal that compares equal to it, or null if the cell
 * text is not the whole value. Text is quoted and cast by DuckDB to the
 * column type, which works for dates, times, UUIDs and the like as shown.
 */
function sqlLiteral(column: Column, value: CellValue): string | null {
  if (typeof value === "object" || column.duckdbType === "BLOB") return null;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  // Big integers and decimals arrive as text; NaN and infinities stay quoted.
  if (NUMERIC.test(column.duckdbType) && /^-?\d+(\.\d+)?$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

/** A trailing part of the clause that comes after WHERE. */
const AFTER_WHERE = /\s*\b(?:ORDER\s+BY|LIMIT|OFFSET)\b[\s\S]*$/i;

/** `clause` with `condition` ANDed to its WHERE part, or a WHERE added. */
export function addFilter(clause: string, condition: string): string {
  const at = clause.search(AFTER_WHERE);
  const cut = at < 0 ? clause.length : at;
  const head = clause.slice(0, cut).trim();
  const tail = clause.slice(cut).trim();
  const existing = /^WHERE\b/i.test(head) ? head.slice("WHERE".length).trim() : null;
  // `a OR b AND c` would bind as `a OR (b AND c)`.
  const filtered =
    existing === null
      ? `WHERE ${condition} ${head}`
      : `WHERE ${/\bOR\b/i.test(existing) ? `(${existing})` : existing} AND ${condition}`;
  return `${filtered.trimEnd()} ${tail}`.trimEnd();
}
