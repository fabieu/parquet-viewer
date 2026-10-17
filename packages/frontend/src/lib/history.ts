// The queries run from the query bar, most recent first, shared by all
// files and kept in the webview's localStorage.

import { sameView, type View } from "./api";

const KEY = "queryHistory";
export const MAX_HISTORY = 50;

/** `list` with `query` moved to the front. */
export function addHistory(list: readonly View[], query: View): View[] {
  return [query, ...list.filter((q) => !sameView(q, query))].slice(0, MAX_HISTORY);
}

/** How the recent-queries menu shows `query`. */
export function historyLabel(query: View): string {
  return query.select === "" ? query.clause : `SELECT ${query.select} ${query.clause}`.trimEnd();
}

export function loadHistory(): View[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.flatMap(toView) : [];
  } catch {
    return [];
  }
}

/** A stored entry: a view, or the clause of an entry from before column lists. */
function toView(entry: unknown): View[] {
  if (typeof entry === "string") return [{ select: "", clause: entry }];
  if (entry && typeof entry === "object") {
    const { select, clause } = entry as Record<string, unknown>;
    if (typeof select === "string" && typeof clause === "string") return [{ select, clause }];
  }
  return [];
}

export function saveHistory(list: readonly View[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the history just isn't remembered.
  }
}

/** The history entry shown by Up and Down, and the query written before. */
export interface Browsing {
  index: number;
  draft: View;
}

/**
 * Up (`older`) or Down from `draft`: the query to show and where browsing
 * now is, or null at either end. Down from the newest entry gives back the
 * query written before browsing.
 */
export function stepHistory(
  history: readonly View[],
  browsing: Browsing | null,
  draft: View,
  older: boolean,
): { draft: View; browsing: Browsing | null } | null {
  const index = (browsing?.index ?? -1) + (older ? 1 : -1);
  if (index >= history.length || index < -1) return null;
  if (index === -1) return { draft: browsing!.draft, browsing: null };
  return { draft: history[index], browsing: { index, draft: browsing?.draft ?? draft } };
}
