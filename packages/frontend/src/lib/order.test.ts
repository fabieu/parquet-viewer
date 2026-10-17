import { describe, expect, it } from "vitest";
import { moveItem } from "./order";

describe("moveItem", () => {
  it("moves an item either way and leaves the input alone", () => {
    const items = ["a", "b", "c", "d"];
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(items, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });
});
