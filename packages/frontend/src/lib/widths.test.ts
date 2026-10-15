import { describe, expect, it } from "vitest";
import { fitWidth, MAX_WIDTH, MIN_WIDTH } from "./widths";

// 10px per character, in any font.
const measure = (text: string) => text.length * 10;

describe("fitWidth", () => {
  it("fits the widest value plus padding", () => {
    expect(fitWidth("id", ["1", "123456789012", "12"], measure)).toBe(136);
  });

  it("fits the title with room for the sort arrow", () => {
    expect(fitWidth("population", ["1"], measure)).toBe(136);
  });

  it("keeps within the grid's limits", () => {
    expect(fitWidth("", [], measure)).toBe(MIN_WIDTH);
    expect(fitWidth("x", ["a".repeat(100)], measure)).toBe(MAX_WIDTH);
  });

  it("stops measuring once the maximum is reached", () => {
    const measured: string[] = [];
    const spy = (text: string) => (measured.push(text), text.length * 10);
    fitWidth("x", ["a".repeat(100), "b"], spy);
    expect(measured).not.toContain("b");
  });
});
