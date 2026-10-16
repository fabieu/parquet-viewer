import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { CellValue, Column } from "./api";

export const NUMERIC =
  /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|DECIMAL)/;

export const loadingCell: GridCell = { kind: GridCellKind.Loading, allowOverlay: false };

/** The text a cell shows. */
export function cellText(cell: GridCell): string {
  return cell.kind === GridCellKind.Text ? cell.displayData : "";
}

/**
 * Tab-separated text of `rows`, as the grid copies text cells: the shown
 * text, quoted if it contains a tab, newline or quote.
 */
export function copyText(rows: GridCell[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = cellText(cell);
          return /[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join("\t"),
    )
    .join("\n");
}

export type ToCell = (value: CellValue, col: number) => GridCell;

/**
 * Builds the value → grid cell mapping for `columns`. Per-column alignment
 * and NULL cells are computed once, since cells are built every frame.
 */
export function cellFactory(columns: Column[], nullColor: string): ToCell {
  const align = columns.map((c) => (NUMERIC.test(c.duckdbType) ? ("right" as const) : undefined));
  const nullCells: GridCell[] = align.map((contentAlign) => ({
    kind: GridCellKind.Text,
    data: "",
    displayData: "NULL",
    allowOverlay: false,
    readonly: true,
    themeOverride: { textDark: nullColor },
    contentAlign,
  }));

  return (value, col) => {
    if (value === null) return nullCells[col];
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      // Lets long text and nested values be read in a popup.
      allowOverlay: true,
      readonly: true,
      contentAlign: align[col],
    };
  };
}
