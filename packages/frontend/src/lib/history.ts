// The queries run from the query bar, most recent first, shared by all
// files and kept in the webview's localStorage.

const KEY = "queryHistory";
export const MAX_HISTORY = 50;

/** `list` with `query` moved to the front. */
export function addHistory(list: readonly string[], query: string): string[] {
  return [query, ...list.filter((q) => q !== query)].slice(0, MAX_HISTORY);
}

export function loadHistory(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}

export function saveHistory(list: readonly string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the history just isn't remembered.
  }
}

/** The history entry shown by Up and Down, and the text written before. */
export interface Browsing {
  index: number;
  draft: string;
}

/**
 * Up (`older`) or Down from `draft`: the text to show and where browsing
 * now is, or null at either end. Down from the newest entry gives back the
 * text written before browsing.
 */
export function stepHistory(
  history: readonly string[],
  browsing: Browsing | null,
  draft: string,
  older: boolean,
): { draft: string; browsing: Browsing | null } | null {
  const index = (browsing?.index ?? -1) + (older ? 1 : -1);
  if (index >= history.length || index < -1) return null;
  if (index === -1) return { draft: browsing!.draft, browsing: null };
  return { draft: history[index], browsing: { index, draft: browsing?.draft ?? draft } };
}
