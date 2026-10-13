import DataEditor, {
  type CellArray,
  type DataEditorRef,
  type GridCell,
  type GridColumn,
  type Item,
  type Rectangle,
  type Theme,
} from "@glideapps/glide-data-grid";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, AppError, type CellValue, type Column, type FileId, type View } from "../lib/api";
import { cellFactory, loadingCell } from "../lib/cells";
import { trailingSort } from "../lib/clause";
import { PAGE_SIZE, Pager } from "../lib/pager";

/** Largest selection copied in one go. */
const MAX_COPY_ROWS = 10_000;
const KEYBINDINGS = { copy: true, selectAll: true, search: false };

interface Props {
  fileId: FileId;
  columns: Column[];
  view: View;
  /** Row count to show: the view's, or the previous one while it runs. */
  rows: number;
  /** The view's first page has not arrived yet. */
  running: boolean;
  theme: Partial<Theme>;
  nullColor: string;
  onSort: (column: string) => void;
  /** `view` answered with its first page; `rows` is its row count. */
  onLoaded: (view: View, rows: number) => void;
  /** `view` failed before any page loaded, e.g. invalid SQL. */
  onViewError: (view: View, error: unknown) => void;
  onError: (error: unknown) => void;
}

export const DataView = memo(function DataView(props: Props) {
  const { fileId, columns, view, rows, running, theme, nullColor, onSort } = props;
  const gridRef = useRef<DataEditorRef>(null);
  const visible = useRef<Rectangle>({ x: 0, y: 0, width: 1, height: 50 });
  const [widths, setWidths] = useState<Record<string, number>>({});

  // Keep callbacks current without recreating the pager.
  const callbacks = useRef(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });

  const pager = useMemo(() => {
    let loadedOnce = false;
    return new Pager({
      fetchPage: (offset, limit, seq) => api.getRows(fileId, offset, limit, view, seq),
      onLoad: (page, total) => {
        // The row count is the same for every page of a view.
        if (!loadedOnce) callbacks.current.onLoaded(view, total);
        loadedOnce = true;
        redrawPage(gridRef.current, visible.current, page, PAGE_SIZE);
      },
      onError: (e) => {
        if (loadedOnce) callbacks.current.onError(e);
        else callbacks.current.onViewError(view, e);
      },
    });
  }, [fileId, view]);

  // A new view starts at the top.
  useEffect(() => {
    visible.current = { ...visible.current, y: 0 };
    gridRef.current?.scrollTo(0, 0);
    pager.resume();
    pager.setVisible(0, visible.current.height);
    pager.flush();
    return () => pager.pause();
  }, [pager]);

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      visible.current = range;
      pager.setVisible(range.y, range.y + range.height);
    },
    [pager],
  );

  const toCell = useMemo(() => cellFactory(columns, nullColor), [columns, nullColor]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const values = pager.getRow(row);
      return values ? toCell(values[col], col) : loadingCell;
    },
    [pager, toCell],
  );

  // Copy: use cached rows when possible, otherwise fetch the selection.
  const getCellsForSelection = useCallback(
    (rect: Rectangle) => {
      const rowCells = (values: CellValue[]) =>
        Array.from({ length: rect.width }, (_, i) => toCell(values[rect.x + i], rect.x + i));
      const fromCache: GridCell[][] = [];
      for (let row = rect.y; row < rect.y + rect.height; row++) {
        const values = pager.getRow(row);
        if (!values) break;
        fromCache.push(rowCells(values));
      }
      if (fromCache.length === rect.height) return fromCache as CellArray;

      return async (): Promise<CellArray> => {
        if (rect.height > MAX_COPY_ROWS) {
          const error = new AppError(
            "QueryFailed",
            `Copy is limited to ${MAX_COPY_ROWS.toLocaleString()} rows.`,
          );
          callbacks.current.onError(error);
          throw error;
        }
        const page = await api.getRows(fileId, rect.y, rect.height, view);
        return page.rows.map(rowCells);
      };
    },
    [pager, toCell, fileId, view],
  );

  const sort = useMemo(() => trailingSort(view.clause), [view.clause]);
  const gridColumns = useMemo<GridColumn[]>(
    () =>
      columns.map((c) => {
        const arrow = sort?.column === c.name ? (sort.descending ? " ▼" : " ▲") : "";
        return { id: c.name, title: c.name + arrow, width: widths[c.name] ?? 160 };
      }),
    [columns, sort, widths],
  );

  // Wide enough for the largest row number at full font size.
  const markerWidth = 20 + 8 * String(rows).length;
  const rowMarkers = useMemo(() => ({ kind: "number" as const, width: markerWidth }), [markerWidth]);

  const onHeaderClicked = useCallback((col: number) => onSort(columns[col].name), [onSort, columns]);
  const onColumnResize = useCallback(
    (column: GridColumn, size: number) => setWidths((w) => ({ ...w, [column.id as string]: size })),
    [],
  );

  return (
    <div className="grid-wrap">
      {running && <div className="grid-busy">Running query…</div>}
      <DataEditor
        ref={gridRef}
        columns={gridColumns}
        rows={rows}
        getCellContent={getCellContent}
        getCellsForSelection={getCellsForSelection}
        onVisibleRegionChanged={onVisibleRegionChanged}
        onHeaderClicked={onHeaderClicked}
        onColumnResize={onColumnResize}
        rowMarkers={rowMarkers}
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        theme={theme}
        keybindings={KEYBINDINGS}
      />
    </div>
  );
});

/** Redraws the visible cells that belong to a newly loaded page. */
function redrawPage(grid: DataEditorRef | null, range: Rectangle, page: number, pageSize: number) {
  if (!grid) return;
  const first = Math.max(page * pageSize, range.y);
  const last = Math.min((page + 1) * pageSize, range.y + range.height + 1);
  const cells: { cell: Item }[] = [];
  for (let row = first; row < last; row++) {
    for (let col = range.x; col < range.x + range.width; col++) cells.push({ cell: [col, row] });
  }
  if (cells.length > 0) grid.updateCells(cells);
}
