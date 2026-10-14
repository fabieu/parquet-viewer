import { describe, expect, it } from "vitest";
import { cycleSort, trailingSort } from "./clause";

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
