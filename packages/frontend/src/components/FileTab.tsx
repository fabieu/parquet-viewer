import { save } from "@tauri-apps/plugin-dialog";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./FileTab.module.css";
import { api, AppError, EMPTY_VIEW, type Column, type OpenedFile, type View } from "../lib/api";
import { addFilter, cycleSort } from "../lib/clause";
import { fileName, formatCount } from "../lib/format";
import { DataView } from "./DataView";
import { QueryBar } from "./QueryBar";
import { Sidebar } from "./Sidebar";

const MIN_SIDEBAR_WIDTH = 200;
const MIN_GRID_WIDTH = 200;

export interface LoadedFile extends OpenedFile {
  columns: Column[];
}

interface Props {
  file: LoadedFile;
  /** Hidden rather than unmounted when another tab is active, so the
   *  query, scroll position, page cache and computed stats are kept. */
  hidden: boolean;
  showSidebar: boolean;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  /** Function names for the query bar's autocomplete. */
  functions: readonly string[];
  /** An app-wide operation (such as opening a file) is running. */
  busy: boolean;
  onError: (e: unknown) => void;
  /** Shows a message, or clears the messages with `null`. */
  onNotice: (notice: string | null) => void;
}

/** One open file: its query bar, sidebar, grid and status bar. Memoized,
 *  as every open file's tab re-renders with the app otherwise. */
export const FileTab = memo(function FileTab({
  file,
  hidden,
  showSidebar,
  sidebarWidth,
  onSidebarWidthChange,
  functions,
  busy,
  onError,
  onNotice,
}: Props) {
  // The query text being edited, the view the grid shows, and the last
  // view that loaded with its row count (to fall back to after invalid SQL).
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<View>(EMPTY_VIEW);
  const [loaded, setLoaded] = useState<{ view: View; rows: number }>({
    view: EMPTY_VIEW,
    rows: file.info.rowCount,
  });
  const [queryError, setQueryError] = useState<string | null>(null);
  // Name of the file being exported to.
  const [exporting, setExporting] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());

  // Read by the header-sort callback, which then stays stable while typing.
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const applyClause = useCallback((clause: string) => {
    const trimmed = clause.trim();
    setQueryError(null);
    setView((v) => (v.clause === trimmed ? v : { clause: trimmed }));
  }, []);

  // Puts `rewrite` of the query text in the query bar and runs it.
  const rewriteClause = useCallback(
    (rewrite: (clause: string) => string) => {
      const next = rewrite(draftRef.current);
      setDraft(next);
      applyClause(next);
    },
    [applyClause],
  );
  // Header click rewrites the query's ORDER BY: ascending → descending → off.
  const onSort = useCallback((column: string) => rewriteClause((c) => cycleSort(c, column)), [rewriteClause]);
  // A cell context-menu filter adds its condition to the query's WHERE part.
  const onFilter = useCallback(
    (condition: string) => rewriteClause((c) => addFilter(c, condition)),
    [rewriteClause],
  );

  // Dragging the handle right of the sidebar resizes it, keeping some room
  // for both the sidebar and the grid. The width goes straight to the DOM
  // while dragging and into state once at the end, so a drag does not
  // re-render the app on every pointer move.
  const startSidebarResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const handle = e.currentTarget;
    const sidebar = handle.previousElementSibling as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let width = startWidth;
    const move = (ev: PointerEvent) => {
      const max = Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_GRID_WIDTH);
      width = Math.min(max, Math.max(MIN_SIDEBAR_WIDTH, startWidth + ev.clientX - startX));
      sidebar.style.width = `${width}px`;
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("lostpointercapture", stop);
      onSidebarWidthChange(width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", stop);
  };

  const toggleColumn = useCallback((name: string) => {
    setHiddenColumns((h) => {
      const next = new Set(h);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }, []);

  // Grid column index → index into `file.columns`; the one place grid
  // indices are mapped back to file columns.
  const shown = useMemo(
    () => file.columns.flatMap((c, i) => (hiddenColumns.has(c.name) ? [] : [i])),
    [file, hiddenColumns],
  );

  // A query is running until its first page arrives; meanwhile the grid
  // keeps the previous row count.
  const running = view.clause !== "" && view !== loaded.view;
  const rows = view.clause === "" ? file.info.rowCount : loaded.rows;

  // Saves the view with its shown columns, in grid order. The backend picks
  // the format from the file extension.
  const exportView = async () => {
    const stem = fileName(file.info.path).replace(/\.[^.]*$/, "");
    const path = await save({
      defaultPath: `${stem}-export.parquet`,
      filters: [
        { name: "Parquet", extensions: ["parquet"] },
        { name: "CSV", extensions: ["csv"] },
      ],
    });
    if (!path) return;
    onNotice(null);
    setExporting(fileName(path));
    try {
      await api.exportView(file.fileId, view, shown, path);
      onNotice(`Exported ${formatCount(rows)} rows to ${path}`);
    } catch (e) {
      onError(e);
    } finally {
      setExporting(null);
    }
  };

  const onLoaded = useCallback((view: View, rows: number) => setLoaded({ view, rows }), []);

  // The query failed before showing anything: explain why and go back to
  // the last view that worked. The text stays in the field for editing.
  const onViewError = useCallback(
    (failed: View, e: unknown) => {
      setQueryError(e instanceof AppError ? e.message : String(e));
      setView((v) => (v === failed ? loaded.view : v));
    },
    [loaded.view],
  );

  return (
    <div className={styles.fileTab} hidden={hidden}>
      <QueryBar
        draft={draft}
        onDraftChange={setDraft}
        columns={file.columns}
        functions={functions}
        onApply={applyClause}
        error={queryError}
        running={running}
        onExport={exportView}
        exporting={exporting}
        canExport={!running && !busy && exporting === null && shown.length > 0}
      />
      <main className={styles.content}>
        {/* Hidden rather than unmounted, so computed stats are kept. */}
        <Sidebar
          hidden={!showSidebar}
          width={sidebarWidth}
          fileId={file.fileId}
          info={file.info}
          columns={file.columns}
          hiddenColumns={hiddenColumns}
          view={view}
          running={running}
          onToggleColumn={toggleColumn}
          onError={onError}
        />
        <div
          className={styles.sidebarResize}
          hidden={!showSidebar}
          onPointerDown={startSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
        <DataView
          fileId={file.fileId}
          columns={file.columns}
          shown={shown}
          view={view}
          rows={rows}
          running={running}
          onSort={onSort}
          onFilter={onFilter}
          onLoaded={onLoaded}
          onViewError={onViewError}
          onError={onError}
        />
      </main>
      <footer className={styles.statusbar}>
        <span title={file.info.path}>{fileName(file.info.path)}</span>
        <span>
          {rows !== file.info.rowCount
            ? `${formatCount(rows)} of ${formatCount(file.info.rowCount)} rows`
            : `${formatCount(file.info.rowCount)} rows`}
          {" · "}
          {hiddenColumns.size > 0
            ? `${formatCount(file.columns.length - hiddenColumns.size)} of ${formatCount(file.columns.length)} columns`
            : `${formatCount(file.columns.length)} columns`}
          {file.info.compression.length > 0 && ` · ${file.info.compression.join(", ")}`}
        </span>
      </footer>
    </div>
  );
});
