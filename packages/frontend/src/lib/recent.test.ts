import { describe, expect, it } from "vitest";
import { addRecent, removeRecent } from "./recent";

describe("addRecent", () => {
  it("puts the path first without duplicating it", () => {
    expect(addRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(addRecent(["a"], "d")).toEqual(["d", "a"]);
  });

  it("keeps at most five paths", () => {
    const list = ["1", "2", "3", "4", "5"];
    expect(addRecent(list, "new")).toEqual(["new", "1", "2", "3", "4"]);
  });
});

describe("removeRecent", () => {
  it("drops the path", () => {
    expect(removeRecent(["a", "b"], "a")).toEqual(["b"]);
  });
});
