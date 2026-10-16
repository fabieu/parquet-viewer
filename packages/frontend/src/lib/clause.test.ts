import { describe, expect, it } from "vitest";
import type { Column } from "./api";
import { addFilter, cellFilters, cycleSort, trailingSort } from "./clause";

describe("trailingSort", () => {
  it("reads a trailing single-column sort", () => {
    expect(trailingSort('WHERE x > 1 ORDER BY "a b" DESC')).toEqual({ column: "a b", descending: true });
    expect(trailingSort("order by id")).toEqual({ column: "id", descending: false });
    expect(trailingSort('ORDER BY "we""ird"')).toEqual({ column: 'we"ird', descending: false });
  });

  it("ignores clauses without one", () => {
    expect(trailingSort("WHERE x > 1")).toBeNull();
    expect(trailingSort("ORDER BY a, b")).toBeNull();
  });
});

describe("cycleSort", () => {
  it("cycles ascending, descending, unsorted and keeps the WHERE part", () => {
    const asc = cycleSort("WHERE x > 1", "id");
    expect(asc).toBe('WHERE x > 1 ORDER BY "id" ASC');
    const desc = cycleSort(asc, "id");
    expect(desc).toBe('WHERE x > 1 ORDER BY "id" DESC');
    expect(cycleSort(desc, "id")).toBe("WHERE x > 1");
  });

  it("switches to another column", () => {
    expect(cycleSort('ORDER BY "id" DESC', "name")).toBe('ORDER BY "name" ASC');
  });

  it("replaces a multi-column ORDER BY", () => {
    expect(cycleSort("WHERE a = 1 ORDER BY a, b DESC", "c")).toBe('WHERE a = 1 ORDER BY "c" ASC');
  });

  it("quotes column names", () => {
    expect(cycleSort("", 'we"ird col')).toBe('ORDER BY "we""ird col" ASC');
  });
});

describe("cellFilters", () => {
  const col = (name: string, duckdbType: string): Column => ({
    name,
    duckdbType,
    physicalType: null,
    logicalType: null,
    nullable: true,
  });
  const conditions = (column: Column, value: Parameters<typeof cellFilters>[1]) =>
    cellFilters(column, value).map((f) => f.condition);

  it("offers equal, exclude and ranges for numbers", () => {
    expect(cellFilters(col("n", "INTEGER"), 42)).toEqual([
      { label: "Filter = 42", condition: '"n" = 42' },
      { label: "Filter != 42", condition: '"n" IS DISTINCT FROM 42' },
      { label: "Filter ≥ 42", condition: '"n" >= 42' },
      { label: "Filter ≤ 42", condition: '"n" <= 42' },
    ]);
  });

  it("leaves big integers and decimals unquoted, NaN and infinity quoted", () => {
    expect(conditions(col("b", "UBIGINT"), "18446744073709551615")[0]).toBe('"b" = 18446744073709551615');
    expect(conditions(col("d", "DECIMAL(10,2)"), "-12.34")[0]).toBe('"d" = -12.34');
    expect(conditions(col("f", "DOUBLE"), "inf")[0]).toBe("\"f\" = 'inf'");
  });

  it("quotes text and offers ranges only for ordered types", () => {
    expect(conditions(col("s", "VARCHAR"), "it's")).toEqual([
      "\"s\" = 'it''s'",
      "\"s\" IS DISTINCT FROM 'it''s'",
    ]);
    expect(conditions(col("t", "TIMESTAMP WITH TIME ZONE"), "2024-01-02T03:04:05+00")).toHaveLength(4);
    expect(conditions(col("x", "BOOLEAN"), true)).toEqual(['"x" = true', '"x" IS DISTINCT FROM true']);
  });

  it("offers IS NULL / IS NOT NULL for NULL", () => {
    expect(conditions(col("a b", "BLOB"), null)).toEqual(['"a b" IS NULL', '"a b" IS NOT NULL']);
  });

  it("offers nothing for previewed values", () => {
    expect(cellFilters(col("b", "BLOB"), "0x00ff")).toEqual([]);
    expect(cellFilters(col("l", "INTEGER[]"), [1, 2])).toEqual([]);
  });

  it("shortens long literals in labels only", () => {
    const [eq] = cellFilters(col("s", "VARCHAR"), "x".repeat(100));
    expect(eq.label).toBe(`Filter = '${"x".repeat(30)}…`);
    expect(eq.condition).toBe(`"s" = '${"x".repeat(100)}'`);
  });
});

describe("addFilter", () => {
  it("adds a WHERE", () => {
    expect(addFilter("", '"a" = 1')).toBe('WHERE "a" = 1');
    expect(addFilter('  ORDER BY "id" DESC', '"a" = 1')).toBe('WHERE "a" = 1 ORDER BY "id" DESC');
  });

  it("extends an existing WHERE before ORDER BY and LIMIT", () => {
    expect(addFilter("WHERE x > 1 ORDER BY y LIMIT 5", '"a" = 1')).toBe(
      'WHERE x > 1 AND "a" = 1 ORDER BY y LIMIT 5',
    );
    expect(addFilter("where x > 1 limit 5", '"a" = 1')).toBe('WHERE x > 1 AND "a" = 1 limit 5');
  });

  it("parenthesizes a condition with OR", () => {
    expect(addFilter("WHERE x = 1 OR y = 2", '"a" = 1')).toBe('WHERE (x = 1 OR y = 2) AND "a" = 1');
  });
});
