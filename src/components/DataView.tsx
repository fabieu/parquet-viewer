import DataEditor, {
  type CellArray,
  type CellClickedEventArgs,
  type DataEditorRef,
  type GridCell,
  type GridColumn,
  type Item,
  type Rectangle,
} from "@glideapps/glide-data-grid";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, AppError, type Column, type FileId, type View } from "../lib/api";
import { cellFactory, copyText, loadingCell } from "../lib/cells";
import { ContextMenu } from "./ContextMenu";
import styles from "./DataView.module.css";
import { trailingSort } from "../lib/clause";
import { PAGE_SIZE, Pager, type ColumnWindow } from "../lib/pager";
import { GRID_THEME, NULL_COLOR } from "../lib/theme";

/** Largest selection copied in one go. */
const MAX_COPY_ROWS = 10_000;
const KEYBINDINGS = { copy: true, selectAll: true, search: false };
/** Space below the last row, so the horizontal scrollbar does not cover it. */
const BOTTOM_SPACE = 20;
/** Columns fetched on each side of the visible ones, for short scrolls. */
const COLUMN_MARGIN = 5;
/** Default column width, also used to guess how many columns fit. */
const COLUMN_WIDTH = 160;

interface Props {
  fileId: FileId;
  columns: Column[];
  /** Columns left out of the grid. Rows still carry every column. */
  hiddenColumns: ReadonlySet<string>;
  view: View;
  /** Row count to show: the view's, or the previous one while it runs. */
  rows: number;
  /** The view's first page has not arrived yet. */
  running: boolean;
  onSort: (column: string) => void;
  /** `view` answered with its first page; `rows` is its row count. */
  onLoaded: (view: View, rows: number) => void;
  /** `view` failed before any page loaded, e.g. invalid SQL. */
  onViewError: (view: View, error: unknown) => void;
  onError: (error: unknown) => void;
}

