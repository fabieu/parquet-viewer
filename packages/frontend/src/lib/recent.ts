// The recently opened files, most recent first, kept in the webview's
// localStorage.

const KEY = "recentFiles";
const MAX_RECENT = 5;

/** `list` with `path` moved to the front. */
export function addRecent(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENT);
}

export function removeRecent(list: readonly string[], path: string): string[] {
  return list.filter((p) => p !== path);
}

export function loadRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: readonly string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the list just isn't remembered.
  }
}
