import { describe, expect, it } from "vitest";
import type { Column } from "./api";
import { complete } from "./complete";

const col = (name: string, duckdbType = "BIGINT"): Column => ({
  name,
  duckdbType,
  physicalType: null,
  logicalType: null,
  nullable: true,
});
const columns = [col("amount"), col("Amount Due", "DOUBLE"), col("order"), col("id")];
const functions = ["abs", "age", "avg"];

/** Completes at the `|` in `text`. */
function at(text: string, force = false) {
  const caret = text.indexOf("|");
  return complete(text.replace("|", ""), caret, columns, functions, force);
}

describe("complete", () => {
  it("offers columns, then keywords, then functions, by prefix and ignoring case", () => {
    const c = at("WHERE A|");
    expect(c?.from).toBe(6);
    expect(c?.suggestions.map((s) => s.insert)).toEqual([
      "amount",
      '"Amount Due"',
      "AND",
      "ASC",
      "AS",
      "abs(",
      "age(",
      "avg(",
    ]);
  });

  it("writes keywords in uppercase, and does not offer the word as typed", () => {
    expect(at("SELECT dis|")?.suggestions).toEqual([
      { label: "DISTINCT", detail: "keyword", insert: "DISTINCT" },
    ]);
    expect(at("x n|")?.suggestions.map((s) => s.insert)).toEqual([
      "NOT",
      "NULL",
      "NULLS FIRST",
      "NULLS LAST",
    ]);
    expect(at("WHERE x = 1 and|")?.suggestions.map((s) => s.insert)).toEqual(["AND"]);
    expect(at("WHERE x = 1 AND|")).toBeNull();
    expect(at("WHERE id|")).toBeNull();
  });

  it("offers the most used keywords first", () => {
    expect(at("wh|")?.suggestions.map((s) => s.insert)).toEqual(["WHERE", "WHEN"]);
  });

  it("quotes column names that are keywords and opens a function's parentheses", () => {
    expect(at("ORDER BY or|")?.suggestions).toEqual([
      { label: "order", detail: "BIGINT", insert: '"order"' },
      { label: "OR", detail: "keyword", insert: "OR" },
      { label: "ORDER BY", detail: "keyword", insert: "ORDER BY" },
    ]);
    expect(at("WHERE ab|")?.suggestions).toEqual([{ label: "abs", detail: "function", insert: "abs(" }]);
  });

  it("completes a quoted name from its opening quote", () => {
    const c = at('WHERE "amount d|');
    expect(c?.from).toBe(6);
    expect(c?.suggestions.map((s) => s.insert)).toEqual(['"Amount Due"']);
  });

  it("completes the part of a word before the caret", () => {
    expect(at("WHERE i|xyz")?.suggestions.map((s) => s.label)).toEqual([
      "id",
      "IN",
      "IS",
      "ILIKE",
      "INTERVAL",
    ]);
  });

  it("offers nothing inside strings and comments or after a dot", () => {
    expect(at("WHERE x = 'a|")).toBeNull();
    expect(at("WHERE x = 'it''s a|'")).toBeNull();
    expect(at("WHERE x -- a|")).toBeNull();
    expect(at("WHERE s.a|")).toBeNull();
  });

  it("offers every name only when forced, without a typed word", () => {
    expect(at("WHERE |")).toBeNull();
    expect(at("WHERE |", true)?.suggestions).toHaveLength(45);
    expect(at("WHERE x = 'a'|", true)?.from).toBe(13);
  });

  it("offers nothing when no name matches", () => {
    expect(at("WHERE zz|")).toBeNull();
  });
});
