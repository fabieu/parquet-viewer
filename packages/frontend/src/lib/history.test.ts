import { beforeEach, describe, expect, it } from "vitest";
import type { View } from "./api";
import { addHistory, historyLabel, loadHistory, MAX_HISTORY, stepHistory } from "./history";

const q = (clause: string, select = ""): View => ({ select, clause });

describe("addHistory", () => {
  it("puts the query first without duplicating it", () => {
    expect(addHistory([q("a"), q("b"), q("c")], q("b"))).toEqual([q("b"), q("a"), q("c")]);
    expect(addHistory([q("a")], q("a", "x"))).toEqual([q("a", "x"), q("a")]);
  });

  it("keeps the newest queries", () => {
    const list = Array.from({ length: MAX_HISTORY }, (_, i) => q(String(i)));
    const added = addHistory(list, q("new"));
    expect(added).toHaveLength(MAX_HISTORY);
    expect(added[0]).toEqual(q("new"));
    expect(added[MAX_HISTORY - 1]).toEqual(q(String(MAX_HISTORY - 2)));
  });
});

describe("historyLabel", () => {
  it("shows the column list only if there is one", () => {
    expect(historyLabel(q("WHERE a = 1"))).toBe("WHERE a = 1");
    expect(historyLabel(q("WHERE a = 1", "DISTINCT b"))).toBe("SELECT DISTINCT b WHERE a = 1");
    expect(historyLabel(q("", "b"))).toBe("SELECT b");
  });
});

describe("loadHistory", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    globalThis.localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    } as Storage;
  });

  it("reads views and the clauses stored before column lists", () => {
    storage.set("queryHistory", JSON.stringify(["WHERE a", { select: "b", clause: "" }, 3, { select: 1 }]));
    expect(loadHistory()).toEqual([q("WHERE a"), q("", "b")]);
  });
});

describe("stepHistory", () => {
  const history = [q("newest"), q("older")];
  const typing = q("typing", "x");

  it("steps back through the history and stops at the oldest entry", () => {
    const first = stepHistory(history, null, typing, true)!;
    expect(first).toEqual({ draft: q("newest"), browsing: { index: 0, draft: typing } });
    const second = stepHistory(history, first.browsing, first.draft, true)!;
    expect(second).toEqual({ draft: q("older"), browsing: { index: 1, draft: typing } });
    expect(stepHistory(history, second.browsing, second.draft, true)).toBeNull();
  });

  it("gives back the query written before browsing", () => {
    const first = stepHistory(history, null, typing, true)!;
    expect(stepHistory(history, first.browsing, first.draft, false)).toEqual({
      draft: typing,
      browsing: null,
    });
    expect(stepHistory(history, null, typing, false)).toBeNull();
  });

  it("does nothing without a history", () => {
    expect(stepHistory([], null, typing, true)).toBeNull();
  });
});
