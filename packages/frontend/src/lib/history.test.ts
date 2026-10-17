import { describe, expect, it } from "vitest";
import { addHistory, MAX_HISTORY, stepHistory } from "./history";

describe("addHistory", () => {
  it("puts the query first without duplicating it", () => {
    expect(addHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("keeps the newest queries", () => {
    const list = Array.from({ length: MAX_HISTORY }, (_, i) => String(i));
    const added = addHistory(list, "new");
    expect(added).toHaveLength(MAX_HISTORY);
    expect(added[0]).toBe("new");
    expect(added[MAX_HISTORY - 1]).toBe(String(MAX_HISTORY - 2));
  });
});

describe("stepHistory", () => {
  const history = ["newest", "older"];

  it("steps back through the history and stops at the oldest entry", () => {
    const first = stepHistory(history, null, "typing", true)!;
    expect(first).toEqual({ draft: "newest", browsing: { index: 0, draft: "typing" } });
    const second = stepHistory(history, first.browsing, first.draft, true)!;
    expect(second).toEqual({ draft: "older", browsing: { index: 1, draft: "typing" } });
    expect(stepHistory(history, second.browsing, second.draft, true)).toBeNull();
  });

  it("gives back the text written before browsing", () => {
    const first = stepHistory(history, null, "typing", true)!;
    expect(stepHistory(history, first.browsing, first.draft, false)).toEqual({
      draft: "typing",
      browsing: null,
    });
    expect(stepHistory(history, null, "typing", false)).toBeNull();
  });

  it("does nothing without a history", () => {
    expect(stepHistory([], null, "", true)).toBeNull();
  });
});