export const DataView = memo(function DataView(props: Props) {
  const { fileId, columns, hiddenColumns, view, rows, running, onSort } = props;
  const gridRef = useRef<DataEditorRef>(null);
  // Until the grid reports its region, assume a full window of columns, so
  // the first fetch already covers them.
  const visible = useRef<Rectangle>({
    x: 0,
    y: 0,
    width: Math.ceil(window.innerWidth / COLUMN_WIDTH),
    height: 50,
  });
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Keep callbacks current without recreating the pager.
  const callbacks = useRef(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });

  const pager = useMemo(() => {
    let loadedOnce = false;
    return new Pager({
      fetchRows: (offset, limit, columns, seq) => api.getRows(fileId, offset, limit, view, columns, seq),
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

  // Grid column index → index into `columns`; the one place grid indices
  // are mapped back to file columns.
  const shown = useMemo(
    () => columns.flatMap((c, i) => (hiddenColumns.has(c.name) ? [] : [i])),
    [columns, hiddenColumns],
  );
  const toCell = useMemo(() => cellFactory(columns, NULL_COLOR), [columns]);

  // Reports the visible region to the pager, as file rows and columns.
  const report = useCallback(() => {
    const r = visible.current;
    pager.setVisible(r.y, r.y + r.height, columnWindow(shown, r));
  }, [pager, shown]);

  // A new view starts at the top.
  useEffect(() => {
    visible.current = { ...visible.current, y: 0 };
    gridRef.current?.scrollTo(0, 0);
    pager.resume();
    return () => pager.pause();
  }, [pager]);

  // A new view or set of shown columns loads right away.
  useEffect(() => {
    report();
    pager.flush();
  }, [pager, report]);

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      visible.current = range;
      report();
    },
    [report],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const value = pager.getCell(row, shown[col]);
      return value === undefined ? loadingCell : toCell(value, shown[col]);
    },
    [pager, shown, toCell],
  );

  // Copy: use cached rows when possible, otherwise fetch the selection.
  const getCellsForSelection = useCallback(
    (rect: Rectangle) => {
      const cols = shown.slice(rect.x, rect.x + rect.width);
      const fromCache: GridCell[][] = [];
      for (let row = rect.y; row < rect.y + rect.height; row++) {
        const values = cols.map((c) => pager.getCell(row, c));
        if (values.includes(undefined)) break;
        fromCache.push(values.map((v, i) => toCell(v!, cols[i])));
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
        const page = await api.getRows(fileId, rect.y, rect.height, view, cols);
        const cells = page.rows.map((values) => values.map((v, i) => toCell(v, cols[i])));
        // The grid writes awaited cells to the copy event, which has ended
        // by now, so the clipboard would silently stay unchanged.
        try {
          await navigator.clipboard.writeText(copyText(cells));
        } catch (e) {
          callbacks.current.onError(new AppError("QueryFailed", `Copy failed: ${String(e)}`));
          throw e;
        }
        return cells;
      };
    },
    [pager, shown, toCell, fileId, view],
  );

  const sort = useMemo(() => trailingSort(view.clause), [view.clause]);
  const gridColumns = useMemo<GridColumn[]>(
    () =>
      shown.map((i) => {
        const c = columns[i];
        const arrow = sort?.column === c.name ? (sort.descending ? " ▼" : " ▲") : "";
        return { id: c.name, title: c.name + arrow, width: widths[c.name] ?? COLUMN_WIDTH };
      }),
    [columns, shown, sort, widths],
  );

  // Wide enough for the largest row number at full font size.
  const markerWidth = 12 + 8 * String(rows).length;
  const rowMarkers = useMemo(() => ({ kind: "number" as const, width: markerWidth }), [markerWidth]);
  // Scroll only vertically; the column just has to exist.
  const goToStart = () => gridRef.current?.scrollTo(0, 0, "vertical");
  const goToEnd = () => gridRef.current?.scrollTo(0, rows - 1, "vertical", 0, BOTTOM_SPACE);

  // The grid itself selects the right-clicked cell if it is outside the
  // selection, so the menu always acts on what is highlighted.
  const onCellContextMenu = useCallback((_cell: Item, e: CellClickedEventArgs) => {
    e.preventDefault();
    setMenu({ x: e.bounds.x + e.localEventX, y: e.bounds.y + e.localEventY });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Same as Ctrl+C. Errors (e.g. the copy limit) are reported by
  // `getCellsForSelection` already.
  const copySelection = () => {
    gridRef.current?.emit("copy").catch(() => {});
    gridRef.current?.focus();
  };

  const onHeaderClicked = useCallback(
    (col: number) => onSort(gridColumns[col].id as string),
    [onSort, gridColumns],
  );
  const onColumnResize = useCallback(
    (column: GridColumn, size: number) => setWidths((w) => ({ ...w, [column.id as string]: size })),
    [],
  );

  return (
    <div className={styles.gridWrap}>
      {running && <div className={styles.busy}>Running query…</div>}
      <DataEditor
        ref={gridRef}
        columns={gridColumns}
        rows={rows}
        getCellContent={getCellContent}
        getCellsForSelection={getCellsForSelection}
        onVisibleRegionChanged={onVisibleRegionChanged}
        onHeaderClicked={onHeaderClicked}
        onCellContextMenu={onCellContextMenu}
        onColumnResize={onColumnResize}
        rowMarkers={rowMarkers}
        rowSelect="none"
        overscrollY={BOTTOM_SPACE}
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        theme={GRID_THEME}
        keybindings={KEYBINDINGS}
      />
      {rows > 0 && shown.length > 0 && (
        <div className={styles.jumpButtons}>
          <button type="button" onClick={goToStart} title="Go to first row" aria-label="Go to first row">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
          <button type="button" onClick={goToEnd} title="Go to last row" aria-label="Go to last row">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </button>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: "Copy", shortcut: "Ctrl+C", onSelect: copySelection }]}
          onClose={closeMenu}
        />
      )}
    </div>
  );
});

/** The file columns visible in `range`, and those to fetch around them. */
function columnWindow(shown: number[], range: Rectangle): ColumnWindow {
  const end = range.x + range.width;
  return {
    visible: shown.slice(range.x, end),
    fetch: shown.slice(Math.max(0, range.x - COLUMN_MARGIN), end + COLUMN_MARGIN),
  };
}

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
