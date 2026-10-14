import { describe, expect, it } from "vitest";
import { cellFactory, copyText } from "./cells";
import type { Column } from "./api";

const column = (duckdbType: string): Column => ({
  name: "c",
  duckdbType,
  physicalType: null,
  logicalType: null,
  nullable: true,
});

describe("copyText", () => {
  it("joins cells with tabs and rows with newlines, quoting where needed", () => {
    const toCell = cellFactory([column("VARCHAR"), column("BIGINT")], "#999");
    const text = copyText([
      [toCell("plain", 0), toCell(42, 1)],
      [toCell('say "hi"', 0), toCell(null, 1)],
      [toCell("a\tb", 0), toCell({ k: [1, 2] }, 0)],
    ]);
    expect(text).toBe('plain\t42\n"say ""hi"""\tNULL\n"a\tb"\t"{""k"":[1,2]}"');
  });
});
