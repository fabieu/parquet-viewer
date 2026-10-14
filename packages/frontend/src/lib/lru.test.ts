import { describe, expect, it } from "vitest";
import { LruCache } from "./lru";

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new LruCache<number, string>(2);
    cache.set(1, "a");
    cache.set(2, "b");
    cache.get(1); // 2 is now the oldest
    cache.set(3, "c");
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);
    expect(cache.has(3)).toBe(true);
    expect(cache.size).toBe(2);
  });

  it("refreshes an entry when it is set again", () => {
    const cache = new LruCache<number, string>(2);
    cache.set(1, "a");
    cache.set(2, "b");
    cache.set(1, "a2");
    cache.set(3, "c");
    expect(cache.get(1)).toBe("a2");
    expect(cache.has(2)).toBe(false);
  });
});
